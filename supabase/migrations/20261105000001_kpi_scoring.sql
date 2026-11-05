-- =============================================================================
-- KPI scoring. A KPI Area is now the requirement:
--
--   KPI (reviewer rule, "submit within" days, year start month)
--   └─ Area: name, weightage %, what is measured, interval
--      (once / monthly / quarterly / half-yearly / annually)
--
-- Assigning a KPI snapshots its areas. Every period of an area is a KPI entry: the
-- person writes the details and may attach files; one reviewer scores it 1–10.
--
--   Area score        average of the area's scored periods
--   Projected Score   weighted by area, from the scores given so far (calculated live)
--   Final Score       the same, stored once the KPI year is over and every period is
--                     scored or not applicable
--
-- Scores live in their own tables because RLS works on rows: the person must read
-- their own entries but not, until release, the score on them.
--
-- Additive only: the evidence-item tables and old progress functions stay, unused.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Definitions
-- -----------------------------------------------------------------------------
alter table public.kpis
  add column reviewer_rule public.reviewer_rule not null default 'uploader_manager',
  add column reviewer_user_id uuid references public.profiles (id),
  add column due_days int not null default 7 check (due_days between 0 and 90),
  add constraint kpis_reviewer_rule check (reviewer_rule::text in ('fixed', 'department_head', 'uploader_manager')),
  add constraint kpis_reviewer_fixed check ((reviewer_rule::text = 'fixed') = (reviewer_user_id is not null));
create index kpis_reviewer_user_idx on public.kpis (reviewer_user_id);

alter table public.kpi_areas
  add column recurrence public.recurrence_kind not null default 'monthly';

-- Existing areas take the interval of their first evidence item (weekly is no longer offered).
select set_config('app.kpi_bulk_edit', 'on', true);
update public.kpi_areas a
   set recurrence = (
     select case when i.recurrence::text = 'weekly' then 'monthly'::public.recurrence_kind else i.recurrence end
     from public.kpi_evidence_items i where i.area_id = a.id
     order by i.sort_order, i.name limit 1
   )
 where exists (select 1 from public.kpi_evidence_items i where i.area_id = a.id);
select set_config('app.kpi_bulk_edit', 'off', true);

alter table public.kpi_areas
  add constraint kpi_areas_recurrence check (recurrence::text in ('once', 'monthly', 'quarterly', 'half_yearly', 'academic_year'));

-- Activating needs areas totalling exactly 100%, each saying what is measured.
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
    where a.kpi_id = new.id and nullif(btrim(a.description), '') is null
    limit 1;
    if v_empty is not null then
      raise exception 'Add what is measured to "%"', v_empty using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.duplicate_kpi(p_kpi uuid)
returns uuid language plpgsql security invoker set search_path = public
as $$
declare
  k public.kpis;
  v_new uuid;
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
  insert into public.kpis (name, designation, description, year_start_month, reviewer_rule, reviewer_user_id, due_days)
  values (v_name, k.designation, k.description, k.year_start_month, k.reviewer_rule, k.reviewer_user_id, k.due_days)
  returning id into v_new;
  insert into public.kpi_areas (kpi_id, name, weightage, description, sort_order, recurrence)
  select v_new, a.name, a.weightage, a.description, a.sort_order, a.recurrence
  from public.kpi_areas a where a.kpi_id = p_kpi;
  perform set_config('app.kpi_bulk_edit', 'off', true);
  return v_new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Assignments
-- -----------------------------------------------------------------------------
alter table public.kpi_assignments
  add column reviewer_id uuid references public.profiles (id),
  add column due_days int not null default 7,
  add column scores_released_at timestamptz,
  add column scores_released_by uuid references public.profiles (id);
create index kpi_assignments_reviewer_idx on public.kpi_assignments (reviewer_id, status);
create index kpi_assignments_scores_released_by_idx on public.kpi_assignments (scores_released_by);

alter table public.kpi_assignment_areas
  add column recurrence public.recurrence_kind,
  add column description text,
  add column last_period_end date;

-- Assignments made under the old model had nothing uploaded: close them. The KPI is
-- assigned again under this model, so a person's year has one set of periods.
update public.documents
   set status = 'not_applicable'::public.document_status,
       not_applicable_reason = 'The KPI was redesigned before anything was uploaded for this period',
       not_applicable_at = now()
 where kpi_assignment_id is not null
   and status::text in ('pending_upload', 'changes_requested');
update public.kpi_assignments set status = 'ended' where status = 'active';

-- -----------------------------------------------------------------------------
-- Entries: one per area per period
-- -----------------------------------------------------------------------------
create table public.kpi_entries (
  id                     uuid primary key default gen_random_uuid(),
  assignment_id          uuid not null references public.kpi_assignments (id),
  assignment_area_id     uuid not null references public.kpi_assignment_areas (id),
  period_key             text not null,
  period_label           text not null,
  period_start           date not null,
  period_end             date not null,
  due_date               date not null,
  status                 text not null default 'open'
                         check (status in ('open', 'submitted', 'changes_requested', 'scored', 'not_applicable')),
  details                text check (char_length(details) <= 10000),
  submitted_at           timestamptz,
  submitted_late         boolean not null default false,
  returned_comment       text,
  returned_at            timestamptz,
  not_applicable_reason  text,
  not_applicable_by      uuid references public.profiles (id),
  not_applicable_at      timestamptz,
  missed_notified_at     timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint kpi_entries_period_key unique (assignment_area_id, period_key)
);
create index kpi_entries_assignment_idx on public.kpi_entries (assignment_id, status);
create index kpi_entries_due_idx on public.kpi_entries (status, due_date);
create index kpi_entries_na_by_idx on public.kpi_entries (not_applicable_by);

create table public.kpi_entry_files (
  id                 uuid primary key default gen_random_uuid(),
  entry_id           uuid not null references public.kpi_entries (id),
  assignment_id      uuid not null references public.kpi_assignments (id),
  source             text not null check (source in ('upload', 'repository')),
  -- Repository files stay on this exact version, whatever happens to the document later.
  document_id        uuid references public.documents (id),
  version_id         uuid references public.document_versions (id),
  storage_path       text not null,
  original_filename  text not null,
  file_format        public.file_format not null,
  mime_type          text not null,
  size_bytes         bigint not null check (size_bytes > 0),
  sha256             text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  added_by           uuid not null references public.profiles (id),
  created_at         timestamptz not null default now(),
  constraint kpi_entry_files_unique unique (entry_id, storage_path),
  constraint kpi_entry_files_source check ((source = 'repository') = (version_id is not null))
);
create index kpi_entry_files_assignment_idx on public.kpi_entry_files (assignment_id);
create index kpi_entry_files_document_idx on public.kpi_entry_files (document_id);
create index kpi_entry_files_version_idx on public.kpi_entry_files (version_id);
create index kpi_entry_files_added_by_idx on public.kpi_entry_files (added_by);

create table public.kpi_entry_scores (
  entry_id       uuid primary key references public.kpi_entries (id),
  assignment_id  uuid not null references public.kpi_assignments (id),
  score          int not null check (score between 1 and 10),
  comment        text check (char_length(comment) <= 2000),
  scored_by      uuid not null references public.profiles (id),
  scored_at      timestamptz not null default now()
);
create index kpi_entry_scores_assignment_idx on public.kpi_entry_scores (assignment_id);
create index kpi_entry_scores_scored_by_idx on public.kpi_entry_scores (scored_by);

