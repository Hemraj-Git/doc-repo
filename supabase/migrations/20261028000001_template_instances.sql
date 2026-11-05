-- =============================================================================
-- Phase 7C: creating folders + requirements from templates; recurring series and
-- the period engine (the daily scheduler that drives it is added in 7D).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Instances and series
-- -----------------------------------------------------------------------------
create table public.template_instances (
  id                  uuid primary key default gen_random_uuid(),
  template_id         uuid references public.templates (id) on delete set null,
  template_name       text not null,
  template_version    int not null,
  root_folder_id      uuid not null unique references public.folders (id),
  parent_instance_id  uuid references public.template_instances (id),
  -- The slot (in the parent instance's template) this entry fills; not a FK so editing templates never breaks history.
  slot_node_id        uuid,
  name                text not null,
  slot_owner_id       uuid references public.profiles (id),
  start_date          date not null default current_date,
  end_date            date,
  status              text not null default 'active' check (status in ('active', 'closed')),
  created_by          uuid not null default auth.uid() references public.profiles (id),
  created_at          timestamptz not null default now(),
  constraint template_instances_dates check (end_date is null or end_date >= start_date)
);
create index template_instances_parent_idx on public.template_instances (parent_instance_id);

alter table public.folders
  add column template_instance_id uuid references public.template_instances (id),
  add column template_node_id uuid;
create index folders_template_instance_idx on public.folders (template_instance_id, template_node_id);

create table public.recurring_series (
  id                  uuid primary key default gen_random_uuid(),
  instance_id         uuid not null references public.template_instances (id),
  template_node_id    uuid,
  folder_id           uuid not null references public.folders (id),
  department_id       uuid not null references public.departments (id),
  name                text not null,
  document_type_id    uuid not null references public.document_types (id),
  description         text,
  recurrence          public.recurrence_kind not null check (recurrence <> 'once'),
  storage             public.period_storage not null,
  create_offset_days  int not null default 0,
  due_mode            public.due_mode not null,
  due_days            int not null,
  uploader_id         uuid not null references public.profiles (id),
  requires_review     boolean not null,
  -- Reviewer rules, resolved each period: [{ "rule": "department_head" | "fixed" | …, "user_id": … }]
  reviewer_rules      jsonb not null default '[]'::jsonb,
  slot_owner_id       uuid references public.profiles (id),
  start_date          date not null,
  end_date            date,
  is_paused           boolean not null default false,
  last_period_end     date,
  created_by          uuid not null references public.profiles (id),
  created_at          timestamptz not null default now()
);
create index recurring_series_instance_idx on public.recurring_series (instance_id);
create index recurring_series_active_idx on public.recurring_series (is_paused, last_period_end);

alter table public.documents
  add column template_instance_id uuid references public.template_instances (id),
  add column template_node_id uuid,
  add column series_id uuid references public.recurring_series (id),
  add column period_key text,
  add column period_label text,
  add column period_start date,
  add column period_end date;
create unique index documents_series_period_key on public.documents (series_id, period_key) where series_id is not null;
create index documents_instance_idx on public.documents (template_instance_id);

create trigger audit_template_instances after insert or update on public.template_instances
  for each row execute function public.audit_row_change('template_instance');
-- Only changes people make are audited (not the scheduler advancing last_period_end).
create trigger audit_recurring_series after insert or update of uploader_id, is_paused, end_date on public.recurring_series
  for each row execute function public.audit_row_change('recurring_series');

alter table public.template_instances enable row level security;
alter table public.recurring_series enable row level security;
create policy template_instances_select on public.template_instances
  for select to authenticated
  using (exists (select 1 from public.folders f where f.id = root_folder_id and public.can_see_department(f.department_id)));
create policy recurring_series_select on public.recurring_series
  for select to authenticated using (public.can_see_department(department_id));

-- -----------------------------------------------------------------------------
-- Period engine
-- -----------------------------------------------------------------------------
create or replace function public.academic_year_start_month()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select academic_year_start_month from public.institute_settings limit 1), 7);
$$;

