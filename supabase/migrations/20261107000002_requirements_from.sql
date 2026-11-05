-- =============================================================================
-- When something is created from a template with a start date already past, the
-- creator chooses where recurring requirements begin:
--
--   start_date  backfill: every period since the start date (the default)
--   today       go-forward: the current period onward; past periods are not created
--
-- The entry's own dates never change. recurring_series.requirements_from is a floor:
-- nothing before it is generated, even if the start date is later moved earlier.
-- =============================================================================

alter table public.recurring_series add column if not exists requirements_from date;

comment on column public.recurring_series.requirements_from is
  'Earliest date requirements may be generated from. Null means from start_date.';

-- Reads the choice from a payload for the rest of this transaction, so it reaches
-- create_node_requirement through the nested instantiate_* calls.
create or replace function public.apply_requirements_from(p_payload jsonb)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_choice text := coalesce(nullif(p_payload ->> 'requirements_from', ''), 'start_date');
begin
  if v_choice not in ('start_date', 'today') then
    raise exception 'Choose where to generate requirements from' using errcode = '23514';
  end if;
  perform set_config('app.requirements_from', v_choice, true);
end;
$$;
revoke execute on function public.apply_requirements_from(jsonb) from public, anon, authenticated;

create or replace function public.create_node_requirement(
  p_node public.template_nodes, p_folder uuid, p_instance uuid, p_dept uuid, p_owner uuid, p_uploader uuid,
  p_start date, p_end date, p_creator uuid
)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_rules jsonb;
  v_series uuid;
begin
  select coalesce(jsonb_agg(jsonb_build_object('rule', r.rule, 'user_id', r.user_id) order by r.step_order), '[]'::jsonb)
    into v_rules from public.template_node_reviewers r where r.node_id = p_node.id;

  if p_node.recurrence = 'once' then
    perform public.insert_requirement(
      p_folder, p_node.name, p_node.document_type_id, p_node.description, p_uploader,
      p_node.requires_review, public.resolve_reviewers(v_rules, p_dept, p_uploader, p_owner),
      case when p_node.due_mode = 'after_creation' then current_date + p_node.due_days end,
      p_creator, p_instance, p_node.id, null, null, null, null, null
    );
  else
    insert into public.recurring_series (
      instance_id, template_node_id, folder_id, department_id, name, document_type_id, description,
      recurrence, storage, create_offset_days, due_mode, due_days, uploader_id, requires_review,
      reviewer_rules, slot_owner_id, start_date, end_date, created_by, requirements_from
    ) values (
      p_instance, p_node.id, p_folder, p_dept, p_node.name, p_node.document_type_id, p_node.description,
      p_node.recurrence, p_node.storage, p_node.create_offset_days, p_node.due_mode, p_node.due_days, p_uploader, p_node.requires_review,
      v_rules, p_owner, p_start, p_end, p_creator,
      case when current_setting('app.requirements_from', true) = 'today' and p_start < current_date then current_date end
    ) returning id into v_series;
    perform public.generate_series_due(v_series, current_date);
  end if;
end;
$$;

-- Same as before, except generation never starts before requirements_from, and a
-- series whose floor is after its end date creates nothing.
create or replace function public.generate_series_due(p_series_id uuid, p_today date)
returns int language plpgsql security definer set search_path = public
as $$
declare
  s public.recurring_series;
  p record;
  v_status text;
  v_parent_end date;
  v_cursor date;
  v_folder uuid;
  v_uploader uuid;
  v_due date;
  v_doc uuid;
  v_created int := 0;
  v_guard int := 0;
