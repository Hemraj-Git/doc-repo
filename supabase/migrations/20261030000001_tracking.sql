-- =============================================================================
-- Phase 7E: pushing template changes to existing instances, and recurring
-- compliance numbers for the dashboard.
-- =============================================================================

-- One document item of a template, created in an instance folder: a one-time
-- requirement, or a recurring series plus its current period(s).
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
      reviewer_rules, slot_owner_id, start_date, end_date, created_by
    ) values (
      p_instance, p_node.id, p_folder, p_dept, p_node.name, p_node.document_type_id, p_node.description,
      p_node.recurrence, p_node.storage, p_node.create_offset_days, p_node.due_mode, p_node.due_days, p_uploader, p_node.requires_review,
      v_rules, p_owner, p_start, p_end, p_creator
    ) returning id into v_series;
    perform public.generate_series_due(v_series, current_date);
  end if;
end;
$$;

-- Same behaviour as before; the document branch now goes through create_node_requirement.
create or replace function public.instantiate_nodes(
  p_template uuid, p_parent_node uuid, p_folder uuid, p_instance uuid, p_dept uuid, p_owner uuid,
  p_entry jsonb, p_start date, p_end date, p_creator uuid
)
returns void language plpgsql security definer set search_path = public
as $$
declare
  n public.template_nodes;
  t public.templates;
  v_folder uuid;
  v_uploader uuid;
  v_child_entry jsonb;
  v_has_children boolean;
begin
  select * into t from public.templates where id = p_template;

  for n in
    select * from public.template_nodes
    where template_id = p_template and parent_id is not distinct from p_parent_node
    order by sort_order, name
  loop
    if n.kind = 'folder' then
      select exists (select 1 from public.template_nodes where parent_id = n.id and kind in ('folder', 'slot')) into v_has_children;
      insert into public.folders (parent_id, department_id, level, name, allow_subfolders, template_instance_id, template_node_id, created_by)
      values (p_folder, p_dept, 'sub', n.name, n.allow_subfolders or v_has_children or t.allow_extra_folders, p_instance, n.id, p_creator)
      returning id into v_folder;
      perform public.instantiate_nodes(p_template, n.id, v_folder, p_instance, p_dept, p_owner, p_entry, p_start, p_end, p_creator);

    elsif n.kind = 'slot' then
      for v_child_entry in select * from jsonb_array_elements(coalesce(p_entry -> 'slots' -> n.id::text, '[]'::jsonb)) loop
        perform public.instantiate_entry(n.slot_template_id, v_child_entry, p_folder, p_instance, n.id, p_start, p_end, p_creator);
      end loop;

    else
      v_uploader := case n.uploader_rule
        when 'chosen' then nullif(p_entry -> 'uploaders' ->> n.id::text, '')::uuid
        when 'slot_owner' then p_owner
        when 'department_head' then (select head_user_id from public.departments where id = p_dept)
        when 'fixed' then n.fixed_uploader_id
      end;
      if v_uploader is null then
        raise exception 'Choose who uploads "%" in "%"', n.name, coalesce(p_entry ->> 'name', '')
          using errcode = '23514';
      end if;
      if not exists (select 1 from public.profiles where id = v_uploader and is_active) then
        raise exception 'The uploader of "%" must be an active user', n.name using errcode = '23514';
      end if;
      perform public.create_node_requirement(n, p_folder, p_instance, p_dept, p_owner, v_uploader, p_start, p_end, p_creator);
    end if;
  end loop;
end;
$$;

-- Adds the folders and document items of the template that an instance does not
-- have yet. Never removes or changes anything. Items whose uploader is "chosen"
-- go to the slot owner, else the department head (reassign later if needed).
create or replace function public.push_nodes(
  p_template uuid, p_parent_node uuid, p_folder uuid, p_instance uuid, p_dept uuid, p_owner uuid, p_start date, p_end date
)
returns int language plpgsql security definer set search_path = public
as $$
declare
  n public.template_nodes;
  t public.templates;
  v_folder uuid;
  v_uploader uuid;
  v_head uuid := (select head_user_id from public.departments where id = p_dept);
  v_added int := 0;
