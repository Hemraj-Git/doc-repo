-- =============================================================================
-- Phase 9: KPIs with evidence.
--
--   KPI (e.g. "Faculty KPI", year starts in April)
--   └─ Areas, weightage % (total 100)
--      └─ Evidence items: once / weekly / monthly / quarterly / half-yearly / yearly, reviewer chain
--
-- Assigning a KPI to a person snapshots its areas and items, then creates the evidence
-- as ordinary document requirements (upload, versions, review, tasks, audit) using the
-- Phase 7 recurring series and daily scheduler. KPI evidence is private: see
-- can_view_kpi_assignment(). No rating — the record is what was due, uploaded and approved.
-- =============================================================================

insert into public.permissions (key, description, category, sort_order) values
  ('kpi.manage',          'Create and edit KPIs (areas, weightage, evidence)',          'KPIs', 190),
  ('kpi.assign.own_dept', 'Assign, end and renew KPIs for people in own department',    'KPIs', 192),
  ('kpi.assign.any_dept', 'Assign, end and renew KPIs for people in any department',    'KPIs', 194),
  ('kpi.view_all',        'View everyone''s KPI records and evidence',                  'KPIs', 196)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- Period engine: any year start month, plus quarters and halves
-- -----------------------------------------------------------------------------
create or replace function public.year_of(p_date date, p_start_month int, out y_start date, out y_end date, out y_label text)
language plpgsql immutable set search_path = public
as $$
declare
  y int := extract(year from p_date)::int - case when extract(month from p_date)::int < p_start_month then 1 else 0 end;
begin
  y_start := make_date(y, p_start_month, 1);
  y_end := (y_start + interval '1 year' - interval '1 day')::date;
  y_label := case when p_start_month = 1 then y::text else y::text || '–' || lpad(((y + 1) % 100)::text, 2, '0') end;
end;
$$;

create or replace function public.month_range_label(p_start date, p_end date)
returns text language sql immutable set search_path = public
as $$
  select case
    when extract(year from p_start) = extract(year from p_end) then to_char(p_start, 'FMMon') || '–' || to_char(p_end, 'FMMon YYYY')
    else to_char(p_start, 'FMMon YYYY') || ' – ' || to_char(p_end, 'FMMon YYYY')
  end;
$$;

create or replace function public.period_for(
  p_kind public.recurrence_kind, p_date date, p_start_month int,
  out period_key text, out label text, out period_start date, out period_end date,
  out ay_label text, out semester_no int
)
language plpgsql stable security definer set search_path = public
as $$
declare
  yr record;
  anchor date;
  w1 date;
  n int;
  months int;
begin
  if p_kind::text = 'weekly' then
    period_start := p_date - (extract(isodow from p_date)::int - 1);
    period_end := period_start + 6;
    anchor := period_start + 3;
  elsif p_kind::text = 'monthly' then
    period_start := date_trunc('month', p_date)::date;
    period_end := (period_start + interval '1 month' - interval '1 day')::date;
    anchor := period_start;
  else
    anchor := p_date;
  end if;

  select * into yr from public.year_of(anchor, p_start_month);
  ay_label := yr.y_label;
  months := ((extract(year from anchor) - extract(year from yr.y_start)) * 12 + extract(month from anchor) - extract(month from yr.y_start))::int;
  semester_no := case when months < 6 then 1 else 2 end;

  if p_kind::text = 'weekly' then
    w1 := yr.y_start - (extract(isodow from yr.y_start)::int - 1);
    n := ((period_start - w1) / 7) + 1;
    period_key := yr.y_label || '/W' || lpad(n::text, 2, '0');
    label := 'Week ' || n || ' (' || public.date_range_label(period_start, period_end) || ')';
  elsif p_kind::text = 'monthly' then
    period_key := to_char(period_start, 'YYYY-MM');
    label := to_char(period_start, 'FMMonth YYYY');
  elsif p_kind::text = 'semester' then
    period_start := (yr.y_start + make_interval(months => (semester_no - 1) * 6))::date;
    period_end := (period_start + interval '6 months' - interval '1 day')::date;
    period_key := yr.y_label || '/S' || semester_no;
    label := 'Semester ' || semester_no || ', ' || yr.y_label;
  elsif p_kind::text = 'quarterly' then
    n := months / 3 + 1;
    period_start := (yr.y_start + make_interval(months => (n - 1) * 3))::date;
    period_end := (period_start + interval '3 months' - interval '1 day')::date;
    period_key := yr.y_label || '/Q' || n;
    label := 'Q' || n || ' ' || yr.y_label || ' (' || public.month_range_label(period_start, period_end) || ')';
  elsif p_kind::text = 'half_yearly' then
    n := semester_no;
    period_start := (yr.y_start + make_interval(months => (n - 1) * 6))::date;
    period_end := (period_start + interval '6 months' - interval '1 day')::date;
    period_key := yr.y_label || '/H' || n;
    label := 'H' || n || ' ' || yr.y_label || ' (' || public.month_range_label(period_start, period_end) || ')';
  elsif p_kind::text = 'academic_year' then
    period_start := yr.y_start;
    period_end := yr.y_end;
    period_key := yr.y_label;
    label := yr.y_label;
  else
    raise exception 'Not a recurring kind: %', p_kind;
  end if;
end;
$$;

-- Templates keep following the institute's academic year.
create or replace function public.period_for(
  p_kind public.recurrence_kind, p_date date,
  out period_key text, out label text, out period_start date, out period_end date,
  out ay_label text, out semester_no int
)
language sql stable security definer set search_path = public
as $$
  select * from public.period_for(p_kind, p_date, public.academic_year_start_month());
$$;