create table public.kpi_final_scores (
  assignment_id  uuid primary key references public.kpi_assignments (id),
  final_score    numeric(4, 2),
  area_scores    jsonb not null default '[]'::jsonb,
  generated_at   timestamptz
);

-- The reviewer can always see the assignment they score.
create or replace function public.can_view_kpi_assignment(p_assignment_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.kpi_assignments a
    where a.id = p_assignment_id
      and (a.user_id = auth.uid()
           or a.reviewer_id = auth.uid()
           or a.assigned_by = auth.uid()
           or public.has_perm('kpi.view_all')
           or public.can_assign_kpis(a.department_id)
           or public.is_below_me(a.user_id))
  );
$$;

alter table public.kpi_entries enable row level security;
alter table public.kpi_entry_files enable row level security;
alter table public.kpi_entry_scores enable row level security;
alter table public.kpi_final_scores enable row level security;

create policy kpi_entries_select on public.kpi_entries
  for select to authenticated using (assignment_id in (select a.id from public.kpi_assignments a));
create policy kpi_entry_files_select on public.kpi_entry_files
  for select to authenticated using (assignment_id in (select a.id from public.kpi_assignments a));
-- The person may remove a file while the period is still theirs to edit.
create policy kpi_entry_files_delete on public.kpi_entry_files
  for delete to authenticated using (
    entry_id in (
      select e.id from public.kpi_entries e join public.kpi_assignments a on a.id = e.assignment_id
      where a.user_id = (select auth.uid()) and a.status = 'active' and e.status in ('open', 'changes_requested')
    )
  );
-- Hidden from the person until released, even if they also hold HR rights.
create policy kpi_entry_scores_select on public.kpi_entry_scores
  for select to authenticated using (
    assignment_id in (
      select a.id from public.kpi_assignments a
      where a.user_id <> (select auth.uid()) or a.scores_released_at is not null
    )
  );
create policy kpi_final_scores_select on public.kpi_final_scores
  for select to authenticated using (
    assignment_id in (
      select a.id from public.kpi_assignments a
      where a.user_id <> (select auth.uid()) or a.scores_released_at is not null
    )
  );

-- Score audit rows follow the same rule as the scores.
create or replace function public.audit_entity_is_private(p_entity_type text, p_entity_id text)
returns boolean language sql stable security definer set search_path = public
as $$
  select case
    when p_entity_type in ('kpi_assignment', 'kpi_score') then true
    when p_entity_type in ('document', 'document_version', 'document_reviewer', 'document_review') and p_entity_id ~ '^[0-9a-f-]{36}$'
      then coalesce((select is_private from public.documents where id = p_entity_id::uuid), false)
    else false
  end;
$$;

create policy audit_logs_select_kpi_scores on public.audit_logs
  for select to authenticated using (
    entity_type = 'kpi_score'
    and entity_id in (
      select a.id::text from public.kpi_assignments a
      where a.user_id <> (select auth.uid()) or a.scores_released_at is not null
    )
  );

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create or replace function public.notify_link(p_user_id uuid, p_type text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public
as $$
  insert into public.notifications (user_id, type, title, body, link, actor_id)
  select p_user_id, p_type, p_title, p_body, p_link, public.current_actor()
  where p_user_id is not null and p_user_id is distinct from public.current_actor();
$$;

create or replace function public.kpi_audit(p_action text, p_entity_type text, p_assignment public.kpi_assignments, p_meta jsonb)
returns void language sql security definer set search_path = public
as $$
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, meta)
  values (public.current_actor(), p_action, p_entity_type, p_assignment.id::text, p_assignment.department_id, p_meta);
$$;

-- Creates the periods that have started, safe to re-run. Tells the person once, not per period.
create or replace function public.generate_kpi_entries(p_assignment uuid, p_today date)
returns int language plpgsql security definer set search_path = public
as $$
declare
  a public.kpi_assignments;
  ar public.kpi_assignment_areas;
  p record;
  v_cursor date;
  v_guard int;
  v_rows int;
  v_created int := 0;
begin
  select * into a from public.kpi_assignments where id = p_assignment for update;
  if not found or a.status <> 'active' then
    return 0;
  end if;

  for ar in select * from public.kpi_assignment_areas where assignment_id = a.id and recurrence is not null order by sort_order, name loop
    if ar.recurrence::text = 'once' then
      if ar.last_period_end is null then
        insert into public.kpi_entries (assignment_id, assignment_area_id, period_key, period_label, period_start, period_end, due_date)
        values (a.id, ar.id, 'once', 'Whole KPI period', a.start_date, a.end_date, a.end_date + a.due_days)
        on conflict (assignment_area_id, period_key) do nothing;
        get diagnostics v_rows = row_count;
        v_created := v_created + v_rows;
        update public.kpi_assignment_areas set last_period_end = a.end_date where id = ar.id;
      end if;
    else
      v_cursor := coalesce(ar.last_period_end + 1, a.start_date);
      v_guard := 0;
      loop
        v_guard := v_guard + 1;
        exit when v_guard > 60 or v_cursor > a.end_date;
        select * into p from public.period_for(ar.recurrence, v_cursor, a.year_start_month);
        exit when p.period_start > p_today;
        insert into public.kpi_entries (assignment_id, assignment_area_id, period_key, period_label, period_start, period_end, due_date)
        values (a.id, ar.id, p.period_key, p.label, p.period_start, p.period_end, least(p.period_end, a.end_date) + a.due_days)
        on conflict (assignment_area_id, period_key) do nothing;
        get diagnostics v_rows = row_count;
        v_created := v_created + v_rows;
        update public.kpi_assignment_areas set last_period_end = p.period_end where id = ar.id;
        v_cursor := p.period_end + 1;
      end loop;
    end if;
  end loop;

  if v_created > 0 then
    perform public.notify_link(a.user_id, 'kpi_to_fill', 'KPI to fill in: ' || a.kpi_name,
      v_created || case when v_created = 1 then ' period is' else ' periods are' end || ' open for you to fill in.',
      '/kpis/assignments/' || a.id);
  end if;
  return v_created;
end;
$$;

-- Stores the yearly Final Score once the period is over and every entry is decided. Re-run
-- after any change: it updates the stored score, or clears it if the year is no longer complete.
create or replace function public.generate_kpi_final_score(p_assignment uuid, p_today date default null)
returns numeric language plpgsql security definer set search_path = public set timezone = 'Asia/Kolkata'
as $$
declare
  v_today date := coalesce(p_today, current_date);
  a public.kpi_assignments;
  f public.kpi_final_scores;
  v_undecided int;
  v_score numeric;
  v_areas jsonb := '[]'::jsonb;