begin
  select * into t from public.templates where id = p_template;
  for n in
    select * from public.template_nodes
    where template_id = p_template and parent_id is not distinct from p_parent_node and kind <> 'slot'
    order by sort_order, name
  loop
    if n.kind = 'folder' then
      select id into v_folder from public.folders where template_instance_id = p_instance and template_node_id = n.id;
      if v_folder is null then
        update public.folders set allow_subfolders = true where id = p_folder and not allow_subfolders;
        insert into public.folders (parent_id, department_id, level, name, allow_subfolders, template_instance_id, template_node_id, created_by)
        values (p_folder, p_dept, 'sub', n.name, true, p_instance, n.id, public.current_actor())
        returning id into v_folder;
        v_added := v_added + 1;
      end if;
      v_added := v_added + public.push_nodes(p_template, n.id, v_folder, p_instance, p_dept, p_owner, p_start, p_end);

    elsif not exists (select 1 from public.documents where template_instance_id = p_instance and template_node_id = n.id)
          and not exists (select 1 from public.recurring_series where instance_id = p_instance and template_node_id = n.id) then
      v_uploader := case n.uploader_rule
        when 'chosen' then coalesce(p_owner, v_head)
        when 'slot_owner' then coalesce(p_owner, v_head)
        when 'department_head' then v_head
        when 'fixed' then n.fixed_uploader_id
      end;
      if v_uploader is not null and not exists (select 1 from public.profiles where id = v_uploader and is_active) then
        v_uploader := v_head;
      end if;
      if v_uploader is not null then
        perform public.create_node_requirement(n, p_folder, p_instance, p_dept, p_owner, v_uploader,
                                               greatest(p_start, current_date), p_end, public.current_actor());
        v_added := v_added + 1;
      end if;
    end if;
  end loop;
  return v_added;
end;
$$;

-- Returns how many folders and items were added.
create or replace function public.push_template_updates(p_instance uuid)
returns int language plpgsql security definer set search_path = public set timezone = 'Asia/Kolkata'
as $$
declare
  inst public.template_instances;
  t public.templates;
  v_dept uuid;
  v_added int;
begin
  if not public.has_perm('template.manage') then
    raise exception 'You do not have permission to update instances' using errcode = '42501';
  end if;
  select * into inst from public.template_instances where id = p_instance for update;
  select * into t from public.templates where id = inst.template_id;
  if inst.id is null or t.id is null then
    raise exception 'Instance not found' using errcode = '23503';
  end if;
  if inst.status <> 'active' then
    raise exception '"%" is closed', inst.name using errcode = '23514';
  end if;
  select department_id into v_dept from public.folders where id = inst.root_folder_id;

  v_added := public.push_nodes(t.id, null, inst.root_folder_id, inst.id, v_dept, inst.slot_owner_id, inst.start_date, inst.end_date);
  update public.template_instances set template_version = t.version where id = inst.id and template_version <> t.version;
  return v_added;
end;
$$;

-- Recurring requirements of a department for the current week and month.
create or replace function public.department_compliance(p_department_id uuid)
returns jsonb language sql stable security invoker set search_path = public
as $$
  with keys as (
    select (select period_key from public.period_for('weekly', public.institute_today())) as week_key,
           (select period_key from public.period_for('monthly', public.institute_today())) as month_key
  ),
  docs as (
    select d.status, d.due_date, s.recurrence, d.period_key
    from public.documents d join public.recurring_series s on s.id = d.series_id
    where d.department_id = p_department_id
  )
  select jsonb_build_object(
    'week', (select jsonb_build_object(
               'total', count(*),
               'done', count(*) filter (where status in ('approved', 'not_applicable')),
               'in_review', count(*) filter (where status = 'in_review'))
             from docs, keys where recurrence = 'weekly' and period_key = keys.week_key),
    'month', (select jsonb_build_object(
                'total', count(*),
                'done', count(*) filter (where status in ('approved', 'not_applicable')),
                'in_review', count(*) filter (where status = 'in_review'))
              from docs, keys where recurrence = 'monthly' and period_key = keys.month_key),
    'overdue', (select count(*) from docs
                where status in ('pending_upload', 'changes_requested') and due_date < public.institute_today())
  );
$$;

revoke execute on function public.create_node_requirement(public.template_nodes, uuid, uuid, uuid, uuid, uuid, date, date, uuid) from public, anon, authenticated;
revoke execute on function public.push_nodes(uuid, uuid, uuid, uuid, uuid, uuid, date, date) from public, anon, authenticated;
revoke execute on function public.push_template_updates(uuid) from public, anon;
revoke execute on function public.department_compliance(uuid) from public, anon;
grant execute on function public.push_template_updates(uuid) to authenticated;
grant execute on function public.department_compliance(uuid) to authenticated;