-- -----------------------------------------------------------------------------
-- KPI definitions
-- -----------------------------------------------------------------------------
create table public.kpis (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  designation       text,
  description       text,
  year_start_month  int not null default 4 check (year_start_month between 1 and 12),
  is_active         boolean not null default false,
  version           int not null default 1,
  created_by        uuid default auth.uid() references public.profiles (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint kpis_name_key unique (name)
);

create table public.kpi_areas (
  id           uuid primary key default gen_random_uuid(),
  kpi_id       uuid not null references public.kpis (id) on delete cascade,
  name         text not null check (btrim(name) <> '' and char_length(name) <= 120),
  weightage    numeric(5, 2) not null check (weightage > 0 and weightage <= 100),
  description  text,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  constraint kpi_areas_name_key unique (kpi_id, name)
);
create index kpi_areas_kpi_idx on public.kpi_areas (kpi_id, sort_order);

create table public.kpi_evidence_items (
  id                  uuid primary key default gen_random_uuid(),
  kpi_id              uuid not null references public.kpis (id) on delete cascade,
  area_id             uuid not null references public.kpi_areas (id) on delete cascade,
  name                text not null,
  document_type_id    uuid not null references public.document_types (id),
  instructions        text,
  recurrence          public.recurrence_kind not null default 'once',
  create_offset_days  int not null default 0 check (create_offset_days between 0 and 60),
  due_mode            public.due_mode not null default 'after_creation',
  due_days            int not null default 7 check (due_days between 0 and 365),
  requires_review     boolean not null default true,
  sort_order          int not null default 0,
  created_at          timestamptz not null default now(),
  constraint kpi_evidence_items_kind check (recurrence::text <> 'semester')
);
create index kpi_evidence_items_area_idx on public.kpi_evidence_items (area_id, sort_order);
create index kpi_evidence_items_kpi_idx on public.kpi_evidence_items (kpi_id);
create index kpi_evidence_items_type_idx on public.kpi_evidence_items (document_type_id);

create table public.kpi_evidence_reviewers (
  item_id     uuid not null references public.kpi_evidence_items (id) on delete cascade,
  step_order  int not null,
  rule        public.reviewer_rule not null,
  user_id     uuid references public.profiles (id),
  primary key (item_id, step_order),
  constraint kpi_evidence_reviewers_rule check (rule::text in ('fixed', 'department_head', 'uploader_manager')),
  constraint kpi_evidence_reviewers_fixed check ((rule::text = 'fixed') = (user_id is not null))
);
create index kpi_evidence_reviewers_user_idx on public.kpi_evidence_reviewers (user_id);

create or replace function public.kpi_items_prepare()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.name := btrim(new.name);
  new.instructions := nullif(btrim(new.instructions), '');
  select kpi_id into new.kpi_id from public.kpi_areas where id = new.area_id;
  if new.recurrence::text = 'once' then
    new.create_offset_days := 0;
  end if;
  return new;
end;
$$;
create trigger kpi_items_prepare before insert or update on public.kpi_evidence_items
  for each row execute function public.kpi_items_prepare();

-- Activating needs areas totalling exactly 100% and at least one evidence item in each.
create or replace function public.kpis_prepare()
returns trigger language plpgsql set search_path = public
as $$
declare
  v_total numeric;
  v_empty text;
begin
  new.name := btrim(new.name);
  new.designation := nullif(btrim(new.designation), '');
  new.description := nullif(btrim(new.description), '');
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  if new.is_active and (tg_op = 'INSERT' or not old.is_active) then
    select coalesce(sum(weightage), 0) into v_total from public.kpi_areas where kpi_id = new.id;
    if v_total <> 100 then
      raise exception 'The area weightages must total 100%% (now %)', v_total::text || '%' using errcode = '23514';
    end if;
    select a.name into v_empty from public.kpi_areas a
    where a.kpi_id = new.id and not exists (select 1 from public.kpi_evidence_items i where i.area_id = a.id)
    limit 1;
    if v_empty is not null then
      raise exception 'Add at least one evidence item to "%"', v_empty using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger kpis_prepare before insert or update on public.kpis
  for each row execute function public.kpis_prepare();

-- Structural edits bump the version (assignments keep the version they were made from).
create or replace function public.kpis_bump_version()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_kpi uuid;
begin
  if coalesce(current_setting('app.kpi_bulk_edit', true), '') = 'on' then
    return null;
  end if;
  if tg_table_name = 'kpi_evidence_reviewers' then
    select kpi_id into v_kpi from public.kpi_evidence_items where id = coalesce(new.item_id, old.item_id);
  else
    v_kpi := coalesce(new.kpi_id, old.kpi_id);
  end if;
  update public.kpis set version = version + 1 where id = v_kpi;
  return null;
end;
$$;
create trigger kpi_areas_bump_version after insert or update or delete on public.kpi_areas
  for each row execute function public.kpis_bump_version();
create trigger kpi_items_bump_version after insert or update or delete on public.kpi_evidence_items
  for each row execute function public.kpis_bump_version();
create trigger kpi_reviewers_bump_version after insert or update or delete on public.kpi_evidence_reviewers
  for each row execute function public.kpis_bump_version();

create trigger audit_kpis after insert or update or delete on public.kpis
  for each row execute function public.audit_row_change('kpi');
create trigger audit_kpi_areas after insert or update or delete on public.kpi_areas
  for each row execute function public.audit_row_change('kpi_area');
create trigger audit_kpi_items after insert or update or delete on public.kpi_evidence_items
  for each row execute function public.audit_row_change('kpi_item');

alter table public.kpis enable row level security;
alter table public.kpi_areas enable row level security;
alter table public.kpi_evidence_items enable row level security;
alter table public.kpi_evidence_reviewers enable row level security;
do $$
declare
  t text;
begin
  foreach t in array array['kpis', 'kpi_areas', 'kpi_evidence_items', 'kpi_evidence_reviewers'] loop
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.has_perm(''kpi.manage'')))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.has_perm(''kpi.manage''))) with check ((select public.has_perm(''kpi.manage'')))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.has_perm(''kpi.manage'')))', t || '_delete', t);
  end loop;
