-- =============================================================================
-- Entries inside another entry may leave their dates blank.
--
--   Batch ─ slot "Semester" (own dates) ─ 1st Semester  15 Jul – 30 Nov   ← required
--                                          └ slot "Courses" (own dates) ─ Navigation  ← optional
--
-- A blank start or end date takes the value from the entry it sits inside.
-- Entries directly under the top-level instance (semesters) still need both.
-- =============================================================================

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
  v_needs_dates boolean :=
    coalesce((select slot_entry_dates from public.template_nodes where id = p_slot_node), false)
    and not exists (select 1 from public.template_instances where id = p_parent_instance and slot_node_id is not null);
  v_start date := coalesce(nullif(p_entry ->> 'start_date', '')::date, p_start);
  v_end date := coalesce(nullif(p_entry ->> 'end_date', '')::date, p_end);
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

-- Same as before, except a slot with its own dates falls back on the parent's actual
-- start date rather than today, so a course added mid-semester follows the semester
-- when its dates are left blank.
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

  v_child := public.instantiate_entry(n.slot_template_id, p_entry, v_folder, p_instance, n.id,
                                      case when n.slot_entry_dates then inst.start_date else greatest(inst.start_date, current_date) end,
                                      inst.end_date, auth.uid());
  return (select root_folder_id from public.template_instances where id = v_child);
end;
$$;
