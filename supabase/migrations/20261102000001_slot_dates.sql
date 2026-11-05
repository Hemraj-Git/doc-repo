-- =============================================================================
-- Slot entries with their own dates (e.g. each semester of a batch), editing an
-- instance's dates, and duplicating template nodes.
--
--   Batch (2020–2023) ─ slot "Semesters" (own dates) ─ 1st Semester  15 Jul – 30 Nov 2020
--                                                       └ slot "Subjects" ─ Navigation  ← inherits the semester's dates
-- Recurring files inside an entry run from its start date to its end date only.
-- =============================================================================

alter table public.template_nodes add column slot_entry_dates boolean not null default false;

create or replace function public.template_nodes_slot_dates()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.kind <> 'slot' then
    new.slot_entry_dates := false;
  end if;
  return new;
end;
$$;
create trigger template_nodes_slot_dates before insert or update on public.template_nodes
  for each row execute function public.template_nodes_slot_dates();
revoke execute on function public.template_nodes_slot_dates() from public, anon, authenticated;

-- Same as before, plus: an entry's own start_date / end_date (required when its slot
-- asks for dates) replace the dates inherited from the parent.
create or replace function public.instantiate_entry(
  p_template uuid, p_entry jsonb, p_parent_folder uuid, p_parent_instance uuid, p_slot_node uuid,
  p_start date, p_end date, p_creator uuid
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  t public.templates;
  v_root uuid;
  v_instance uuid;
  v_dept uuid;
  v_owner uuid := nullif(p_entry ->> 'owner_id', '')::uuid;
  v_name text := nullif(btrim(p_entry ->> 'name'), '');
  v_has_children boolean;
  v_needs_dates boolean := coalesce((select slot_entry_dates from public.template_nodes where id = p_slot_node), false);
  v_start date := coalesce(nullif(p_entry ->> 'start_date', '')::date, p_start);
  v_end date := case when nullif(p_entry ->> 'start_date', '') is not null or v_needs_dates
                     then nullif(p_entry ->> 'end_date', '')::date else p_end end;
begin
  select * into t from public.templates where id = p_template;
  if not found then
    raise exception 'Template not found' using errcode = '23503';
  end if;
  if v_name is null then
    raise exception 'Enter a % for every entry', lower(t.instance_label) using errcode = '23514';
  end if;
  if v_needs_dates and (nullif(p_entry ->> 'start_date', '') is null or nullif(p_entry ->> 'end_date', '') is null) then
    raise exception 'Enter the start and end date of "%"', v_name using errcode = '23514';
  end if;
  if v_end is not null and v_end < v_start then
    raise exception 'The end date of "%" must be after its start date', v_name using errcode = '23514';
  end if;
  if v_owner is not null and not exists (select 1 from public.profiles where id = v_owner and is_active) then
    raise exception 'The owner of "%" must be an active user', v_name using errcode = '23514';
  end if;

  select exists (select 1 from public.template_nodes where template_id = t.id and parent_id is null and kind in ('folder', 'slot'))
    into v_has_children;

  insert into public.folders (parent_id, department_id, level, name, reference_id, allow_subfolders, created_by)
  select p_parent_folder, f.department_id, 'sub', v_name, nullif(btrim(p_entry ->> 'reference_id'), ''),
         v_has_children or t.allow_extra_folders, p_creator
  from public.folders f where f.id = p_parent_folder
  returning id, department_id into v_root, v_dept;

  insert into public.template_instances (template_id, template_name, template_version, root_folder_id,
                                         parent_instance_id, slot_node_id, name, slot_owner_id, start_date, end_date, created_by)
  values (t.id, t.name, t.version, v_root, p_parent_instance, p_slot_node, v_name, v_owner, v_start, v_end, p_creator)
  returning id into v_instance;
  update public.folders set template_instance_id = v_instance where id = v_root;

  perform public.instantiate_nodes(t.id, null, v_root, v_instance, v_dept, v_owner, p_entry, v_start, v_end, p_creator);
  return v_instance;
end;
$$;

-- Corrects an instance's dates. Nested instances and recurring files that inherited
-- the old dates follow; ones with their own dates (e.g. each semester) keep them.
-- Moving the start earlier creates the periods that now fall inside it.
create or replace function public.set_instance_dates(p_instance uuid, p_start date, p_end date)
returns int language plpgsql security definer set search_path = public set timezone = 'Asia/Kolkata'
as $$
declare
  inst public.template_instances;
  v_dept uuid;
  v_ids uuid[];
  v_series uuid;
  v_created int := 0;
begin
  select * into inst from public.template_instances where id = p_instance for update;
  select department_id into v_dept from public.folders where id = inst.root_folder_id;
  if inst.id is null or not (public.can_manage_folders(v_dept) and public.can_create_documents(v_dept)) then
    raise exception 'You do not have permission to change this folder' using errcode = '42501';
  end if;
  if p_start is null then
    raise exception 'Enter the start date' using errcode = '23514';
  end if;
  if p_end is not null and p_end < p_start then
    raise exception 'The end date must be after the start date' using errcode = '23514';
  end if;

  with recursive tree as (
    select id from public.template_instances where id = p_instance
    union all
    select c.id from public.template_instances c join tree t on c.parent_instance_id = t.id
      where c.start_date = inst.start_date and c.end_date is not distinct from inst.end_date
  )
  select array_agg(id) into v_ids from tree;

  update public.template_instances set start_date = p_start, end_date = p_end where id = any (v_ids);

  update public.recurring_series
     set start_date = case when start_date = inst.start_date then p_start else start_date end,
         end_date = case when end_date is not distinct from inst.end_date then p_end else end_date end,
         last_period_end = case when p_start < inst.start_date and last_period_end is not null
                                then least(last_period_end, p_start - 1) else last_period_end end
   where instance_id = any (v_ids);

  if inst.status = 'active' then
    for v_series in select id from public.recurring_series where instance_id = any (v_ids) and not is_paused loop
      v_created := v_created + public.generate_series_due(v_series, current_date);
    end loop;
  end if;
  return v_created;
end;
$$;

-- One bump per bulk edit instead of one per row.
create or replace function public.templates_bump_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template uuid;
begin
  if coalesce(current_setting('app.template_bulk_edit', true), '') = 'on' then
    return null;
  end if;
  if tg_table_name = 'template_nodes' then
    v_template := coalesce(new.template_id, old.template_id);
  else
    select template_id into v_template from public.template_nodes where id = coalesce(new.node_id, old.node_id);
  end if;
  update public.templates set version = version + 1, updated_at = now() where id = v_template;
  return null;
end;
$$;

create or replace function public.copy_template_node(p_node uuid, p_parent uuid, p_name text, p_sort int)
returns uuid language plpgsql security invoker set search_path = public
as $$
declare
  n public.template_nodes;
  v_new uuid;
  c uuid;
begin
  select * into n from public.template_nodes where id = p_node;
  insert into public.template_nodes (
    template_id, parent_id, kind, sort_order, name, allow_subfolders, document_type_id, description, recurrence, storage,
    create_offset_days, due_mode, due_days, uploader_rule, fixed_uploader_id, requires_review, slot_template_id,
    slot_owner_label, slot_entry_dates
  ) values (
    n.template_id, p_parent, n.kind, p_sort, p_name, n.allow_subfolders, n.document_type_id, n.description, n.recurrence, n.storage,
    n.create_offset_days, n.due_mode, n.due_days, n.uploader_rule, n.fixed_uploader_id, n.requires_review, n.slot_template_id,
    n.slot_owner_label, n.slot_entry_dates
  ) returning id into v_new;
  insert into public.template_node_reviewers (node_id, step_order, rule, user_id)
  select v_new, step_order, rule, user_id from public.template_node_reviewers where node_id = p_node;
  for c in select id from public.template_nodes where parent_id = p_node order by sort_order, name loop
    perform public.copy_template_node(c, v_new, (select name from public.template_nodes where id = c),
                                      (select sort_order from public.template_nodes where id = c));
  end loop;
  return v_new;
end;
$$;

-- Copies a node with everything inside it, placed right after the original.
-- SECURITY INVOKER: template.manage is enforced by RLS.
create or replace function public.duplicate_template_node(p_node uuid)
returns uuid language plpgsql security invoker set search_path = public
as $$
declare
  n public.template_nodes;
  v_new uuid;
begin
  select * into n from public.template_nodes where id = p_node;
  if not found then
    raise exception 'Item not found' using errcode = '23503';
  end if;
  perform set_config('app.template_bulk_edit', 'on', true);
  update public.template_nodes set sort_order = sort_order + 1
   where template_id = n.template_id and parent_id is not distinct from n.parent_id and sort_order > n.sort_order;
  v_new := public.copy_template_node(p_node, n.parent_id, left(n.name, 110) || ' (copy)', n.sort_order + 1);
  perform set_config('app.template_bulk_edit', 'off', true);
  update public.templates set version = version + 1, updated_at = now() where id = n.template_id;
  return v_new;
end;
$$;

revoke execute on function public.set_instance_dates(uuid, date, date) from public, anon;
revoke execute on function public.copy_template_node(uuid, uuid, text, int) from public, anon;
revoke execute on function public.duplicate_template_node(uuid) from public, anon;
grant execute on function public.set_instance_dates(uuid, date, date) to authenticated;
grant execute on function public.duplicate_template_node(uuid) to authenticated;
grant execute on function public.copy_template_node(uuid, uuid, text, int) to authenticated;