end;
$$;

-- "Senior Faculty KPI" from "Faculty KPI": same areas, items and reviewers, inactive.
create or replace function public.duplicate_kpi(p_kpi uuid)
returns uuid language plpgsql security invoker set search_path = public
as $$
declare
  k public.kpis;
  a public.kpi_areas;
  i public.kpi_evidence_items;
  v_new uuid;
  v_area uuid;
  v_item uuid;
  v_name text;
  n int := 1;
begin
  select * into k from public.kpis where id = p_kpi;
  if not found then
    raise exception 'KPI not found' using errcode = '23503';
  end if;
  v_name := left(k.name, 110) || ' (copy)';
  while exists (select 1 from public.kpis where name = v_name) loop
    n := n + 1;
    v_name := left(k.name, 110) || ' (copy ' || n || ')';
  end loop;
  perform set_config('app.kpi_bulk_edit', 'on', true);
  insert into public.kpis (name, designation, description, year_start_month)
  values (v_name, k.designation, k.description, k.year_start_month) returning id into v_new;
  for a in select * from public.kpi_areas where kpi_id = p_kpi order by sort_order, name loop
    insert into public.kpi_areas (kpi_id, name, weightage, description, sort_order)
    values (v_new, a.name, a.weightage, a.description, a.sort_order) returning id into v_area;
    for i in select * from public.kpi_evidence_items where area_id = a.id order by sort_order, name loop
      insert into public.kpi_evidence_items (area_id, kpi_id, name, document_type_id, instructions, recurrence, create_offset_days,
                                             due_mode, due_days, requires_review, sort_order)
      values (v_area, v_new, i.name, i.document_type_id, i.instructions, i.recurrence, i.create_offset_days,
              i.due_mode, i.due_days, i.requires_review, i.sort_order)
      returning id into v_item;
      insert into public.kpi_evidence_reviewers (item_id, step_order, rule, user_id)
      select v_item, step_order, rule, user_id from public.kpi_evidence_reviewers where item_id = i.id;
    end loop;
  end loop;
  perform set_config('app.kpi_bulk_edit', 'off', true);
  return v_new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Assignments (snapshots of a KPI for one person and period)
-- -----------------------------------------------------------------------------
create table public.kpi_assignments (
  id                uuid primary key default gen_random_uuid(),
  kpi_id            uuid references public.kpis (id) on delete set null,
  kpi_name          text not null,
  kpi_version       int not null,
  year_start_month  int not null,
  user_id           uuid not null references public.profiles (id),
  department_id     uuid not null references public.departments (id),
  start_date        date not null,
  end_date          date not null,
  status            text not null default 'active' check (status in ('active', 'ended')),
  reviewer_ids      uuid[],
  folder_id         uuid,
  assigned_by       uuid references public.profiles (id),
  created_at        timestamptz not null default now(),
  constraint kpi_assignments_dates check (end_date >= start_date)
);
create index kpi_assignments_user_idx on public.kpi_assignments (user_id, status);
create index kpi_assignments_kpi_idx on public.kpi_assignments (kpi_id, status);
create index kpi_assignments_department_idx on public.kpi_assignments (department_id);
create index kpi_assignments_assigned_by_idx on public.kpi_assignments (assigned_by);

create table public.kpi_assignment_areas (
  id              uuid primary key default gen_random_uuid(),
  assignment_id   uuid not null references public.kpi_assignments (id),
  source_area_id  uuid references public.kpi_areas (id) on delete set null,
  name            text not null,
  weightage       numeric(5, 2) not null,
  sort_order      int not null default 0,
  folder_id       uuid
);
create index kpi_assignment_areas_assignment_idx on public.kpi_assignment_areas (assignment_id, sort_order);
create index kpi_assignment_areas_source_idx on public.kpi_assignment_areas (source_area_id);

create table public.kpi_assignment_items (
  id                  uuid primary key default gen_random_uuid(),
  assignment_id       uuid not null references public.kpi_assignments (id),
  assignment_area_id  uuid not null references public.kpi_assignment_areas (id),
  source_item_id      uuid references public.kpi_evidence_items (id) on delete set null,
  name                text not null,
  recurrence          public.recurrence_kind not null,
  sort_order          int not null default 0,
  series_id           uuid references public.recurring_series (id),
  document_id         uuid references public.documents (id)
);
create index kpi_assignment_items_assignment_idx on public.kpi_assignment_items (assignment_id);
create index kpi_assignment_items_area_idx on public.kpi_assignment_items (assignment_area_id, sort_order);
create index kpi_assignment_items_source_idx on public.kpi_assignment_items (source_item_id);
create index kpi_assignment_items_series_idx on public.kpi_assignment_items (series_id);
create index kpi_assignment_items_document_idx on public.kpi_assignment_items (document_id);

create trigger audit_kpi_assignments after insert or update on public.kpi_assignments
  for each row execute function public.audit_row_change('kpi_assignment');

-- Folders, documents and series learn about KPIs.
alter table public.folders
  add column is_private boolean not null default false,
  add column kpi_assignment_id uuid references public.kpi_assignments (id);
create index folders_kpi_assignment_idx on public.folders (kpi_assignment_id) where kpi_assignment_id is not null;
alter table public.kpi_assignments add constraint kpi_assignments_folder_fkey foreign key (folder_id) references public.folders (id);
alter table public.kpi_assignment_areas add constraint kpi_assignment_areas_folder_fkey foreign key (folder_id) references public.folders (id);
create index kpi_assignments_folder_idx on public.kpi_assignments (folder_id);
create index kpi_assignment_areas_folder_idx on public.kpi_assignment_areas (folder_id);