begin
  select * into a from public.kpi_assignments where id = p_assignment for update;
  if not found or a.reviewer_id is null then
    return null;
  end if;
  if a.status = 'active' and a.end_date < v_today then
    perform public.generate_kpi_entries(a.id, v_today);
  end if;
  select * into f from public.kpi_final_scores where assignment_id = a.id;

  select count(*) into v_undecided from public.kpi_entries
  where assignment_id = a.id and status not in ('scored', 'not_applicable');

  if (a.status = 'ended' or a.end_date < v_today) and v_undecided = 0 then
    with per_area as (
      select ar.id, ar.name, ar.weightage, ar.sort_order, avg(s.score) as score
      from public.kpi_assignment_areas ar
      left join public.kpi_entries e on e.assignment_area_id = ar.id
      left join public.kpi_entry_scores s on s.entry_id = e.id
      where ar.assignment_id = a.id and ar.recurrence is not null
      group by ar.id
    )
    select round(sum(score * weightage) / nullif(sum(weightage) filter (where score is not null), 0), 2),
           coalesce(jsonb_agg(jsonb_build_object('area_id', id, 'name', name, 'weightage', weightage, 'score', round(score, 2))
                              order by sort_order, name), '[]'::jsonb)
      into v_score, v_areas
    from per_area;
  end if;

  if v_score is null then
    if f.final_score is not null then
      update public.kpi_final_scores set final_score = null, area_scores = '[]'::jsonb, generated_at = null where assignment_id = a.id;
      perform public.kpi_audit('kpi_final_score_cleared', 'kpi_score', a, jsonb_build_object('old_score', f.final_score));
    end if;
    return null;
  end if;

  if f.final_score is not distinct from v_score and f.area_scores = v_areas then
    return v_score;
  end if;

  insert into public.kpi_final_scores (assignment_id, final_score, area_scores, generated_at)
  values (a.id, v_score, v_areas, now())
  on conflict (assignment_id) do update
    set final_score = excluded.final_score, area_scores = excluded.area_scores, generated_at = excluded.generated_at;
  perform public.kpi_audit(
    case when f.final_score is null then 'kpi_final_score_generated' else 'kpi_final_score_changed' end,
    'kpi_score', a, jsonb_build_object('old_score', f.final_score, 'new_score', v_score)
  );
  return v_score;
end;
$$;

-- Tells the reviewer, once, about periods that passed their due date with nothing submitted.
create or replace function public.notify_missed_kpi_periods(p_today date)
returns int language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_sent int := 0;
begin
  for r in
    select a.id, a.reviewer_id, a.kpi_name, pr.full_name, count(*) as n
    from public.kpi_entries e
    join public.kpi_assignments a on a.id = e.assignment_id
    join public.profiles pr on pr.id = a.user_id
    where e.status = 'open' and e.due_date < p_today and e.missed_notified_at is null
      and a.status = 'active' and a.reviewer_id is not null
    group by a.id, a.reviewer_id, a.kpi_name, pr.full_name
  loop
    perform public.notify_link(r.reviewer_id, 'kpi_missed', 'KPI period missed: ' || r.full_name,
      r.n || case when r.n = 1 then ' period' else ' periods' end || ' of ' || r.kpi_name
        || ' passed the due date with nothing submitted. Score or mark not applicable.',
      '/kpis/assignments/' || r.id);
    update public.kpi_entries set missed_notified_at = now()
     where assignment_id = r.id and status = 'open' and due_date < p_today and missed_notified_at is null;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;

-- -----------------------------------------------------------------------------
-- The daily job also covers KPI periods, missed periods and Final Scores
-- -----------------------------------------------------------------------------
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

  for s in
    select a.id, a.kpi_name || ' · ' || pr.full_name as name, a.status, a.end_date
    from public.kpi_assignments a join public.profiles pr on pr.id = a.user_id
    where a.reviewer_id is not null
      and (a.status = 'active'
           or not exists (select 1 from public.kpi_final_scores f where f.assignment_id = a.id and f.final_score is not null))
    order by a.created_at
  loop
    v_checked := v_checked + 1;
    begin
      if s.status = 'active' then
        v_created := v_created + public.generate_kpi_entries(s.id, v_today);
      end if;
      if s.status = 'ended' or s.end_date < v_today then
        perform public.generate_kpi_final_score(s.id, v_today);
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object('series_id', s.id, 'series', s.name, 'instance', 'KPI', 'error', sqlerrm);
    end;
  end loop;

  begin
    perform public.notify_missed_kpi_periods(v_today);
  exception when others then
    v_errors := v_errors || jsonb_build_object('series', 'Missed KPI periods', 'instance', 'KPI', 'error', sqlerrm);
  end;

  update public.scheduler_runs
     set finished_at = clock_timestamp(), series_checked = v_checked, created_count = v_created,
         error_count = jsonb_array_length(v_errors), errors = v_errors
   where id = v_run.id
  returning * into v_run;
  return v_run;
end;
$$;

-- -----------------------------------------------------------------------------
-- Assigning, ending, renewing, pushing
-- -----------------------------------------------------------------------------
-- p_reviewer_ids keeps its name for compatibility; it now holds at most one person, who
-- replaces the KPI's reviewer rule. p_backfill also creates periods that already ended.
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
  yr record;
  p record;
  v_area uuid;
  v_override uuid;
  v_reviewer uuid;
  v_empty text;
  v_created int := 0;
begin
  select * into k from public.kpis where id = p_kpi;
  if not found or not k.is_active then
    raise exception 'Choose an active KPI' using errcode = '23514';
  end if;
  if (select coalesce(sum(weightage), 0) from public.kpi_areas where kpi_id = k.id) <> 100 then
    raise exception 'The area weightages of "%" must total 100%%', k.name using errcode = '23514';
  end if;
  select name into v_empty from public.kpi_areas where kpi_id = k.id and nullif(btrim(description), '') is null limit 1;
  if v_empty is not null then
    raise exception 'Add what is measured to "%" in "%"', v_empty, k.name using errcode = '23514';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Enter a start date and an end date after it' using errcode = '23514';
  end if;
  select * into yr from public.year_of(p_start, k.year_start_month);
  if p_end > yr.y_end then
    raise exception 'A KPI assignment must fall within one KPI year (% to %), so that each year has its own Final Score. Renew it for the next year.', yr.y_start, yr.y_end
      using errcode = '23514';
  end if;
  if coalesce(cardinality(p_user_ids), 0) = 0 then
    raise exception 'Choose at least one person' using errcode = '23514';
  end if;
  if coalesce(cardinality(p_reviewer_ids), 0) > 1 then
    raise exception 'Choose one reviewer' using errcode = '23514';
  end if;
  v_override := p_reviewer_ids[1];
  if v_override is not null and not exists (select 1 from public.profiles where id = v_override and is_active) then
    raise exception 'The reviewer must be an active user' using errcode = '23514';
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

    if v_override = u.id then
      raise exception '% cannot review their own KPI. Choose a different reviewer.', u.full_name using errcode = '23514';
    end if;
    -- The KPI's rule first, then their manager, then their head: never leave someone without a reviewer.
    v_reviewer := coalesce(v_override, (public.resolve_reviewers(
      jsonb_build_array(
        jsonb_build_object('rule', k.reviewer_rule, 'user_id', k.reviewer_user_id),
        jsonb_build_object('rule', 'uploader_manager'),
        jsonb_build_object('rule', 'department_head')
      ), u.department_id, u.id, null))[1]);
    if v_reviewer is null then
      raise exception '% has no reporting manager or department head to review their KPI. Choose a reviewer.', u.full_name using errcode = '23514';
    end if;

    insert into public.kpi_assignments (kpi_id, kpi_name, kpi_version, year_start_month, user_id, department_id,
                                        start_date, end_date, reviewer_id, due_days, assigned_by)
    values (k.id, k.name, k.version, k.year_start_month, u.id, u.department_id,
            p_start, p_end, v_reviewer, k.due_days, auth.uid())
    returning * into a;

    for ar in select * from public.kpi_areas where kpi_id = k.id order by sort_order, name loop
      insert into public.kpi_assignment_areas (assignment_id, source_area_id, name, weightage, sort_order, recurrence, description)
      values (a.id, ar.id, ar.name, ar.weightage, ar.sort_order, ar.recurrence, ar.description)
      returning id into v_area;
      -- Without back-filling, recurring areas start from the current period.
      if not p_backfill and ar.recurrence::text <> 'once' and current_date > p_start then
        select * into p from public.period_for(ar.recurrence, least(current_date, p_end), k.year_start_month);
        if p.period_start > p_start then
          update public.kpi_assignment_areas set last_period_end = p.period_start - 1 where id = v_area;
        end if;
      end if;
    end loop;
    v_created := v_created + public.generate_kpi_entries(a.id, current_date);
  end loop;
  return v_created;
