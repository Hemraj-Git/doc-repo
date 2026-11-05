-- =============================================================================
-- Phase 7D: the recurrence scheduler (daily via pg_cron, or "Run now"), its run
-- log, pausing/ending series, closing/reopening instances, overdue counts,
-- and advisor clean-ups.
--
-- Dates: the institute works in Asia/Kolkata (APP_TIMEZONE in the app). Functions
-- that decide "today" run with that timezone so current_date is the local date.
-- =============================================================================

create or replace function public.institute_today()
returns date language sql stable set search_path = public
as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

alter function public.instantiate_template(uuid, uuid, jsonb) set timezone = 'Asia/Kolkata';
alter function public.add_slot_entry(uuid, uuid, jsonb) set timezone = 'Asia/Kolkata';
alter table public.template_instances alter column start_date set default public.institute_today();

-- -----------------------------------------------------------------------------
-- Run log
-- -----------------------------------------------------------------------------
create table public.scheduler_runs (
  id              uuid primary key default gen_random_uuid(),
  trigger         text not null check (trigger in ('schedule', 'manual')),
  run_date        date not null,
  triggered_by    uuid references public.profiles (id),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  series_checked  int not null default 0,
  created_count   int not null default 0,
  error_count     int not null default 0,
  errors          jsonb not null default '[]'::jsonb
);
create index scheduler_runs_started_idx on public.scheduler_runs (started_at desc);

alter table public.scheduler_runs enable row level security;
create policy scheduler_runs_select on public.scheduler_runs
  for select to authenticated using ((select public.has_perm('template.manage')));

-- Moves a series' cursor past periods that went by while it was paused, closed
-- or ended, so restarting never back-fills.
create or replace function public.skip_missed_periods(p_series uuid)
returns void language plpgsql security definer set search_path = public set timezone = 'Asia/Kolkata'
as $$
declare
  s public.recurring_series;
  p record;
begin
  select * into s from public.recurring_series where id = p_series;
  select * into p from public.period_for(s.recurrence, current_date);
  update public.recurring_series
     set last_period_end = greatest(coalesce(last_period_end, start_date - 1), p.period_start - 1)
   where id = p_series;
end;
$$;

-- The daily job: creates every due period for every active series. One failing
-- series is logged and skipped; the rest still run.
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
    select rs.id, rs.name, i.name as instance_name
    from public.recurring_series rs
    join public.template_instances i on i.id = rs.instance_id
    where not rs.is_paused
      and i.status = 'active'
      and (rs.last_period_end is null or rs.end_date is null or rs.last_period_end < rs.end_date)
      and (rs.last_period_end is null or i.end_date is null or rs.last_period_end < i.end_date)
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

create or replace function public.run_scheduler_now()
returns public.scheduler_runs
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_perm('template.manage') then
    raise exception 'You do not have permission to run the scheduler' using errcode = '42501';
  end if;
  return public.generate_due_requirements(null, 'manual');
end;
$$;

-- -----------------------------------------------------------------------------
-- Series controls
-- -----------------------------------------------------------------------------
create or replace function public.series_guard(p_series uuid)
returns public.recurring_series language plpgsql security definer set search_path = public
as $$
declare
  s public.recurring_series;
begin
  select * into s from public.recurring_series where id = p_series for update;
  if not found or not public.can_create_documents(s.department_id) then
    raise exception 'You do not have permission to change this series' using errcode = '42501';
  end if;
  return s;
end;
$$;

-- Returns how many requirements were created on resume.
create or replace function public.set_series_paused(p_series uuid, p_paused boolean)
returns int language plpgsql security definer set search_path = public set timezone = 'Asia/Kolkata'
as $$
declare
  s public.recurring_series := public.series_guard(p_series);
begin
  if s.is_paused = p_paused then
    return 0;
  end if;
  update public.recurring_series set is_paused = p_paused where id = p_series;
  if p_paused then
    return 0;
  end if;
  perform public.skip_missed_periods(p_series);
  return public.generate_series_due(p_series, current_date);
end;
$$;