alter table public.documents
  add column is_private boolean not null default false,
  add column kpi_assignment_id uuid references public.kpi_assignments (id),
  add column kpi_assignment_item_id uuid references public.kpi_assignment_items (id);
create index documents_kpi_assignment_idx on public.documents (kpi_assignment_id) where kpi_assignment_id is not null;
create index documents_kpi_item_idx on public.documents (kpi_assignment_item_id) where kpi_assignment_item_id is not null;

alter table public.recurring_series alter column instance_id drop not null;
alter table public.recurring_series
  add column kpi_assignment_id uuid references public.kpi_assignments (id),
  add column kpi_assignment_item_id uuid references public.kpi_assignment_items (id),
  add column year_start_month int check (year_start_month between 1 and 12),
  add constraint recurring_series_one_parent check (num_nonnulls(instance_id, kpi_assignment_id) = 1);
create index recurring_series_kpi_assignment_idx on public.recurring_series (kpi_assignment_id) where kpi_assignment_id is not null;
create index recurring_series_kpi_item_idx on public.recurring_series (kpi_assignment_item_id) where kpi_assignment_item_id is not null;

-- Documents inherit privacy from their folder.
create or replace function public.documents_prepare()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder public.folders;
begin
  if tg_op = 'UPDATE' and new.folder_id <> old.folder_id then
    raise exception 'Documents cannot be moved to another folder' using errcode = '23514';
  end if;

  select * into v_folder from public.folders where id = new.folder_id;
  if not found then
    raise exception 'Folder not found' using errcode = '23503';
  end if;
  new.department_id := v_folder.department_id;
  new.is_private := v_folder.is_private;
  new.kpi_assignment_id := coalesce(new.kpi_assignment_id, v_folder.kpi_assignment_id);
  new.name := btrim(new.name);
  new.reference_id := nullif(btrim(new.reference_id), '');

  -- Standalone documents (directly in a department) must have a Ref ID; elsewhere it is optional.
  if v_folder.level = 'root' and new.reference_id is null then
    raise exception 'Standalone documents need a Reference ID' using errcode = '23514';
  end if;
  if new.reference_id is not null and new.reference_id !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$' then
    raise exception 'Reference ID may only contain letters, digits, ".", "_", "/" and "-" (max 60 characters)'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Who may see / manage an assignment