end;
$$;

-- End (stops new periods; undecided ones can still be decided) or reopen (resumes from the current period).
create or replace function public.set_kpi_assignment_status(p_assignment uuid, p_active boolean)
returns int language plpgsql security definer set search_path = public set timezone = 'Asia/Kolkata'
as $$
declare
  a public.kpi_assignments;
  ar public.kpi_assignment_areas;
  p record;
  v_created int := 0;
begin
  select * into a from public.kpi_assignments where id = p_assignment for update;
  if not found or not (public.can_assign_kpis(a.department_id) or a.assigned_by = auth.uid()) then
    raise exception 'You do not have permission to change this KPI assignment' using errcode = '42501';
  end if;
  if p_active and a.reviewer_id is null then
    raise exception 'This assignment was made before KPI scoring. Assign the KPI again instead.' using errcode = '23514';
  end if;
  update public.kpi_assignments set status = case when p_active then 'active' else 'ended' end where id = a.id;
  if p_active and a.status <> 'active' then
    for ar in select * from public.kpi_assignment_areas where assignment_id = a.id and recurrence is not null and recurrence::text <> 'once' loop
      select * into p from public.period_for(ar.recurrence, least(current_date, a.end_date), a.year_start_month);
      update public.kpi_assignment_areas
         set last_period_end = greatest(coalesce(last_period_end, a.start_date - 1), p.period_start - 1)
       where id = ar.id;
    end loop;
    v_created := public.generate_kpi_entries(a.id, current_date);
  end if;
  perform public.generate_kpi_final_score(a.id);
  return v_created;
end;
$$;

-- The next KPI year with the current KPI definition, same person and reviewer. Scores start hidden.
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
    v_created := v_created + public.assign_kpi(a.kpi_id, array[a.user_id], p_start, p_end,
      case when a.reviewer_id is null then null else array[a.reviewer_id] end, false);
  end loop;
  return v_created;
end;
$$;

-- Adds areas added to the KPI since the assignment was made and takes the current weights.
-- Never removes anything; scores divide by the areas' total weight, so they stay out of 10.
create or replace function public.push_kpi_updates(p_assignment uuid)
returns int language plpgsql security definer set search_path = public set timezone = 'Asia/Kolkata'
as $$
declare
  a public.kpi_assignments;
  k public.kpis;
  ar public.kpi_areas;
  p record;
  v_row uuid;
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
    select id into v_row from public.kpi_assignment_areas where assignment_id = a.id and source_area_id = ar.id;
    if v_row is null then
      insert into public.kpi_assignment_areas (assignment_id, source_area_id, name, weightage, sort_order, recurrence, description)
      values (a.id, ar.id, ar.name, ar.weightage, ar.sort_order, ar.recurrence, ar.description)
      returning id into v_row;
      if ar.recurrence::text <> 'once' then
        select * into p from public.period_for(ar.recurrence, least(public.institute_today(), a.end_date), a.year_start_month);
        update public.kpi_assignment_areas set last_period_end = greatest(a.start_date, p.period_start) - 1 where id = v_row;
      end if;
      v_added := v_added + 1;
    else
      update public.kpi_assignment_areas set weightage = ar.weightage where id = v_row and weightage <> ar.weightage;
    end if;
  end loop;
  update public.kpi_assignments set kpi_version = k.version where id = a.id and kpi_version <> k.version;
  perform public.generate_kpi_entries(a.id, current_date);
  return v_added;
end;
$$;