-- Academic year containing p_date: its start, end and label ("2026–27").
create or replace function public.academic_year_of(p_date date, out ay_start date, out ay_end date, out ay_label text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m int := public.academic_year_start_month();
  y int := extract(year from p_date)::int - case when extract(month from p_date)::int < m then 1 else 0 end;
begin
  ay_start := make_date(y, m, 1);
  ay_end := (ay_start + interval '1 year' - interval '1 day')::date;
  ay_label := y::text || '–' || lpad(((y + 1) % 100)::text, 2, '0');
end;
$$;

-- "15–21 Jul 2026", "29 Jul – 4 Aug 2026", "29 Dec 2026 – 4 Jan 2027"
create or replace function public.date_range_label(p_start date, p_end date)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when extract(year from p_start) <> extract(year from p_end)
      then to_char(p_start, 'FMDD Mon YYYY') || ' – ' || to_char(p_end, 'FMDD Mon YYYY')
    when extract(month from p_start) <> extract(month from p_end)
      then to_char(p_start, 'FMDD Mon') || ' – ' || to_char(p_end, 'FMDD Mon YYYY')
    else to_char(p_start, 'FMDD') || '–' || to_char(p_end, 'FMDD Mon YYYY')
  end;
$$;

-- The period of kind p_kind containing p_date.
--   weekly        Mon–Sun; Week 1 is the week containing the academic year's first day
--   monthly       calendar month
--   semester      first / second six months of the academic year
--   academic_year twelve months from the start month
-- ay_label and semester_no say where the period is filed (by its start).
create or replace function public.period_for(
  p_kind public.recurrence_kind, p_date date,
  out period_key text, out label text, out period_start date, out period_end date,
  out ay_label text, out semester_no int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ay record;
  anchor date;
  w1 date;
  n int;
begin
  if p_kind = 'weekly' then
    period_start := p_date - (extract(isodow from p_date)::int - 1);
    period_end := period_start + 6;
    anchor := period_start + 3; -- the week belongs to the academic year of its Thursday
  elsif p_kind = 'monthly' then
    period_start := date_trunc('month', p_date)::date;
    period_end := (period_start + interval '1 month' - interval '1 day')::date;
    anchor := period_start;
  else
    anchor := p_date;
  end if;

  select * into ay from public.academic_year_of(anchor);
  ay_label := ay.ay_label;
  semester_no := case when anchor < (ay.ay_start + interval '6 months')::date then 1 else 2 end;

  if p_kind = 'weekly' then
    w1 := ay.ay_start - (extract(isodow from ay.ay_start)::int - 1);
    n := ((period_start - w1) / 7) + 1;
    period_key := ay.ay_label || '/W' || lpad(n::text, 2, '0');
    label := 'Week ' || n || ' (' || public.date_range_label(period_start, period_end) || ')';
  elsif p_kind = 'monthly' then
    period_key := to_char(period_start, 'YYYY-MM');
    label := to_char(period_start, 'FMMonth YYYY');
  elsif p_kind = 'semester' then
    period_start := (ay.ay_start + make_interval(months => (semester_no - 1) * 6))::date;
    period_end := (period_start + interval '6 months' - interval '1 day')::date;
    period_key := ay.ay_label || '/S' || semester_no;
    label := 'Semester ' || semester_no || ', ' || ay.ay_label;
  elsif p_kind = 'academic_year' then
    period_start := ay.ay_start;
    period_end := ay.ay_end;
    period_key := ay.ay_label;
    label := ay.ay_label;
  else
    raise exception 'Not a recurring kind: %', p_kind;
  end if;
end;
$$;

-- Find or create the folder `p_name` inside p_parent (letting the parent hold sub-folders).
create or replace function public.ensure_child_folder(p_parent uuid, p_name text, p_instance uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.folders where parent_id = p_parent and lower(name) = lower(p_name);
  if v_id is not null then
    return v_id;
  end if;
  update public.folders set allow_subfolders = true where id = p_parent and not allow_subfolders;
  insert into public.folders (parent_id, department_id, level, name, allow_subfolders, template_instance_id, created_by)
  select p_parent, f.department_id, 'sub', p_name, true, p_instance, public.current_actor()
  from public.folders f where f.id = p_parent
  returning id into v_id;
  return v_id;
end;
$$;

-- Resolve reviewer rules to people. Steps that resolve to nobody or to the uploader are skipped.
create or replace function public.resolve_reviewers(
  p_rules jsonb, p_department_id uuid, p_uploader uuid, p_slot_owner uuid
)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_user uuid;
  v_out uuid[] := '{}';
begin
  for r in select * from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) loop
    v_user := case r ->> 'rule'
      when 'fixed' then nullif(r ->> 'user_id', '')::uuid
      when 'department_head' then (select head_user_id from public.departments where id = p_department_id)
      when 'uploader_manager' then (select reports_to_id from public.profiles where id = p_uploader)
      when 'slot_owner_manager' then (select reports_to_id from public.profiles where id = p_slot_owner)
    end;
    if v_user is not null and v_user <> p_uploader and not (v_user = any (v_out))
       and exists (select 1 from public.profiles where id = v_user and is_active) then
      v_out := v_out || v_user;
    end if;
  end loop;
  return v_out;
end;
$$;

-- Insert a requirement on behalf of the system (permission checks happen in the callers).
create or replace function public.insert_requirement(
  p_folder uuid, p_name text, p_type uuid, p_description text, p_uploader uuid,
  p_requires_review boolean, p_reviewers uuid[], p_due date, p_created_by uuid,
  p_instance uuid, p_node uuid, p_series uuid,
  p_period_key text, p_period_label text, p_period_start date, p_period_end date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_review boolean := p_requires_review and coalesce(array_length(p_reviewers, 1), 0) > 0;
begin
  insert into public.documents (
    folder_id, department_id, name, document_type_id, description, assigned_uploader_id, requires_review,
    due_date, created_by, template_instance_id, template_node_id, series_id,
    period_key, period_label, period_start, period_end
  )
  select p_folder, f.department_id, p_name, p_type, nullif(btrim(p_description), ''), p_uploader, v_review,
         p_due, p_created_by, p_instance, p_node, p_series,
         p_period_key, p_period_label, p_period_start, p_period_end
  from public.folders f where f.id = p_folder
  returning id into v_id;

  if v_review then
    perform public.set_document_reviewers(v_id, p_uploader, p_reviewers);
  end if;
  perform public.notify(p_uploader, 'upload_requested', 'Upload requested: ' || p_name,
                        'You have been asked to upload this document.', v_id);
  return v_id;
end;
$$;

-- Create every period of a series that is due by p_today and not created yet.
-- Never back-fills: the first period is the one containing the series' start date.
create or replace function public.generate_series_due(p_series_id uuid, p_today date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.recurring_series;
  inst public.template_instances;
  p record;
  v_cursor date;
  v_folder uuid;
  v_uploader uuid;
  v_due date;
  v_created int := 0;
  v_guard int := 0;
begin
  select * into s from public.recurring_series where id = p_series_id for update;
  if not found or s.is_paused then
    return 0;
  end if;
  select * into inst from public.template_instances where id = s.instance_id;
  if inst.status <> 'active' then
    return 0;
  end if;

  v_cursor := coalesce(s.last_period_end + 1, s.start_date);
  loop
    v_guard := v_guard + 1;
    exit when v_guard > 400;
    select * into p from public.period_for(s.recurrence, v_cursor);
    exit when p.period_start - s.create_offset_days > p_today;
    exit when s.end_date is not null and p.period_start > s.end_date;
    exit when inst.end_date is not null and p.period_start > inst.end_date;

    if not exists (select 1 from public.documents where series_id = s.id and period_key = p.period_key) then
      v_folder := s.folder_id;
      if s.storage in ('academic_year', 'academic_year_semester') then
        v_folder := public.ensure_child_folder(v_folder, p.ay_label, s.instance_id);
      end if;
      if s.storage = 'academic_year_semester' then
        v_folder := public.ensure_child_folder(v_folder, 'Semester ' || p.semester_no, s.instance_id);
      end if;

      -- An inactive uploader falls back to the head of the department.
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
        perform public.insert_requirement(
          v_folder, s.name || ' – ' || p.label, s.document_type_id, s.description, v_uploader,
          s.requires_review, public.resolve_reviewers(s.reviewer_rules, s.department_id, v_uploader, s.slot_owner_id),
          v_due, s.created_by, s.instance_id, s.template_node_id, s.id,
          p.period_key, p.label, p.period_start, p.period_end
        );
        v_created := v_created + 1;
      end if;
    end if;

    update public.recurring_series set last_period_end = p.period_end where id = s.id;
    v_cursor := p.period_end + 1;
  end loop;
  return v_created;
end;
$$;

-- -----------------------------------------------------------------------------
-- Instantiation
-- -----------------------------------------------------------------------------
-- Builds one instance of p_template under p_parent_folder from p_entry:
--   { name, reference_id?, start_date?, end_date?, owner_id?,
--     uploaders: { <node id>: <user id> },
--     slots: { <slot node id>: [ <entry>, … ] } }
create or replace function public.instantiate_entry(
  p_template uuid, p_entry jsonb, p_parent_folder uuid, p_parent_instance uuid, p_slot_node uuid,
  p_start date, p_end date, p_creator uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.templates;
  v_root uuid;
  v_instance uuid;
  v_dept uuid;
  v_owner uuid := nullif(p_entry ->> 'owner_id', '')::uuid;
  v_name text := nullif(btrim(p_entry ->> 'name'), '');
  v_has_children boolean;
begin
  select * into t from public.templates where id = p_template;
  if not found then
    raise exception 'Template not found' using errcode = '23503';
  end if;
  if v_name is null then
    raise exception 'Enter a % for every entry', lower(t.instance_label) using errcode = '23514';
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
  values (t.id, t.name, t.version, v_root, p_parent_instance, p_slot_node, v_name, v_owner, p_start, p_end, p_creator)
  returning id into v_instance;
  update public.folders set template_instance_id = v_instance where id = v_root;

  perform public.instantiate_nodes(t.id, null, v_root, v_instance, v_dept, v_owner, p_entry, p_start, p_end, p_creator);
  return v_instance;
end;
$$;

create or replace function public.instantiate_nodes(
  p_template uuid, p_parent_node uuid, p_folder uuid, p_instance uuid, p_dept uuid, p_owner uuid,
  p_entry jsonb, p_start date, p_end date, p_creator uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n public.template_nodes;
  t public.templates;
  v_folder uuid;
  v_uploader uuid;
  v_rules jsonb;
  v_series uuid;
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

    else -- document item
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

      select coalesce(jsonb_agg(jsonb_build_object('rule', r.rule, 'user_id', r.user_id) order by r.step_order), '[]'::jsonb)
        into v_rules from public.template_node_reviewers r where r.node_id = n.id;

      if n.recurrence = 'once' then
        perform public.insert_requirement(
          p_folder, n.name, n.document_type_id, n.description, v_uploader,
          n.requires_review, public.resolve_reviewers(v_rules, p_dept, v_uploader, p_owner),
          case when n.due_mode = 'after_creation' then current_date + n.due_days end,
          p_creator, p_instance, n.id, null, null, null, null, null
        );
      else
        insert into public.recurring_series (
          instance_id, template_node_id, folder_id, department_id, name, document_type_id, description,
          recurrence, storage, create_offset_days, due_mode, due_days, uploader_id, requires_review,
          reviewer_rules, slot_owner_id, start_date, end_date, created_by
        ) values (
          p_instance, n.id, p_folder, p_dept, n.name, n.document_type_id, n.description,
          n.recurrence, n.storage, n.create_offset_days, n.due_mode, n.due_days, v_uploader, n.requires_review,
          v_rules, p_owner, p_start, p_end, p_creator
        ) returning id into v_series;
        perform public.generate_series_due(v_series, current_date);
      end if;
    end if;
  end loop;
end;
$$;

-- Entry point: create an instance of a template inside a folder. All or nothing.
create or replace function public.instantiate_template(p_parent_folder uuid, p_template uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
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
                                      greatest(inst.start_date, current_date), inst.end_date, auth.uid());
  return (select root_folder_id from public.template_instances where id = v_child);
end;
$$;

-- Change who uploads a series from now on; optionally move its open requirements too.
create or replace function public.reassign_series(p_series uuid, p_uploader uuid, p_reassign_open boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.recurring_series;
  d record;
begin
  select * into s from public.recurring_series where id = p_series for update;
  if not found or not public.can_create_documents(s.department_id) then
    raise exception 'You do not have permission to change this series' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_uploader and is_active) then
    raise exception 'The uploader must be an active user' using errcode = '23514';
  end if;

  update public.recurring_series set uploader_id = p_uploader where id = p_series;

  if p_reassign_open then
    for d in
      select id, name from public.documents
      where series_id = p_series and status::text in ('pending_upload', 'changes_requested') and assigned_uploader_id <> p_uploader
    loop
      -- The new uploader may not also be a reviewer of that document.
      delete from public.document_reviewers where document_id = d.id and reviewer_id = p_uploader;
      update public.documents set assigned_uploader_id = p_uploader where id = d.id;
      perform public.notify(p_uploader, 'upload_requested', 'Upload requested: ' || d.name,
                            'You have been asked to upload this document.', d.id);
    end loop;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants: internal helpers are not callable by clients.
-- -----------------------------------------------------------------------------
revoke execute on function public.academic_year_start_month() from public, anon;
revoke execute on function public.academic_year_of(date) from public, anon;
revoke execute on function public.period_for(public.recurrence_kind, date) from public, anon;
revoke execute on function public.ensure_child_folder(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.resolve_reviewers(jsonb, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.insert_requirement(uuid, text, uuid, text, uuid, boolean, uuid[], date, uuid, uuid, uuid, uuid, text, text, date, date) from public, anon, authenticated;
revoke execute on function public.generate_series_due(uuid, date) from public, anon, authenticated;
revoke execute on function public.instantiate_entry(uuid, jsonb, uuid, uuid, uuid, date, date, uuid) from public, anon, authenticated;
revoke execute on function public.instantiate_nodes(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, date, date, uuid) from public, anon, authenticated;
revoke execute on function public.instantiate_template(uuid, uuid, jsonb) from public, anon;
revoke execute on function public.add_slot_entry(uuid, uuid, jsonb) from public, anon;
revoke execute on function public.reassign_series(uuid, uuid, boolean) from public, anon;

grant execute on function public.academic_year_start_month() to authenticated;
grant execute on function public.academic_year_of(date) to authenticated;
grant execute on function public.period_for(public.recurrence_kind, date) to authenticated;
grant execute on function public.instantiate_template(uuid, uuid, jsonb) to authenticated;
grant execute on function public.add_slot_entry(uuid, uuid, jsonb) to authenticated;
grant execute on function public.reassign_series(uuid, uuid, boolean) to authenticated;
grant execute on function public.generate_series_due(uuid, date) to service_role;

-- Audit rows for instances and series carry their department (for filtering and links).
create or replace function public.audit_fill_document_department()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.department_id is null and new.entity_id ~ '^[0-9a-f-]{36}$' then
    if new.entity_type in ('document_version', 'document_reviewer', 'document_review') then
      select department_id into new.department_id from public.documents where id = new.entity_id::uuid;
    elsif new.entity_type = 'template_instance' then
      select f.department_id into new.department_id
      from public.template_instances i join public.folders f on f.id = i.root_folder_id
      where i.id = new.entity_id::uuid;
    end if;
  end if;
  return new;
end;
$$;