-- -----------------------------------------------------------------------------
create or replace function public.can_assign_kpis(p_department_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.has_perm('kpi.assign.any_dept')
      or (public.has_perm('kpi.assign.own_dept') and p_department_id = public.my_dept());
$$;

-- The person, whoever assigned it, people above them, their reviewers, HR / Quality.
create or replace function public.can_view_kpi_assignment(p_assignment_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.kpi_assignments a
    where a.id = p_assignment_id
      and (a.user_id = auth.uid()
           or a.assigned_by = auth.uid()
           or public.has_perm('kpi.view_all')
           or public.can_assign_kpis(a.department_id)
           or public.is_below_me(a.user_id)
           or exists (select 1 from public.documents d join public.document_reviewers r on r.document_id = d.id
                      where d.kpi_assignment_id = a.id and r.reviewer_id = auth.uid()))
  );
$$;

alter table public.kpi_assignments enable row level security;
alter table public.kpi_assignment_areas enable row level security;
alter table public.kpi_assignment_items enable row level security;
create policy kpi_assignments_select on public.kpi_assignments
  for select to authenticated using ((select public.can_view_kpi_assignment(id)));
create policy kpi_assignment_areas_select on public.kpi_assignment_areas
  for select to authenticated using ((select public.can_view_kpi_assignment(assignment_id)));
create policy kpi_assignment_items_select on public.kpi_assignment_items
  for select to authenticated using ((select public.can_view_kpi_assignment(assignment_id)));

-- Private documents drop the department-wide grants.
create or replace function public.can_view_document_row(
  p_document_id uuid, p_department_id uuid, p_uploader_id uuid, p_created_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with doc as (select is_private, kpi_assignment_id from public.documents where id = p_document_id)
  select
    p_uploader_id = auth.uid()
    or p_created_by = auth.uid()
    or exists (select 1 from public.document_reviewers r where r.document_id = p_document_id and r.reviewer_id = auth.uid())
    or exists (select 1 from public.document_review_steps s where s.document_id = p_document_id and s.reviewer_id = auth.uid())
    or public.is_below_me(p_uploader_id)
    or case
         when coalesce((select is_private from doc), false) then
           coalesce(public.can_view_kpi_assignment((select kpi_assignment_id from doc)), false)
         else
           public.has_perm('document.view.all')
           or (public.has_perm('document.view.own_dept') and p_department_id = public.my_dept())
           or exists (
             select 1 from public.departments d
             where d.id = p_department_id and d.head_user_id is not null and public.is_below_me(d.head_user_id)
           )
       end;
$$;

-- Private (KPI) folders: hidden from the repository; visible to whoever may see the assignment.
alter policy folders_select on public.folders using (
  case
    when not is_private then public.can_see_department(department_id)
    when kpi_assignment_id is not null then public.can_view_kpi_assignment(kpi_assignment_id)
    else public.has_perm('kpi.view_all') or public.can_assign_kpis(department_id)
  end
);

-- Department-wide audit visibility skips private evidence and assignments; the
-- document and KPI policies grant those rows to the people who may see them.
create or replace function public.audit_entity_is_private(p_entity_type text, p_entity_id text)
returns boolean language sql stable security definer set search_path = public
as $$
  select case
    when p_entity_type = 'kpi_assignment' then true
    when p_entity_type in ('document', 'document_version', 'document_reviewer', 'document_review') and p_entity_id ~ '^[0-9a-f-]{36}$'
      then coalesce((select is_private from public.documents where id = p_entity_id::uuid), false)
    else false
  end;
$$;

alter policy audit_logs_select on public.audit_logs using (
  actor_id = (select auth.uid())
  or (not public.audit_entity_is_private(entity_type, entity_id)
      and ((select public.has_perm('audit.view.all'))
           or ((select public.has_perm('audit.view.own_dept')) and department_id = (select public.my_dept()))))
);
create policy audit_logs_select_kpis on public.audit_logs
  for select to authenticated using (
    entity_type = 'kpi_assignment' and entity_id ~ '^[0-9a-f-]{36}$' and public.can_view_kpi_assignment(entity_id::uuid)
  );

-- -----------------------------------------------------------------------------
-- Generation: series belong to a template instance or a KPI assignment
-- -----------------------------------------------------------------------------
create or replace function public.skip_missed_periods(p_series uuid)
returns void language plpgsql security definer set search_path = public set timezone = 'Asia/Kolkata'
as $$
declare
  s public.recurring_series;
  p record;
begin
  select * into s from public.recurring_series where id = p_series;
  select * into p from public.period_for(s.recurrence, current_date, coalesce(s.year_start_month, public.academic_year_start_month()));
  update public.recurring_series
     set last_period_end = greatest(coalesce(last_period_end, start_date - 1), p.period_start - 1)
   where id = p_series;
end;
$$;

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

  v_cursor := coalesce(s.last_period_end + 1, s.start_date);
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

create or replace function public.generate_due_requirements(p_today date default null, p_trigger text default 'schedule')
returns public.scheduler_runs
language plpgsql security definer set search_path = public set timezone = 'Asia/Kolkata'
as $$
declare
  v_today date := coalesce(p_today, current_date);
  v_run public.scheduler_runs;
  s record;
  v_checked int := 0;
  v_created int := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  insert into public.scheduler_runs (trigger, run_date, triggered_by)
  values (p_trigger, v_today, auth.uid())
  returning * into v_run;

  for s in
    select rs.id, rs.name, coalesce(i.name, k.kpi_name || ' · ' || pr.full_name) as instance_name
    from public.recurring_series rs
    left join public.template_instances i on i.id = rs.instance_id
    left join public.kpi_assignments k on k.id = rs.kpi_assignment_id
    left join public.profiles pr on pr.id = k.user_id
    where not rs.is_paused
      and coalesce(i.status, k.status) = 'active'
      and (rs.last_period_end is null or rs.end_date is null or rs.last_period_end < rs.end_date)
      and (rs.last_period_end is null or coalesce(i.end_date, k.end_date) is null or rs.last_period_end < coalesce(i.end_date, k.end_date))
    order by rs.created_at
  loop
    v_checked := v_checked + 1;
    begin
      v_created := v_created + public.generate_series_due(s.id, v_today);
    exception when others then
      v_errors := v_errors || jsonb_build_object('series_id', s.id, 'series', s.name, 'instance', s.instance_name, 'error', sqlerrm);
    end;
  end loop;

  update public.scheduler_runs
     set finished_at = clock_timestamp(), series_checked = v_checked, created_count = v_created,
         error_count = jsonb_array_length(v_errors), errors = v_errors
   where id = v_run.id
  returning * into v_run;
  return v_run;
end;
$$;

-- -----------------------------------------------------------------------------
-- Assigning
-- -----------------------------------------------------------------------------
-- The department's private "KPI Records" folder (created on first use).
create or replace function public.ensure_kpi_root(p_department_id uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  v_root uuid;
  v_id uuid;
  v_ref text;
  v_code text;
  n int := 1;
begin
  select id into v_root from public.folders where department_id = p_department_id and level = 'root';
  select id into v_id from public.folders where parent_id = v_root and is_private and kpi_assignment_id is null;
  if v_id is not null then
    return v_id;
  end if;
  select code into v_code from public.departments where id = p_department_id;
  v_ref := 'KPI-' || v_code;
  while not public.reference_id_available(v_ref) loop
    n := n + 1;
    v_ref := 'KPI-' || v_code || '-' || n;
  end loop;
  insert into public.folders (parent_id, department_id, level, name, reference_id, allow_subfolders, is_private, created_by)
  values (v_root, p_department_id, 'child', 'KPI Records', v_ref, true, true, public.current_actor())
  returning id into v_id;
  return v_id;
end;
$$;

-- One item of an assignment: a one-time requirement, or a series and its due periods.
create or replace function public.kpi_create_item(
  p_assignment public.kpi_assignments, p_area_row uuid, p_area_folder uuid, p_item public.kpi_evidence_items, p_backfill boolean
)
returns int language plpgsql security definer set search_path = public set timezone = 'Asia/Kolkata'
as $$
declare
  v_item uuid;
  v_rules jsonb;
  v_doc uuid;
  v_series uuid;
  v_created int := 0;
begin
  insert into public.kpi_assignment_items (assignment_id, assignment_area_id, source_item_id, name, recurrence, sort_order)
  values (p_assignment.id, p_area_row, p_item.id, p_item.name, p_item.recurrence, p_item.sort_order)
  returning id into v_item;

  if p_assignment.reviewer_ids is not null and cardinality(p_assignment.reviewer_ids) > 0 then
    select coalesce(jsonb_agg(jsonb_build_object('rule', 'fixed', 'user_id', r) order by ord), '[]'::jsonb)
      into v_rules from unnest(p_assignment.reviewer_ids) with ordinality as t(r, ord);
  else
    select coalesce(jsonb_agg(jsonb_build_object('rule', r.rule, 'user_id', r.user_id) order by r.step_order), '[]'::jsonb)
      into v_rules from public.kpi_evidence_reviewers r where r.item_id = p_item.id;
  end if;

  if p_item.recurrence::text = 'once' then
    v_doc := public.insert_requirement(
      p_area_folder, p_item.name, p_item.document_type_id, p_item.instructions, p_assignment.user_id,
      p_item.requires_review, public.resolve_reviewers(v_rules, p_assignment.department_id, p_assignment.user_id, null),
      case p_item.due_mode::text
        when 'after_creation' then greatest(p_assignment.start_date, current_date) + p_item.due_days
        when 'period_end' then p_assignment.end_date + p_item.due_days
      end,
      coalesce(p_assignment.assigned_by, public.current_actor()), null, null, null, null, null, null, null
    );
    update public.documents set kpi_assignment_item_id = v_item where id = v_doc;
    update public.kpi_assignment_items set document_id = v_doc where id = v_item;
    v_created := 1;
  else
    insert into public.recurring_series (
      kpi_assignment_id, kpi_assignment_item_id, folder_id, department_id, name, document_type_id, description,
      recurrence, storage, create_offset_days, due_mode, due_days, uploader_id, requires_review,
      reviewer_rules, start_date, end_date, created_by, year_start_month
    ) values (
      p_assignment.id, v_item, p_area_folder, p_assignment.department_id, p_item.name, p_item.document_type_id, p_item.instructions,
      p_item.recurrence, 'here', p_item.create_offset_days, p_item.due_mode, p_item.due_days, p_assignment.user_id, p_item.requires_review,
      v_rules, p_assignment.start_date, p_assignment.end_date, coalesce(p_assignment.assigned_by, public.current_actor()),
      p_assignment.year_start_month
    ) returning id into v_series;
    update public.kpi_assignment_items set series_id = v_series where id = v_item;
    if not p_backfill then
      perform public.skip_missed_periods(v_series);
    end if;
    v_created := public.generate_series_due(v_series, current_date);
  end if;
  return v_created;
end;
$$;

-- Assigns a KPI to people for a period, all or nothing. Returns the requirements created now.
-- p_reviewer_ids replaces the KPI's reviewer rules for these assignments; p_backfill also
-- creates periods that already ended (otherwise evidence starts from the current period).
create or replace function public.assign_kpi(
  p_kpi uuid, p_user_ids uuid[], p_start date, p_end date, p_reviewer_ids uuid[] default null, p_backfill boolean default false
)
returns int language plpgsql security definer set search_path = public set timezone = 'Asia/Kolkata'
as $$
declare
  k public.kpis;
  u public.profiles;
  a public.kpi_assignments;
  ar public.kpi_areas;
  it public.kpi_evidence_items;
  v_root uuid;
  v_folder uuid;
  v_area_row uuid;
  v_area_folder uuid;
  v_created int := 0;
  v_reviewers uuid[];
  v_name text;
  n int;
begin
  select * into k from public.kpis where id = p_kpi;
  if not found or not k.is_active then
    raise exception 'Choose an active KPI' using errcode = '23514';
  end if;
  if (select coalesce(sum(weightage), 0) from public.kpi_areas where kpi_id = k.id) <> 100 then
    raise exception 'The area weightages of "%" must total 100%%', k.name using errcode = '23514';
  end if;
  if exists (select 1 from public.kpi_areas ka where ka.kpi_id = k.id
             and not exists (select 1 from public.kpi_evidence_items ki where ki.area_id = ka.id)) then
    raise exception 'Every area of "%" needs at least one evidence item', k.name using errcode = '23514';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Enter a start date and an end date after it' using errcode = '23514';
  end if;
  if coalesce(cardinality(p_user_ids), 0) = 0 then
    raise exception 'Choose at least one person' using errcode = '23514';
  end if;
  if p_reviewer_ids is not null and exists (select 1 from unnest(p_reviewer_ids) r where not exists (select 1 from public.profiles where id = r and is_active)) then
    raise exception 'Reviewers must be active users' using errcode = '23514';
  end if;

  for u in select * from public.profiles where id = any (p_user_ids) order by full_name loop
    if not u.is_active then
      raise exception '% is not an active user', u.full_name using errcode = '23514';
    end if;
    if not public.can_assign_kpis(u.department_id) then
      raise exception 'You do not have permission to assign KPIs to %', u.full_name using errcode = '42501';
    end if;
    if exists (select 1 from public.kpi_assignments x
               where x.kpi_id = k.id and x.user_id = u.id and x.status = 'active'
                 and x.start_date <= p_end and x.end_date >= p_start) then
      raise exception '% already has "%" for overlapping dates', u.full_name, k.name using errcode = '23514';
    end if;

    -- The person cannot review their own evidence.
    v_reviewers := case when p_reviewer_ids is null then null else array_remove(p_reviewer_ids, u.id) end;
    insert into public.kpi_assignments (kpi_id, kpi_name, kpi_version, year_start_month, user_id, department_id,
                                        start_date, end_date, reviewer_ids, assigned_by)
    values (k.id, k.name, k.version, k.year_start_month, u.id, u.department_id, p_start, p_end, v_reviewers, auth.uid())
    returning * into a;

    v_root := public.ensure_kpi_root(u.department_id);
    v_name := left(u.full_name || ' – ' || k.name, 90) || ' (' || public.date_range_label(p_start, p_end) || ')';
    n := 1;
    while exists (select 1 from public.folders where parent_id = v_root and lower(name) = lower(v_name)) loop
      n := n + 1;
      v_name := left(u.full_name || ' – ' || k.name, 86) || ' (' || public.date_range_label(p_start, p_end) || ') #' || n;
    end loop;
    insert into public.folders (parent_id, department_id, level, name, allow_subfolders, is_private, kpi_assignment_id, created_by)
    values (v_root, u.department_id, 'sub', v_name, true, true, a.id, auth.uid())
    returning id into v_folder;
    update public.kpi_assignments set folder_id = v_folder where id = a.id returning * into a;

    for ar in select * from public.kpi_areas where kpi_id = k.id order by sort_order, name loop
      insert into public.folders (parent_id, department_id, level, name, allow_subfolders, is_private, kpi_assignment_id, created_by)
      values (v_folder, u.department_id, 'sub', ar.name, false, true, a.id, auth.uid())
      returning id into v_area_folder;
      insert into public.kpi_assignment_areas (assignment_id, source_area_id, name, weightage, sort_order, folder_id)
      values (a.id, ar.id, ar.name, ar.weightage, ar.sort_order, v_area_folder)
      returning id into v_area_row;
      for it in select * from public.kpi_evidence_items where area_id = ar.id order by sort_order, name loop
        v_created := v_created + public.kpi_create_item(a, v_area_row, v_area_folder, it, p_backfill);
      end loop;
    end loop;
  end loop;
  return v_created;
end;
$$;

-- End (stops new periods) or reopen (resumes from the current period).
create or replace function public.set_kpi_assignment_status(p_assignment uuid, p_active boolean)
returns int language plpgsql security definer set search_path = public set timezone = 'Asia/Kolkata'
as $$
declare
  a public.kpi_assignments;
  v_series uuid;
  v_created int := 0;
begin
  select * into a from public.kpi_assignments where id = p_assignment for update;
  if not found or not (public.can_assign_kpis(a.department_id) or a.assigned_by = auth.uid()) then
    raise exception 'You do not have permission to change this KPI assignment' using errcode = '42501';
  end if;
  update public.kpi_assignments set status = case when p_active then 'active' else 'ended' end where id = a.id;
  if p_active and a.status <> 'active' then
    for v_series in select id from public.recurring_series where kpi_assignment_id = a.id and not is_paused loop
      perform public.skip_missed_periods(v_series);
      v_created := v_created + public.generate_series_due(v_series, current_date);
    end loop;
  end if;
  return v_created;
end;
$$;

-- Next period with the current KPI definition, for the same people and reviewers.
create or replace function public.renew_kpi_assignments(p_assignments uuid[], p_start date, p_end date)
returns int language plpgsql security definer set search_path = public set timezone = 'Asia/Kolkata'
as $$
declare
  a public.kpi_assignments;
  v_created int := 0;
begin
  for a in select * from public.kpi_assignments where id = any (p_assignments) order by created_at loop
    if a.kpi_id is null then
      raise exception 'The KPI "%" no longer exists', a.kpi_name using errcode = '23514';
    end if;
    v_created := v_created + public.assign_kpi(a.kpi_id, array[a.user_id], p_start, p_end, a.reviewer_ids, false);
  end loop;
  return v_created;
end;
$$;

-- Adds evidence items (and areas) added to the KPI since the assignment was made. Never removes anything.
create or replace function public.push_kpi_updates(p_assignment uuid)
returns int language plpgsql security definer set search_path = public set timezone = 'Asia/Kolkata'
as $$
declare
  a public.kpi_assignments;
  k public.kpis;
  ar public.kpi_areas;
  it public.kpi_evidence_items;
  v_area_row uuid;
  v_area_folder uuid;
  v_added int := 0;
begin
  select * into a from public.kpi_assignments where id = p_assignment for update;
  if not found or not (public.can_assign_kpis(a.department_id) or public.has_perm('kpi.manage')) then
    raise exception 'You do not have permission to change this KPI assignment' using errcode = '42501';
  end if;
  select * into k from public.kpis where id = a.kpi_id;
  if k.id is null then
    raise exception 'The KPI "%" no longer exists', a.kpi_name using errcode = '23514';
  end if;
  if a.status <> 'active' then
    raise exception 'This assignment has ended' using errcode = '23514';
  end if;

  for ar in select * from public.kpi_areas where kpi_id = k.id order by sort_order, name loop
    select id, folder_id into v_area_row, v_area_folder from public.kpi_assignment_areas where assignment_id = a.id and source_area_id = ar.id;
    if v_area_row is null then
      insert into public.folders (parent_id, department_id, level, name, allow_subfolders, is_private, kpi_assignment_id, created_by)
      values (a.folder_id, a.department_id, 'sub', ar.name, false, true, a.id, public.current_actor())
      returning id into v_area_folder;
      insert into public.kpi_assignment_areas (assignment_id, source_area_id, name, weightage, sort_order, folder_id)
      values (a.id, ar.id, ar.name, ar.weightage, ar.sort_order, v_area_folder)
      returning id into v_area_row;
    end if;
    for it in
      select * from public.kpi_evidence_items i
      where i.area_id = ar.id and not exists (select 1 from public.kpi_assignment_items x where x.assignment_id = a.id and x.source_item_id = i.id)
      order by sort_order, name
    loop
      perform public.kpi_create_item(a, v_area_row, v_area_folder, it, false);
      v_added := v_added + 1;
    end loop;
  end loop;
  update public.kpi_assignments set kpi_version = k.version where id = a.id and kpi_version <> k.version;
  return v_added;
end;
$$;

-- Per area: evidence created so far, approved (or not applicable), overdue; weighted completion.
-- SECURITY INVOKER: counts only what the caller may see.
create or replace function public.kpi_assignment_progress(p_assignment uuid)
returns jsonb language sql stable security invoker set search_path = public
as $$
  with areas as (
    select ar.id, ar.name, ar.weightage, ar.sort_order,
           count(d.id) as total,
           count(d.id) filter (where d.status in ('approved', 'not_applicable')) as done,
           count(d.id) filter (where d.status in ('pending_upload', 'changes_requested') and d.due_date < public.institute_today()) as overdue,
           count(d.id) filter (where d.status = 'in_review') as in_review
    from public.kpi_assignment_areas ar
    left join public.kpi_assignment_items it on it.assignment_area_id = ar.id
    left join public.documents d on d.kpi_assignment_item_id = it.id
    where ar.assignment_id = p_assignment
    group by ar.id
  )
  select jsonb_build_object(
    'areas', coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'weightage', weightage, 'total', total, 'done', done,
                                                   'overdue', overdue, 'in_review', in_review) order by sort_order, name), '[]'::jsonb),
    'completion', coalesce(round(sum(weightage * done::numeric / nullif(total, 0)) / nullif(sum(weightage) filter (where total > 0), 0) * 100, 1), 0),
    'overdue', coalesce(sum(overdue), 0),
    'total', coalesce(sum(total), 0),
    'done', coalesce(sum(done), 0)
  )
  from areas;