-- p_end_date null removes the end date (restarts an ended series from the current period).
create or replace function public.set_series_end(p_series uuid, p_end_date date)
returns int language plpgsql security definer set search_path = public set timezone = 'Asia/Kolkata'
as $$
declare
  s public.recurring_series := public.series_guard(p_series);
begin
  if p_end_date is not null and p_end_date < s.start_date then
    raise exception 'The end date must be on or after %', to_char(s.start_date, 'FMDD Mon YYYY') using errcode = '23514';
  end if;
  update public.recurring_series set end_date = p_end_date where id = p_series;
  if s.is_paused or (p_end_date is not null and p_end_date < current_date) then
    return 0;
  end if;
  perform public.skip_missed_periods(p_series);
  return public.generate_series_due(p_series, current_date);
end;
$$;

-- -----------------------------------------------------------------------------
-- Closing / reopening an instance (and everything nested in it)
-- -----------------------------------------------------------------------------
create or replace function public.set_instance_status(p_instance uuid, p_active boolean)
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
  if p_active and inst.parent_instance_id is not null
     and exists (select 1 from public.template_instances where id = inst.parent_instance_id and status <> 'active') then
    raise exception 'Reopen the folder it belongs to first' using errcode = '23514';
  end if;

  with recursive tree as (
    select id from public.template_instances where id = p_instance
    union all
    select c.id from public.template_instances c join tree t on c.parent_instance_id = t.id
  )
  select array_agg(id) into v_ids from tree;

  update public.template_instances
     set status = case when p_active then 'active' else 'closed' end
   where id = any (v_ids) and status <> case when p_active then 'active' else 'closed' end;

  if p_active then
    for v_series in select id from public.recurring_series where instance_id = any (v_ids) and not is_paused loop
      perform public.skip_missed_periods(v_series);
      v_created := v_created + public.generate_series_due(v_series, current_date);
    end loop;
  end if;
  return v_created;
end;
$$;

-- -----------------------------------------------------------------------------
-- Overdue in the task counts
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
    'unread_notifications', (select count(*) from public.notifications
                             where user_id = auth.uid() and read_at is null)
  );
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke execute on function public.institute_today() from public, anon;
revoke execute on function public.skip_missed_periods(uuid) from public, anon, authenticated;
revoke execute on function public.generate_due_requirements(date, text) from public, anon, authenticated;
revoke execute on function public.series_guard(uuid) from public, anon, authenticated;
revoke execute on function public.run_scheduler_now() from public, anon;
revoke execute on function public.set_series_paused(uuid, boolean) from public, anon;
revoke execute on function public.set_series_end(uuid, date) from public, anon;
revoke execute on function public.set_instance_status(uuid, boolean) from public, anon;

grant execute on function public.institute_today() to authenticated;
grant execute on function public.generate_due_requirements(date, text) to service_role;
grant execute on function public.run_scheduler_now() to authenticated;
grant execute on function public.set_series_paused(uuid, boolean) to authenticated;
grant execute on function public.set_series_end(uuid, date) to authenticated;
grant execute on function public.set_instance_status(uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Advisor clean-ups
-- -----------------------------------------------------------------------------
-- Trigger functions are never meant to be called through the API (Postgres only
-- checks EXECUTE on them when a trigger is created, not when it fires).
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end;
$$;

create index recurring_series_folder_idx on public.recurring_series (folder_id);
create index recurring_series_department_idx on public.recurring_series (department_id);
create index recurring_series_uploader_idx on public.recurring_series (uploader_id);
create index template_instances_template_idx on public.template_instances (template_id);
create index template_nodes_parent_idx on public.template_nodes (parent_id);
create index template_nodes_slot_template_idx on public.template_nodes (slot_template_id);

-- -----------------------------------------------------------------------------
-- Daily schedule: 00:15 Asia/Kolkata = 18:45 UTC. Skipped where pg_cron is absent
-- (local tests).
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('dms-generate-due-requirements', '45 18 * * *',
                          'select public.generate_due_requirements()');
  end if;
end;
$$;