-- -----------------------------------------------------------------------------
-- The person: draft, submit, attach
-- -----------------------------------------------------------------------------
create or replace function public.save_kpi_entry(p_entry uuid, p_details text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  e public.kpi_entries;
  a public.kpi_assignments;
begin
  select * into e from public.kpi_entries where id = p_entry for update;
  if not found then
    raise exception 'KPI period not found' using errcode = '23503';
  end if;
  select * into a from public.kpi_assignments where id = e.assignment_id;
  if a.user_id is distinct from auth.uid() then
    raise exception 'Only the assigned person can fill in this KPI' using errcode = '42501';
  end if;
  if a.status <> 'active' then
    raise exception 'This KPI has ended' using errcode = '23514';
  end if;
  if e.status not in ('open', 'changes_requested') then
    raise exception 'This period has already been submitted' using errcode = '23514';
  end if;
  if char_length(p_details) > 10000 then
    raise exception 'The details can be at most 10000 characters' using errcode = '23514';
  end if;
  update public.kpi_entries set details = nullif(btrim(p_details), ''), updated_at = now() where id = e.id;
end;
$$;

create or replace function public.submit_kpi_entries(p_entries uuid[])
returns int language plpgsql security definer set search_path = public
as $$
declare
  e public.kpi_entries;
  a public.kpi_assignments;
  v_area text;
  v_count int := 0;
  v_counts jsonb := '{}'::jsonb;
  v_id text;
begin
  for e in select * from public.kpi_entries where id = any (p_entries) order by assignment_id, period_start for update loop
    select * into a from public.kpi_assignments where id = e.assignment_id;
    if a.user_id is distinct from auth.uid() then
      raise exception 'Only the assigned person can fill in this KPI' using errcode = '42501';
    end if;
    if a.status <> 'active' then
      raise exception 'This KPI has ended' using errcode = '23514';
    end if;
    select name into v_area from public.kpi_assignment_areas where id = e.assignment_area_id;
    if e.status not in ('open', 'changes_requested') then
      raise exception '"%" (%) has already been submitted', v_area, e.period_label using errcode = '23514';
    end if;
    if nullif(btrim(e.details), '') is null then
      raise exception 'Write the details for "%" (%) before submitting', v_area, e.period_label using errcode = '23514';
    end if;
    update public.kpi_entries
       set status = 'submitted', submitted_at = now(), submitted_late = public.institute_today() > e.due_date, updated_at = now()
     where id = e.id;
    perform public.kpi_audit('kpi_entry_submitted', 'kpi_assignment', a,
      jsonb_build_object('entry_id', e.id, 'area', v_area, 'period', e.period_label));
    v_counts := jsonb_set(v_counts, array[a.id::text], to_jsonb(coalesce((v_counts ->> a.id::text)::int, 0) + 1));
    v_count := v_count + 1;
  end loop;

  -- One notification per assignment, not one per period.
  for v_id in select jsonb_object_keys(v_counts) loop
    select * into a from public.kpi_assignments where id = v_id::uuid;
    perform public.notify_link(a.reviewer_id, 'kpi_to_score',
      'KPI to score: ' || (select full_name from public.profiles where id = a.user_id),
      (v_counts ->> v_id) || case when (v_counts ->> v_id)::int = 1 then ' period' else ' periods' end || ' of ' || a.kpi_name || ' waiting for your score.',
      '/kpis/assignments/' || a.id);
  end loop;
  return v_count;
end;
$$;

create or replace function public.kpi_check_file_slot(p_entry uuid)
returns void language plpgsql stable set search_path = public
as $$
begin
  if (select count(*) from public.kpi_entry_files where entry_id = p_entry) >= 10 then
    raise exception 'A period can have at most 10 files' using errcode = '23514';
  end if;
end;
$$;

-- Attaches the document's current version. Only documents the person can see themselves.
create or replace function public.attach_repository_file(p_entry uuid, p_document uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  e public.kpi_entries;
  a public.kpi_assignments;
  d public.documents;
  v public.document_versions;
  v_id uuid;
begin
  select * into e from public.kpi_entries where id = p_entry for update;
  if not found then
    raise exception 'KPI period not found' using errcode = '23503';
  end if;
  select * into a from public.kpi_assignments where id = e.assignment_id;
  if a.user_id is distinct from auth.uid() then
    raise exception 'Only the assigned person can fill in this KPI' using errcode = '42501';
  end if;
  if a.status <> 'active' or e.status not in ('open', 'changes_requested') then
    raise exception 'This period can no longer be changed' using errcode = '23514';
  end if;
  select * into d from public.documents where id = p_document;
  if not found or not public.can_view_document(p_document) then
    raise exception 'Document not found' using errcode = '42501';
  end if;
  if d.current_version_id is null then
    raise exception 'This document has no file yet' using errcode = '23514';
  end if;
  select * into v from public.document_versions where id = d.current_version_id;
  if exists (select 1 from public.kpi_entry_files where entry_id = e.id and storage_path = v.storage_path) then
    raise exception 'This file is already attached' using errcode = '23514';
  end if;
  perform public.kpi_check_file_slot(e.id);
  insert into public.kpi_entry_files (entry_id, assignment_id, source, document_id, version_id, storage_path, original_filename,
                                      file_format, mime_type, size_bytes, sha256, added_by)
  values (e.id, a.id, 'repository', d.id, v.id, v.storage_path, v.original_filename,
          v.file_format, v.mime_type, v.size_bytes, v.sha256, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Called by the server (service role) after it has verified the stored file.
create or replace function public.record_kpi_entry_file(
  p_actor uuid, p_entry uuid, p_storage_path text, p_original_filename text,
  p_file_format public.file_format, p_mime_type text, p_size_bytes bigint, p_sha256 text
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  e public.kpi_entries;
  a public.kpi_assignments;
  v_id uuid;
begin
  perform set_config('app.actor_id', p_actor::text, true);
  select * into e from public.kpi_entries where id = p_entry for update;
  if not found then
    raise exception 'KPI period not found' using errcode = '23503';
  end if;
  select * into a from public.kpi_assignments where id = e.assignment_id;
  if a.user_id <> p_actor then
    raise exception 'Only the assigned person can fill in this KPI' using errcode = '42501';
  end if;
  if a.status <> 'active' or e.status not in ('open', 'changes_requested') then
    raise exception 'This period can no longer be changed' using errcode = '23514';
  end if;
  if p_storage_path not like a.department_id || '/kpi/' || e.id || '/%' then
    raise exception 'Invalid storage path' using errcode = '23514';
  end if;
  perform public.kpi_check_file_slot(e.id);
  insert into public.kpi_entry_files (entry_id, assignment_id, source, storage_path, original_filename,
                                      file_format, mime_type, size_bytes, sha256, added_by)
  values (e.id, a.id, 'upload', p_storage_path, p_original_filename,
          p_file_format, p_mime_type, p_size_bytes, lower(p_sha256), p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

-- Views and downloads of evidence, recorded against the assignment.
create or replace function public.log_kpi_file_access(p_file uuid, p_action text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  f public.kpi_entry_files;
  a public.kpi_assignments;
begin
  if p_action not in ('view', 'download') then
    raise exception 'Unsupported event: %', p_action using errcode = '22023';
  end if;
  select * into f from public.kpi_entry_files where id = p_file;
  if not found or not public.can_view_kpi_assignment(f.assignment_id) then
    raise exception 'File not found' using errcode = '42501';
  end if;
  select * into a from public.kpi_assignments where id = f.assignment_id;
  perform public.kpi_audit('kpi_file_' || p_action, 'kpi_assignment', a,
    jsonb_build_object('entry_id', f.entry_id, 'file', f.original_filename));
end;
$$;

-- -----------------------------------------------------------------------------
-- The reviewer (and HR for corrections): score, send back, not applicable
-- -----------------------------------------------------------------------------
create or replace function public.score_kpi_entry(p_entry uuid, p_score int, p_comment text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare
  e public.kpi_entries;
  a public.kpi_assignments;
  v_old public.kpi_entry_scores;
  v_area text;
  v_assignment uuid;
  v_comment text := nullif(btrim(p_comment), '');
  v_hr boolean;
  v_final boolean;
begin
  select assignment_id into v_assignment from public.kpi_entries where id = p_entry;
  if not found then
    raise exception 'KPI period not found' using errcode = '23503';
  end if;
  select * into a from public.kpi_assignments where id = v_assignment for update;
  select * into e from public.kpi_entries where id = p_entry for update;

  if a.user_id = auth.uid() then
    raise exception 'You cannot score your own KPI' using errcode = '42501';
  end if;
  if p_score is null or p_score not between 1 and 10 then
    raise exception 'The score must be from 1 to 10' using errcode = '23514';
  end if;
  if char_length(v_comment) > 2000 then
    raise exception 'The comment can be at most 2000 characters' using errcode = '23514';
  end if;

  v_hr := public.can_assign_kpis(a.department_id);
  if e.status = 'scored' then
    select * into v_old from public.kpi_entry_scores where entry_id = e.id;
    v_final := exists (select 1 from public.kpi_final_scores where assignment_id = a.id and final_score is not null);
    if not (v_hr or (a.reviewer_id = auth.uid() and a.scores_released_at is null and not v_final)) then
      raise exception 'Scores that have been released or finalised can only be changed by HR' using errcode = '42501';
    end if;
  else
    if a.reviewer_id is distinct from auth.uid() then
      raise exception 'Only the reviewer can score this KPI' using errcode = '42501';
    end if;
    if e.status = 'not_applicable' then
      raise exception 'This period is marked not applicable. Reopen it first.' using errcode = '23514';
    end if;
    if e.status in ('open', 'changes_requested') and a.status = 'active' and e.due_date >= public.institute_today() then
      raise exception 'This period can be scored once it is submitted or its due date has passed' using errcode = '23514';
    end if;
  end if;

  insert into public.kpi_entry_scores (entry_id, assignment_id, score, comment, scored_by, scored_at)
  values (e.id, a.id, p_score, v_comment, auth.uid(), now())
  on conflict (entry_id) do update
    set score = excluded.score, comment = excluded.comment, scored_by = excluded.scored_by, scored_at = excluded.scored_at;
  update public.kpi_entries set status = 'scored', updated_at = now() where id = e.id;

  select name into v_area from public.kpi_assignment_areas where id = e.assignment_area_id;
  perform public.kpi_audit(case when e.status = 'scored' then 'kpi_score_changed' else 'kpi_entry_scored' end, 'kpi_score', a,
    jsonb_build_object('entry_id', e.id, 'area', v_area, 'period', e.period_label, 'old_score', v_old.score, 'new_score', p_score));
  -- Never includes the score: it stays hidden until release.
  if e.status <> 'scored' then
    perform public.notify_link(a.user_id, 'kpi_reviewed', 'KPI reviewed: ' || v_area,
      e.period_label || ' of ' || a.kpi_name || ' has been reviewed.', '/kpis/assignments/' || a.id);
  end if;
  perform public.generate_kpi_final_score(a.id);
end;
$$;

create or replace function public.return_kpi_entry(p_entry uuid, p_comment text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  e public.kpi_entries;
  a public.kpi_assignments;
  v_area text;
  v_comment text := nullif(btrim(p_comment), '');
begin
  select * into e from public.kpi_entries where id = p_entry for update;
  if not found then
    raise exception 'KPI period not found' using errcode = '23503';
  end if;
  select * into a from public.kpi_assignments where id = e.assignment_id;
  if a.reviewer_id is distinct from auth.uid() then
    raise exception 'Only the reviewer can send this back' using errcode = '42501';
  end if;
  if e.status <> 'submitted' then
    raise exception 'Only a submitted period can be sent back' using errcode = '23514';
  end if;
  if a.status <> 'active' then
    raise exception 'This KPI has ended, so the person cannot resubmit. Score it or mark it not applicable.' using errcode = '23514';
  end if;
  if v_comment is null then
    raise exception 'Explain what needs to change' using errcode = '23514';
  end if;
  if char_length(v_comment) > 2000 then
    raise exception 'The comment can be at most 2000 characters' using errcode = '23514';
  end if;
  update public.kpi_entries
     set status = 'changes_requested', returned_comment = v_comment, returned_at = now(), updated_at = now()
   where id = e.id;
  select name into v_area from public.kpi_assignment_areas where id = e.assignment_area_id;
  perform public.kpi_audit('kpi_entry_returned', 'kpi_assignment', a,
    jsonb_build_object('entry_id', e.id, 'area', v_area, 'period', e.period_label));
  perform public.notify_link(a.user_id, 'changes_requested', 'Changes requested: ' || v_area,
    v_comment, '/kpis/assignments/' || a.id);
end;
$$;

create or replace function public.set_kpi_entry_not_applicable(p_entry uuid, p_reason text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  e public.kpi_entries;
  a public.kpi_assignments;
  v_area text;
  v_assignment uuid;
  v_reason text := nullif(btrim(p_reason), '');
begin
  select assignment_id into v_assignment from public.kpi_entries where id = p_entry;
  if not found then
    raise exception 'KPI period not found' using errcode = '23503';
  end if;
  select * into a from public.kpi_assignments where id = v_assignment for update;
  select * into e from public.kpi_entries where id = p_entry for update;
  if a.user_id = auth.uid() or not (a.reviewer_id = auth.uid() or public.can_assign_kpis(a.department_id)) then
    raise exception 'Only the reviewer or HR can mark a period not applicable' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Give a reason' using errcode = '23514';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'The reason can be at most 1000 characters' using errcode = '23514';
  end if;
  if e.status not in ('open', 'changes_requested', 'submitted') then
    raise exception 'A scored period cannot be marked not applicable' using errcode = '23514';
  end if;
  update public.kpi_entries
     set status = 'not_applicable', not_applicable_reason = v_reason, not_applicable_by = auth.uid(),
         not_applicable_at = now(), updated_at = now()
   where id = e.id;
  select name into v_area from public.kpi_assignment_areas where id = e.assignment_area_id;
  perform public.kpi_audit('kpi_entry_not_applicable', 'kpi_assignment', a,
    jsonb_build_object('entry_id', e.id, 'area', v_area, 'period', e.period_label, 'reason', v_reason));
  perform public.notify_link(a.user_id, 'kpi_reviewed', 'Not applicable: ' || v_area,
    e.period_label || ' of ' || a.kpi_name || ' will not count. Reason: ' || v_reason, '/kpis/assignments/' || a.id);
  perform public.generate_kpi_final_score(a.id);
end;
$$;

create or replace function public.reopen_kpi_entry(p_entry uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  e public.kpi_entries;
  a public.kpi_assignments;
  v_area text;
  v_assignment uuid;
begin
  select assignment_id into v_assignment from public.kpi_entries where id = p_entry;
  if not found then
    raise exception 'KPI period not found' using errcode = '23503';
  end if;
  select * into a from public.kpi_assignments where id = v_assignment for update;
  select * into e from public.kpi_entries where id = p_entry for update;
  if a.user_id = auth.uid() or not (a.reviewer_id = auth.uid() or public.can_assign_kpis(a.department_id)) then
    raise exception 'Only the reviewer or HR can reopen a period' using errcode = '42501';
  end if;
  if e.status <> 'not_applicable' then
    raise exception 'Only a period marked not applicable can be reopened' using errcode = '23514';
  end if;
  update public.kpi_entries
     set status = case when submitted_at is null then 'open' else 'submitted' end,
         not_applicable_reason = null, not_applicable_by = null, not_applicable_at = null, updated_at = now()
   where id = e.id;
  select name into v_area from public.kpi_assignment_areas where id = e.assignment_area_id;
  perform public.kpi_audit('kpi_entry_reopened', 'kpi_assignment', a,
    jsonb_build_object('entry_id', e.id, 'area', v_area, 'period', e.period_label));
  perform public.generate_kpi_final_score(a.id);
end;
$$;

-- Release: the reviewer or HR. Hiding again: HR only. The person cannot do either for themselves.
create or replace function public.set_kpi_scores_released(p_assignment uuid, p_released boolean)
returns void language plpgsql security definer set search_path = public
as $$
declare
  a public.kpi_assignments;
  v_hr boolean;
begin
  select * into a from public.kpi_assignments where id = p_assignment for update;
  if not found then
    raise exception 'KPI assignment not found' using errcode = '23503';
  end if;
  v_hr := public.can_assign_kpis(a.department_id);
  if a.user_id = auth.uid() or not (v_hr or (p_released and a.reviewer_id = auth.uid())) then
    raise exception 'You do not have permission to change who can see these scores' using errcode = '42501';
  end if;
  if p_released = (a.scores_released_at is not null) then
    return;
  end if;
  update public.kpi_assignments
     set scores_released_at = case when p_released then now() end,
         scores_released_by = case when p_released then auth.uid() end
   where id = a.id;
  perform public.kpi_audit(case when p_released then 'kpi_scores_released' else 'kpi_scores_hidden' end, 'kpi_assignment', a, '{}'::jsonb);
  if p_released then
    perform public.notify_link(a.user_id, 'kpi_scores_released', 'KPI scores released: ' || a.kpi_name,
      'You can now see your scores.', '/kpis/assignments/' || a.id);
  end if;
end;
$$;

create or replace function public.change_kpi_reviewer(p_assignment uuid, p_reviewer uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  a public.kpi_assignments;
begin
  select * into a from public.kpi_assignments where id = p_assignment for update;
  if not found or not public.can_assign_kpis(a.department_id) then
    raise exception 'You do not have permission to change this KPI assignment' using errcode = '42501';
  end if;
  if p_reviewer = a.user_id then
    raise exception 'A person cannot review their own KPI' using errcode = '23514';
  end if;
  if not exists (select 1 from public.profiles where id = p_reviewer and is_active) then
    raise exception 'The reviewer must be an active user' using errcode = '23514';
  end if;
  if p_reviewer is not distinct from a.reviewer_id then
    return;
  end if;
  update public.kpi_assignments set reviewer_id = p_reviewer where id = a.id;
  perform public.kpi_audit('kpi_reviewer_changed', 'kpi_assignment', a,
    jsonb_build_object('from_user_id', a.reviewer_id, 'to_user_id', p_reviewer));
  perform public.notify_link(p_reviewer, 'kpi_to_score',
    'KPI to review: ' || (select full_name from public.profiles where id = a.user_id),
    'You are now the reviewer of ' || a.kpi_name || '.', '/kpis/assignments/' || a.id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Scores. SECURITY INVOKER: RLS hides what the caller may not see, so the person
-- gets blank scores until release.
-- -----------------------------------------------------------------------------
create or replace function public.kpi_assignment_scores(p_ids uuid[])
returns table (
  assignment_id uuid, total bigint, open_periods bigint, overdue bigint, submitted bigint, scored bigint,
  not_applicable bigint, undecided bigint, projected_score numeric, final_score numeric,
  final_generated_at timestamptz, areas jsonb
)
language sql stable security invoker set search_path = public
as $$
  with per_area as (
    select ar.assignment_id, ar.id, ar.name, ar.weightage, ar.sort_order,
           count(e.id) as total,
           count(e.id) filter (where e.status in ('open', 'changes_requested') and e.due_date >= public.institute_today()) as open_periods,
           count(e.id) filter (where e.status in ('open', 'changes_requested') and e.due_date < public.institute_today()) as overdue,
           count(e.id) filter (where e.status = 'submitted') as submitted,
           count(e.id) filter (where e.status = 'scored') as scored,
           count(e.id) filter (where e.status = 'not_applicable') as not_applicable,
           avg(s.score) as score
    from public.kpi_assignment_areas ar
    left join public.kpi_entries e on e.assignment_area_id = ar.id
    left join public.kpi_entry_scores s on s.entry_id = e.id
    where ar.assignment_id = any (p_ids) and ar.recurrence is not null
    group by ar.id
  )
  select p.assignment_id,
         sum(p.total)::bigint, sum(p.open_periods)::bigint, sum(p.overdue)::bigint, sum(p.submitted)::bigint,
         sum(p.scored)::bigint, sum(p.not_applicable)::bigint,
         (sum(p.total) - sum(p.scored) - sum(p.not_applicable))::bigint,
         round(sum(p.score * p.weightage) / nullif(sum(p.weightage) filter (where p.score is not null), 0), 2),
         f.final_score, f.generated_at,
         jsonb_agg(jsonb_build_object('id', p.id, 'score', round(p.score, 2), 'total', p.total, 'scored', p.scored,
                                      'overdue', p.overdue, 'submitted', p.submitted, 'not_applicable', p.not_applicable)
                   order by p.sort_order, p.name)
  from per_area p
  left join public.kpi_final_scores f on f.assignment_id = p.assignment_id
  group by p.assignment_id, f.final_score, f.generated_at;
$$;

-- -----------------------------------------------------------------------------
-- Tasks, storage, deactivation, hand-over
-- -----------------------------------------------------------------------------
create or replace function public.my_task_counts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'to_upload', (select count(*) from public.documents
                  where assigned_uploader_id = auth.uid() and status in ('pending_upload', 'changes_requested')),
    'changes_requested', (select count(*) from public.documents
                          where assigned_uploader_id = auth.uid() and status = 'changes_requested'),
    'overdue', (select count(*) from public.documents
                where assigned_uploader_id = auth.uid() and status in ('pending_upload', 'changes_requested')
                  and due_date < public.institute_today()),
    'to_review', (select count(*) from public.document_review_steps
                  where reviewer_id = auth.uid() and state = 'active'),
    'approved', (select count(*) from public.documents
                 where assigned_uploader_id = auth.uid() and status = 'approved'),
    'kpi_to_fill', (select count(*) from public.kpi_entries e join public.kpi_assignments a on a.id = e.assignment_id
                    where a.user_id = auth.uid() and a.status = 'active' and e.status in ('open', 'changes_requested')),
    'kpi_overdue', (select count(*) from public.kpi_entries e join public.kpi_assignments a on a.id = e.assignment_id
                    where a.user_id = auth.uid() and a.status = 'active' and e.status in ('open', 'changes_requested')
                      and e.due_date < public.institute_today()),
    'kpi_to_score', (select count(*) from public.kpi_entries e join public.kpi_assignments a on a.id = e.assignment_id
                     where a.reviewer_id = auth.uid()
                       and (e.status = 'submitted'
                            or (e.status in ('open', 'changes_requested')
                                and (e.due_date < public.institute_today() or a.status = 'ended')))),
    'unread_notifications', (select count(*) from public.notifications
                             where user_id = auth.uid() and read_at is null)
  );
$$;

create or replace function public.storage_used()
returns bigint
language sql
stable
set search_path = public
as $$
  select coalesce((select sum(size_bytes) from public.document_versions), 0)::bigint
       + coalesce((select sum(size_bytes) from public.kpi_entry_files where source = 'upload'), 0)::bigint;
$$;

create or replace function public.profiles_end_kpis_on_deactivation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.kpi_assignments set status = 'ended' where user_id = new.id and status = 'active';
  update public.documents
     set status = 'not_applicable'::public.document_status,
         not_applicable_reason = 'The person was deactivated',
         not_applicable_by = auth.uid(),
         not_applicable_at = now()
   where assigned_uploader_id = new.id and kpi_assignment_id is not null
     and status::text in ('pending_upload', 'changes_requested');
  -- Submitted work can still be scored; the daily job then generates the Final Score.
  update public.kpi_entries e
     set status = 'not_applicable',
         not_applicable_reason = 'The person was deactivated',
         not_applicable_by = auth.uid(),
         not_applicable_at = now(),
         updated_at = now()
    from public.kpi_assignments a
   where a.id = e.assignment_id and a.user_id = new.id and e.status in ('open', 'changes_requested');
  return null;
end;
$$;

create or replace function public.user_open_work(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_perm('user.manage') then
    raise exception 'You do not have permission to manage users' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'uploads', (select count(*) from public.documents
                where assigned_uploader_id = p_user and kpi_assignment_id is null
                  and status::text in ('pending_upload', 'changes_requested', 'in_review')),
    'reviews', (select count(*) from public.document_reviewers r join public.documents d on d.id = r.document_id
                where r.reviewer_id = p_user and d.status::text not in ('approved', 'not_applicable')),
    'series', (select count(*) from public.recurring_series
               where kpi_assignment_id is null
                 and (uploader_id = p_user or slot_owner_id = p_user
                      or reviewer_rules @> jsonb_build_array(jsonb_build_object('user_id', p_user)))),
    'kpis', (select count(*) from public.kpi_assignments where user_id = p_user and status = 'active'),
    'kpi_reviews', (select count(*) from public.kpi_assignments a
                    where a.reviewer_id = p_user
                      and (a.status = 'active'
                           or exists (select 1 from public.kpi_entries e where e.assignment_id = a.id
                                      and e.status not in ('scored', 'not_applicable')))),
    'reports', (select count(*) from public.profiles where reports_to_id = p_user and is_active)
  );
end;
$$;

create or replace function public.hand_over_work(p_from uuid, p_to uuid, p_move_reports boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_to_name text;
  d record;
  v_uploads int := 0;
  v_reviews int := 0;
  v_series int := 0;
  v_reports int := 0;
  v_kpi_reviews int := 0;
begin
  if not public.has_perm('user.manage') then
    raise exception 'You do not have permission to manage users' using errcode = '42501';
  end if;
  if p_from = p_to then
    raise exception 'Choose someone else to take over the work' using errcode = '23514';
  end if;
  select full_name into v_to_name from public.profiles where id = p_to and is_active;
  if v_to_name is null then
    raise exception 'The person taking over must be an active user' using errcode = '23514';
  end if;

  -- A document's uploader may not review it, and nobody reviews twice. Refuse
  -- rather than silently shortening a review chain.
  select dd.name into d from public.documents dd
  where dd.status::text not in ('approved', 'not_applicable')
    and (
      (dd.assigned_uploader_id = p_from and dd.kpi_assignment_id is null
       and exists (select 1 from public.document_reviewers r where r.document_id = dd.id and r.reviewer_id = p_to))
      or (dd.assigned_uploader_id = p_to and exists (select 1 from public.document_reviewers r where r.document_id = dd.id and r.reviewer_id = p_from))
      or (exists (select 1 from public.document_reviewers r where r.document_id = dd.id and r.reviewer_id = p_from)
          and exists (select 1 from public.document_reviewers r where r.document_id = dd.id and r.reviewer_id = p_to))
    )
  limit 1;
  if found then
    raise exception '% is already the uploader or a reviewer of "%". Choose someone else, or change that document first.', v_to_name, d.name
      using errcode = '23514';
  end if;

  -- Nobody may review their own KPI.
  select a.kpi_name into d from public.kpi_assignments a
  where a.reviewer_id = p_from and a.user_id = p_to
    and (a.status = 'active'
         or exists (select 1 from public.kpi_entries e where e.assignment_id = a.id and e.status not in ('scored', 'not_applicable')))
  limit 1;
  if found then
    raise exception '% would become the reviewer of their own KPI "%". Choose someone else, or change its reviewer first.', v_to_name, d.kpi_name
      using errcode = '23514';
  end if;

  -- Uploads (not KPI evidence, which is personal)
  for d in
    select id, name, status::text as status from public.documents
    where assigned_uploader_id = p_from and kpi_assignment_id is null
      and status::text in ('pending_upload', 'changes_requested', 'in_review')
    for update
  loop
    update public.documents set assigned_uploader_id = p_to where id = d.id;
    if d.status <> 'in_review' then
      perform public.notify(p_to, 'upload_requested', 'Upload requested: ' || d.name,
                            'This upload was handed over to you.', d.id);
    end if;
    v_uploads := v_uploads + 1;
  end loop;

  -- Reviewer slots on open documents, and their waiting or active review steps
  update public.document_reviewers r set reviewer_id = p_to
  from public.documents dd
  where dd.id = r.document_id and r.reviewer_id = p_from and dd.status::text not in ('approved', 'not_applicable');
  get diagnostics v_reviews = row_count;

  for d in
    update public.document_review_steps s set reviewer_id = p_to
    where s.reviewer_id = p_from and s.state in ('waiting', 'active')
    returning s.document_id, s.state
  loop
    if d.state = 'active' then
      perform public.notify(p_to, 'review_requested',
                            'Review requested: ' || (select name from public.documents where id = d.document_id),
                            'This review was handed over to you.', d.document_id);
    end if;
  end loop;

  -- Recurring series: future periods go to the successor
  update public.recurring_series s
     set uploader_id = case when s.uploader_id = p_from then p_to else s.uploader_id end,
         slot_owner_id = case when s.slot_owner_id = p_from then p_to else s.slot_owner_id end,
         reviewer_rules = (
           select coalesce(jsonb_agg(case when e ->> 'user_id' = p_from::text then jsonb_set(e, '{user_id}', to_jsonb(p_to)) else e end order by o), '[]'::jsonb)
           from jsonb_array_elements(s.reviewer_rules) with ordinality as t(e, o)
         )
   where s.kpi_assignment_id is null
     and (s.uploader_id = p_from or s.slot_owner_id = p_from
          or s.reviewer_rules @> jsonb_build_array(jsonb_build_object('user_id', p_from)));
  get diagnostics v_series = row_count;
  update public.template_instances set slot_owner_id = p_to where slot_owner_id = p_from;

  -- KPIs they review, with anything still to decide
  update public.kpi_assignments a set reviewer_id = p_to
   where a.reviewer_id = p_from
     and (a.status = 'active'
          or exists (select 1 from public.kpi_entries e where e.assignment_id = a.id and e.status not in ('scored', 'not_applicable')));
  get diagnostics v_kpi_reviews = row_count;
  if v_kpi_reviews > 0 then
    perform public.notify_link(p_to, 'kpi_to_score', 'KPIs handed over to you',
      v_kpi_reviews || case when v_kpi_reviews = 1 then ' KPI' else ' KPIs' end || ' to review were handed over to you.', '/tasks');
  end if;
  update public.kpis set reviewer_user_id = p_to where reviewer_user_id = p_from;

  if p_move_reports then
    update public.profiles set reports_to_id = p_to where reports_to_id = p_from and id <> p_to;
    get diagnostics v_reports = row_count;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, meta)
  select auth.uid(), 'work_handed_over', 'user', p_from::text, p.department_id,
         jsonb_build_object('to_user_id', p_to, 'uploads', v_uploads, 'reviews', v_reviews,
                            'series', v_series, 'reports', v_reports, 'kpi_reviews', v_kpi_reviews)
  from public.profiles p where p.id = p_from;

  return jsonb_build_object('uploads', v_uploads, 'reviews', v_reviews, 'series', v_series,
                            'reports', v_reports, 'kpi_reviews', v_kpi_reviews);
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke execute on function public.notify_link(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.kpi_audit(text, text, public.kpi_assignments, jsonb) from public, anon, authenticated;
revoke execute on function public.generate_kpi_entries(uuid, date) from public, anon, authenticated;
revoke execute on function public.generate_kpi_final_score(uuid, date) from public, anon, authenticated;
revoke execute on function public.notify_missed_kpi_periods(date) from public, anon, authenticated;
revoke execute on function public.kpi_check_file_slot(uuid) from public, anon, authenticated;
revoke execute on function public.record_kpi_entry_file(uuid, uuid, text, text, public.file_format, text, bigint, text) from public, anon, authenticated;
revoke execute on function public.save_kpi_entry(uuid, text) from public, anon;
revoke execute on function public.submit_kpi_entries(uuid[]) from public, anon;
revoke execute on function public.attach_repository_file(uuid, uuid) from public, anon;
revoke execute on function public.log_kpi_file_access(uuid, text) from public, anon;
revoke execute on function public.score_kpi_entry(uuid, int, text) from public, anon;
revoke execute on function public.return_kpi_entry(uuid, text) from public, anon;
revoke execute on function public.set_kpi_entry_not_applicable(uuid, text) from public, anon;
revoke execute on function public.reopen_kpi_entry(uuid) from public, anon;
revoke execute on function public.set_kpi_scores_released(uuid, boolean) from public, anon;
revoke execute on function public.change_kpi_reviewer(uuid, uuid) from public, anon;
revoke execute on function public.kpi_assignment_scores(uuid[]) from public, anon;

grant execute on function public.record_kpi_entry_file(uuid, uuid, text, text, public.file_format, text, bigint, text) to service_role;
grant execute on function public.save_kpi_entry(uuid, text) to authenticated;
grant execute on function public.submit_kpi_entries(uuid[]) to authenticated;
grant execute on function public.attach_repository_file(uuid, uuid) to authenticated;
grant execute on function public.log_kpi_file_access(uuid, text) to authenticated;
grant execute on function public.score_kpi_entry(uuid, int, text) to authenticated;
grant execute on function public.return_kpi_entry(uuid, text) to authenticated;
grant execute on function public.set_kpi_entry_not_applicable(uuid, text) to authenticated;
grant execute on function public.reopen_kpi_entry(uuid) to authenticated;
grant execute on function public.set_kpi_scores_released(uuid, boolean) to authenticated;
grant execute on function public.change_kpi_reviewer(uuid, uuid) to authenticated;
grant execute on function public.kpi_assignment_scores(uuid[]) to authenticated;