$$;

-- -----------------------------------------------------------------------------
-- Department statistics are about the repository: leave private evidence out.
-- -----------------------------------------------------------------------------
create or replace function public.document_counts_by_department()
returns table (department_id uuid, code text, name text, total bigint, approved bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select d.id, d.code, d.name, count(doc.id), count(doc.id) filter (where doc.status = 'approved')
  from public.documents doc
  join public.departments d on d.id = doc.department_id
  where not doc.is_private
  group by d.id, d.code, d.name
  order by count(doc.id) desc, d.name;
$$;

create or replace function public.document_counts_by_type(p_department_id uuid default null)
returns table (code text, name text, total bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select t.code, t.name, count(doc.id)
  from public.documents doc
  join public.document_types t on t.id = doc.document_type_id
  where not doc.is_private and (p_department_id is null or doc.department_id = p_department_id)
  group by t.code, t.name, t.sort_order
  order by count(doc.id) desc, t.sort_order;
$$;

create or replace function public.department_document_summary(p_department_id uuid, p_tz text default 'Asia/Kolkata')
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.documents where department_id = p_department_id and not is_private),
    'pending_upload', (select count(*) from public.documents where department_id = p_department_id and not is_private and status = 'pending_upload'),
    'changes_requested', (select count(*) from public.documents where department_id = p_department_id and not is_private and status = 'changes_requested'),
    'in_review', (select count(*) from public.documents where department_id = p_department_id and not is_private and status = 'in_review'),
    'approved', (select count(*) from public.documents where department_id = p_department_id and not is_private and status = 'approved'),
    'approved_this_month', (
      select count(distinct a.entity_id) from public.audit_logs a
      where a.entity_type = 'document' and a.action = 'update'
        and a.department_id = p_department_id
        and not public.audit_entity_is_private(a.entity_type, a.entity_id)
        and a.after ->> 'status' = 'approved' and a.before ->> 'status' is distinct from 'approved'
        and date_trunc('month', a.created_at at time zone p_tz) = date_trunc('month', now() at time zone p_tz)
    )
  );