begin
  select * into s from public.recurring_series where id = p_series_id for update;
  if not found or s.is_paused then
    return 0;
  end if;
  if s.instance_id is not null then
    select status, end_date into v_status, v_parent_end from public.template_instances where id = s.instance_id;
  else
    select status, end_date into v_status, v_parent_end from public.kpi_assignments where id = s.kpi_assignment_id;
  end if;
  if v_status is distinct from 'active' then
    return 0;
  end if;
  if s.requirements_from > s.end_date or s.requirements_from > v_parent_end then
    return 0;
  end if;

  v_cursor := greatest(coalesce(s.last_period_end + 1, s.start_date), s.requirements_from);
  loop
    v_guard := v_guard + 1;
    exit when v_guard > 400;
    select * into p from public.period_for(s.recurrence, v_cursor, coalesce(s.year_start_month, public.academic_year_start_month()));
    exit when p.period_start - s.create_offset_days > p_today;
    exit when s.end_date is not null and p.period_start > s.end_date;
    exit when v_parent_end is not null and p.period_start > v_parent_end;

    if not exists (select 1 from public.documents where series_id = s.id and period_key = p.period_key) then
      v_folder := s.folder_id;
      if s.storage in ('academic_year', 'academic_year_semester') then
        v_folder := public.ensure_child_folder(v_folder, p.ay_label, s.instance_id);
      end if;
      if s.storage = 'academic_year_semester' then
        v_folder := public.ensure_child_folder(v_folder, 'Semester ' || p.semester_no, s.instance_id);
      end if;

      v_uploader := s.uploader_id;
      if not exists (select 1 from public.profiles where id = v_uploader and is_active) then
        select head_user_id into v_uploader from public.departments where id = s.department_id;
      end if;

      if v_uploader is not null then
        v_due := case s.due_mode
          when 'period_end' then p.period_end + s.due_days
          when 'after_creation' then p_today + s.due_days
          else null
        end;
        v_doc := public.insert_requirement(
          v_folder, s.name || ' – ' || p.label, s.document_type_id, s.description, v_uploader,
          s.requires_review, public.resolve_reviewers(s.reviewer_rules, s.department_id, v_uploader, s.slot_owner_id),
          v_due, s.created_by, s.instance_id, s.template_node_id, s.id,
          p.period_key, p.label, p.period_start, p.period_end
        );
        if s.kpi_assignment_id is not null then
          update public.documents set kpi_assignment_id = s.kpi_assignment_id, kpi_assignment_item_id = s.kpi_assignment_item_id
           where id = v_doc;
        end if;
        v_created := v_created + 1;
      end if;
    end if;

    update public.recurring_series set last_period_end = p.period_end where id = s.id;
    v_cursor := p.period_end + 1;
  end loop;
  return v_created;
end;
$$;

-- Entry point: create an instance of a template inside a folder. All or nothing.
create or replace function public.instantiate_template(p_parent_folder uuid, p_template uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Kolkata'
as $$
declare
  f public.folders;
  t public.templates;
  v_start date := coalesce(nullif(p_payload ->> 'start_date', '')::date, current_date);
  v_end date := nullif(p_payload ->> 'end_date', '')::date;
  v_instance uuid;
begin
  select * into f from public.folders where id = p_parent_folder;
  if not found or not public.can_see_department(f.department_id) then
    raise exception 'Folder not found' using errcode = '23503';
  end if;
  if not (public.can_manage_folders(f.department_id) and public.can_create_documents(f.department_id)) then
    raise exception 'You do not have permission to create folders and documents in this department' using errcode = '42501';
  end if;
  if f.level <> 'root' and not f.allow_subfolders then
    raise exception 'Folder "%" does not allow sub-folders', f.name using errcode = '23514';
  end if;

  select * into t from public.templates where id = p_template;
  if not found or not t.is_active then
    raise exception 'Choose an active template' using errcode = '23514';
  end if;
  if t.department_ids is not null and not (f.department_id = any (t.department_ids)) then
    raise exception 'Template "%" is not available to this department', t.name using errcode = '42501';
  end if;
  if v_end is not null and v_end < v_start then
    raise exception 'The end date must be after the start date' using errcode = '23514';
  end if;

  perform public.apply_requirements_from(p_payload);
  v_instance := public.instantiate_entry(t.id, p_payload, p_parent_folder, null, null, v_start, v_end, auth.uid());
  return (select root_folder_id from public.template_instances where id = v_instance);
end;
$$;

-- Add one more entry (e.g. a subject) to a slot of an existing instance.
create or replace function public.add_slot_entry(p_instance uuid, p_slot_node uuid, p_entry jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Kolkata'
as $$
declare
  inst public.template_instances;
  n public.template_nodes;
  v_folder uuid;
  v_dept uuid;
  v_child uuid;
begin
  select * into inst from public.template_instances where id = p_instance;
  select * into n from public.template_nodes where id = p_slot_node and kind = 'slot' and template_id = inst.template_id;
  if inst.id is null or n.id is null then
    raise exception 'Slot not found' using errcode = '23503';
  end if;
  if inst.status <> 'active' then
    raise exception 'This instance is closed' using errcode = '23514';
  end if;

  -- The slot lives in the folder created for its parent node (or the instance root).
  if n.parent_id is null then
    v_folder := inst.root_folder_id;
  else
    select id into v_folder from public.folders where template_instance_id = p_instance and template_node_id = n.parent_id;
  end if;
  select department_id into v_dept from public.folders where id = v_folder;
  if v_folder is null then
    raise exception 'The folder for this slot no longer exists' using errcode = '23503';
  end if;
  if not (public.can_manage_folders(v_dept) and public.can_create_documents(v_dept)) then
    raise exception 'You do not have permission to create folders and documents in this department' using errcode = '42501';
  end if;

  perform public.apply_requirements_from(p_entry);
  v_child := public.instantiate_entry(n.slot_template_id, p_entry, v_folder, p_instance, n.id,
                                      case when n.slot_entry_dates then inst.start_date else greatest(inst.start_date, current_date) end,
                                      inst.end_date, auth.uid());
  return (select root_folder_id from public.template_instances where id = v_child);
end;
$$;