$$;

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
    where d.department_id = p_department_id and not d.is_private
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

-- Designations in use (for "everyone with designation …").
create or replace function public.designations_in_use()
returns table (designation text, people bigint)
language sql stable security definer set search_path = public
as $$
  select btrim(designation), count(*) from public.profiles
  where is_active and nullif(btrim(designation), '') is not null
  group by btrim(designation) order by 1;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke execute on function public.year_of(date, int) from public, anon;
revoke execute on function public.month_range_label(date, date) from public, anon;
revoke execute on function public.period_for(public.recurrence_kind, date, int) from public, anon;
revoke execute on function public.kpi_items_prepare() from public, anon, authenticated;
revoke execute on function public.kpis_prepare() from public, anon, authenticated;
revoke execute on function public.kpis_bump_version() from public, anon, authenticated;
revoke execute on function public.duplicate_kpi(uuid) from public, anon;
revoke execute on function public.can_assign_kpis(uuid) from public, anon;
revoke execute on function public.can_view_kpi_assignment(uuid) from public, anon;
revoke execute on function public.audit_entity_is_private(text, text) from public, anon;
revoke execute on function public.ensure_kpi_root(uuid) from public, anon, authenticated;
revoke execute on function public.kpi_create_item(public.kpi_assignments, uuid, uuid, public.kpi_evidence_items, boolean) from public, anon, authenticated;
revoke execute on function public.assign_kpi(uuid, uuid[], date, date, uuid[], boolean) from public, anon;
revoke execute on function public.set_kpi_assignment_status(uuid, boolean) from public, anon;
revoke execute on function public.renew_kpi_assignments(uuid[], date, date) from public, anon;
revoke execute on function public.push_kpi_updates(uuid) from public, anon;
revoke execute on function public.kpi_assignment_progress(uuid) from public, anon;
revoke execute on function public.designations_in_use() from public, anon;

grant execute on function public.year_of(date, int) to authenticated;
grant execute on function public.month_range_label(date, date) to authenticated;
grant execute on function public.period_for(public.recurrence_kind, date, int) to authenticated;
grant execute on function public.duplicate_kpi(uuid) to authenticated;
grant execute on function public.can_assign_kpis(uuid) to authenticated;
grant execute on function public.can_view_kpi_assignment(uuid) to authenticated;
grant execute on function public.audit_entity_is_private(text, text) to authenticated;
grant execute on function public.assign_kpi(uuid, uuid[], date, date, uuid[], boolean) to authenticated;
grant execute on function public.set_kpi_assignment_status(uuid, boolean) to authenticated;
grant execute on function public.renew_kpi_assignments(uuid[], date, date) to authenticated;
grant execute on function public.push_kpi_updates(uuid) to authenticated;
grant execute on function public.kpi_assignment_progress(uuid) to authenticated;
grant execute on function public.designations_in_use() to authenticated;
