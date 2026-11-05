-- =============================================================================
-- KPI periods now pass through two people:
--
--   Person submits → Reviewer approves → Scorer gives the 1–10 score
--
-- The reviewer approves, sends back or marks not applicable. A period missed by its
-- due date has nothing to approve, so the reviewer forwards it or marks it not
-- applicable. The scorer scores or marks not applicable; there is no send back.
--
-- Each KPI names its scorer: the head of a department (HR, Quality) or a person.
-- Assigning saves the resolved person on the assignment, as it does for the reviewer.
--
-- Scores, Final Scores and ratings already given are unchanged. The two kinds of DROP
-- below remove no data: the status rule is replaced, and two functions are recreated
-- because their inputs or outputs change.
-- =============================================================================

alter table public.kpis
  add column scorer_department_id uuid references public.departments (id) on delete set null,
  add column scorer_user_id uuid references public.profiles (id),
  add constraint kpis_scorer_one check (num_nonnulls(scorer_department_id, scorer_user_id) <= 1);
create index kpis_scorer_department_idx on public.kpis (scorer_department_id);
create index kpis_scorer_user_idx on public.kpis (scorer_user_id);

alter table public.kpi_assignments
  add column scorer_id uuid references public.profiles (id);
create index kpi_assignments_scorer_idx on public.kpi_assignments (scorer_id, status);

alter table public.kpi_entries
  add column approved_by uuid references public.profiles (id),
  add column approved_at timestamptz,
  add column approval_comment text check (char_length(approval_comment) <= 2000);
create index kpi_entries_approved_by_idx on public.kpi_entries (approved_by);

alter table public.kpi_entries drop constraint kpi_entries_status_check;
alter table public.kpi_entries add constraint kpi_entries_status_check
  check (status in ('open', 'submitted', 'changes_requested', 'approved', 'scored', 'not_applicable'));

-- The scorer can always see the assignment they score, including its files.
create or replace function public.can_view_kpi_assignment(p_assignment_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.kpi_assignments a
    where a.id = p_assignment_id
      and (a.user_id = auth.uid()
           or a.reviewer_id = auth.uid()
           or a.scorer_id = auth.uid()
           or a.assigned_by = auth.uid()
           or public.has_perm('kpi.view_all')
           or public.can_assign_kpis(a.department_id)
           or public.is_below_me(a.user_id))
  );
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
  insert into public.kpis (name, designation, description, year_start_month, reviewer_rule, reviewer_user_id, due_days,
                           scorer_department_id, scorer_user_id)
  values (v_name, k.designation, k.description, k.year_start_month, k.reviewer_rule, k.reviewer_user_id, k.due_days,
          k.scorer_department_id, k.scorer_user_id)
  returning id into v_new;
  insert into public.kpi_areas (kpi_id, name, weightage, description, sort_order, recurrence)
  select v_new, a.name, a.weightage, a.description, a.sort_order, a.recurrence
  from public.kpi_areas a where a.kpi_id = p_kpi;
  perform set_config('app.kpi_bulk_edit', 'off', true);
  return v_new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Assigning: resolves the scorer, like the reviewer. p_scorer replaces the KPI's setting.
-- -----------------------------------------------------------------------------
drop function public.assign_kpi(uuid, uuid[], date, date, uuid[], boolean);

create function public.assign_kpi(
  p_kpi uuid, p_user_ids uuid[], p_start date, p_end date, p_reviewer_ids uuid[] default null, p_backfill boolean default false,
  p_scorer uuid default null
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
  v_scorer uuid := coalesce(p_scorer, (select scorer_user_id from public.kpis where id = p_kpi));
  v_dept_name text;
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

  if v_scorer is null and k.scorer_department_id is not null then
    select head_user_id, name into v_scorer, v_dept_name from public.departments where id = k.scorer_department_id;
    if v_scorer is null then
      raise exception '% has no head. Set one, or choose a specific scorer.', v_dept_name using errcode = '23514';
    end if;
  end if;
  if v_scorer is null then
    raise exception 'Set the scorer of "%", or choose one when assigning.', k.name using errcode = '23514';
  end if;
  if not exists (select 1 from public.profiles where id = v_scorer and is_active) then
    raise exception 'The scorer must be an active user' using errcode = '23514';
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
    if v_scorer = u.id then
      raise exception '% cannot score their own KPI. Choose a different scorer.', u.full_name using errcode = '23514';
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
                                        start_date, end_date, reviewer_id, scorer_id, due_days, assigned_by)
    values (k.id, k.name, k.version, k.year_start_month, u.id, u.department_id,
            p_start, p_end, v_reviewer, v_scorer, k.due_days, auth.uid())
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
revoke execute on function public.assign_kpi(uuid, uuid[], date, date, uuid[], boolean, uuid) from public, anon;
grant execute on function public.assign_kpi(uuid, uuid[], date, date, uuid[], boolean, uuid) to authenticated;

-- The next KPI year with the current KPI definition, same person, reviewer and scorer. Scores start hidden.
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
      case when a.reviewer_id is null then null else array[a.reviewer_id] end, false, a.scorer_id);
  end loop;
  return v_created;
end;
$$;

-- -----------------------------------------------------------------------------
-- The person submits: the reviewer is asked to approve
-- -----------------------------------------------------------------------------
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
    perform public.notify_link(a.reviewer_id, 'kpi_to_review',
      'KPI to review: ' || (select full_name from public.profiles where id = a.user_id),
      (v_counts ->> v_id) || case when (v_counts ->> v_id)::int = 1 then ' period' else ' periods' end || ' of ' || a.kpi_name || ' waiting for your approval.',
      '/kpis/assignments/' || a.id);
  end loop;
  return v_count;
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
        || ' passed the due date with nothing submitted. Forward to the scorer or mark not applicable.',
      '/kpis/assignments/' || r.id);
    update public.kpi_entries set missed_notified_at = now()
     where assignment_id = r.id and status = 'open' and due_date < p_today and missed_notified_at is null;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;

-- -----------------------------------------------------------------------------
-- The reviewer: approve a submitted period, or forward a missed one
-- -----------------------------------------------------------------------------
create or replace function public.approve_kpi_entry(p_entry uuid, p_comment text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare
  e public.kpi_entries;
  a public.kpi_assignments;
  v_area text;
  v_assignment uuid;
  v_comment text := nullif(btrim(p_comment), '');
  v_person text;
  v_forward boolean;
begin
  select assignment_id into v_assignment from public.kpi_entries where id = p_entry;
  if not found then
    raise exception 'KPI period not found' using errcode = '23503';
  end if;
  select * into a from public.kpi_assignments where id = v_assignment for update;
  select * into e from public.kpi_entries where id = p_entry for update;

  if a.reviewer_id is distinct from auth.uid() then
    raise exception 'Only the reviewer can approve this KPI' using errcode = '42501';
  end if;
  if char_length(v_comment) > 2000 then
    raise exception 'The comment can be at most 2000 characters' using errcode = '23514';
  end if;

  if e.status = 'submitted' then
    v_forward := false;
  elsif e.status in ('open', 'changes_requested') then
    if a.status = 'active' and e.due_date >= public.institute_today() then
      raise exception 'This period can be forwarded once it is submitted or its due date has passed' using errcode = '23514';
    end if;
    v_forward := true;
  else
    raise exception 'Only a submitted or missed period can be approved' using errcode = '23514';
  end if;

  update public.kpi_entries
     set status = 'approved', approved_by = auth.uid(), approved_at = now(), approval_comment = v_comment, updated_at = now()
   where id = e.id;

  select name into v_area from public.kpi_assignment_areas where id = e.assignment_area_id;
  select full_name into v_person from public.profiles where id = a.user_id;
  perform public.kpi_audit(case when v_forward then 'kpi_entry_forwarded' else 'kpi_entry_approved' end, 'kpi_assignment', a,
    jsonb_build_object('entry_id', e.id, 'area', v_area, 'period', e.period_label));

  if a.scorer_id is null then
    perform public.notify_link(a.assigned_by, 'kpi_no_scorer', 'KPI has no scorer: ' || v_person,
      e.period_label || ' of ' || a.kpi_name || ' is waiting for a score. Choose a scorer.', '/kpis/assignments/' || a.id);
  else
    perform public.notify_link(a.scorer_id, 'kpi_to_score', 'KPI to score: ' || v_person,
      e.period_label || ' of ' || a.kpi_name || ' is waiting for your score.', '/kpis/assignments/' || a.id);
  end if;
  perform public.notify_link(a.user_id, 'kpi_reviewed',
    case when v_forward then 'KPI forwarded for scoring: ' else 'KPI approved: ' end || v_area,
    e.period_label || ' of ' || a.kpi_name
      || case when v_forward then ' passed its due date and was sent for scoring. It can no longer be submitted.' else ' was approved and sent for scoring.' end,
    '/kpis/assignments/' || a.id);
end;
$$;

-- -----------------------------------------------------------------------------
-- The scorer (and HR for corrections)
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
    if not (v_hr or (a.scorer_id = auth.uid() and a.scores_released_at is null and not v_final)) then
      raise exception 'Scores that have been released or finalised can only be changed by HR' using errcode = '42501';
    end if;
  else
    if a.scorer_id is distinct from auth.uid() then
      raise exception 'Only the scorer can score this KPI' using errcode = '42501';
    end if;
    if e.status = 'not_applicable' then
      raise exception 'This period is marked not applicable. Reopen it first.' using errcode = '23514';
    end if;
    if e.status <> 'approved' then
      raise exception 'The reviewer has to approve this period first' using errcode = '23514';
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
    perform public.notify_link(a.user_id, 'kpi_reviewed', 'KPI scored: ' || v_area,
      e.period_label || ' of ' || a.kpi_name || ' has been scored.', '/kpis/assignments/' || a.id);
  end if;
  perform public.generate_kpi_final_score(a.id);
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
  if a.user_id = auth.uid() or not (a.reviewer_id = auth.uid() or a.scorer_id = auth.uid() or public.can_assign_kpis(a.department_id)) then
    raise exception 'Only the reviewer, the scorer or HR can mark a period not applicable' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Give a reason' using errcode = '23514';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'The reason can be at most 1000 characters' using errcode = '23514';
  end if;
  if e.status not in ('open', 'changes_requested', 'submitted', 'approved') then
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

-- A reopened period goes back to the reviewer if something was submitted, else to the person.
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
  if a.user_id = auth.uid() or not (a.reviewer_id = auth.uid() or a.scorer_id = auth.uid() or public.can_assign_kpis(a.department_id)) then
    raise exception 'Only the reviewer, the scorer or HR can reopen a period' using errcode = '42501';
  end if;
  if e.status <> 'not_applicable' then
    raise exception 'Only a period marked not applicable can be reopened' using errcode = '23514';
  end if;
  update public.kpi_entries
     set status = case when submitted_at is null then 'open' else 'submitted' end,
         not_applicable_reason = null, not_applicable_by = null, not_applicable_at = null,
         approved_by = null, approved_at = null, approval_comment = null, updated_at = now()
   where id = e.id;
  select name into v_area from public.kpi_assignment_areas where id = e.assignment_area_id;
  perform public.kpi_audit('kpi_entry_reopened', 'kpi_assignment', a,
    jsonb_build_object('entry_id', e.id, 'area', v_area, 'period', e.period_label));
  perform public.generate_kpi_final_score(a.id);
end;
$$;

-- Release: the scorer or HR. Hiding again: HR only. The person cannot do either for themselves.
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
  if a.user_id = auth.uid() or not (v_hr or (p_released and a.scorer_id = auth.uid())) then
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
  perform public.notify_link(p_reviewer, 'kpi_to_review',
    'KPI to review: ' || (select full_name from public.profiles where id = a.user_id),
    'You are now the reviewer of ' || a.kpi_name || '.', '/kpis/assignments/' || a.id);
end;
$$;

create or replace function public.change_kpi_scorer(p_assignment uuid, p_scorer uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  a public.kpi_assignments;
begin
  select * into a from public.kpi_assignments where id = p_assignment for update;
  if not found or not public.can_assign_kpis(a.department_id) then
    raise exception 'You do not have permission to change this KPI assignment' using errcode = '42501';
  end if;
  if p_scorer = a.user_id then
    raise exception 'A person cannot score their own KPI' using errcode = '23514';
  end if;
  if not exists (select 1 from public.profiles where id = p_scorer and is_active) then
    raise exception 'The scorer must be an active user' using errcode = '23514';
  end if;
  if p_scorer is not distinct from a.scorer_id then
    return;
  end if;
  update public.kpi_assignments set scorer_id = p_scorer where id = a.id;
  perform public.kpi_audit('kpi_scorer_changed', 'kpi_assignment', a,
    jsonb_build_object('from_user_id', a.scorer_id, 'to_user_id', p_scorer));
  perform public.notify_link(p_scorer, 'kpi_to_score',
    'KPI to score: ' || (select full_name from public.profiles where id = a.user_id),
    'You are now the scorer of ' || a.kpi_name || '.', '/kpis/assignments/' || a.id);
end;
$$;
revoke execute on function public.approve_kpi_entry(uuid, text) from public, anon;
revoke execute on function public.change_kpi_scorer(uuid, uuid) from public, anon;
grant execute on function public.approve_kpi_entry(uuid, text) to authenticated;
grant execute on function public.change_kpi_scorer(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Results and tasks
-- -----------------------------------------------------------------------------
drop function public.kpi_assignment_results(uuid[]);

-- SECURITY INVOKER: RLS hides what the caller may not see, so the person gets blank
-- scores and no rating until release.
create function public.kpi_assignment_results(p_ids uuid[])
returns table (
  assignment_id uuid, total bigint, open_periods bigint, overdue bigint, submitted bigint, approved bigint, scored bigint,
  not_applicable bigint, undecided bigint, projected_score numeric, final_score numeric,
  final_rating text, final_generated_at timestamptz, areas jsonb
)
language sql stable security invoker set search_path = public
as $$
  with per_area as (
    select ar.assignment_id, ar.id, ar.name, ar.weightage, ar.sort_order,
           count(e.id) as total,
           count(e.id) filter (where e.status in ('open', 'changes_requested') and e.due_date >= public.institute_today()) as open_periods,
           count(e.id) filter (where e.status in ('open', 'changes_requested') and e.due_date < public.institute_today()) as overdue,
           count(e.id) filter (where e.status = 'submitted') as submitted,
           count(e.id) filter (where e.status = 'approved') as approved,
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
         sum(p.total)::bigint, sum(p.open_periods)::bigint, sum(p.overdue)::bigint, sum(p.submitted)::bigint, sum(p.approved)::bigint,
         sum(p.scored)::bigint, sum(p.not_applicable)::bigint,
         (sum(p.total) - sum(p.scored) - sum(p.not_applicable))::bigint,
         round(sum(p.score * p.weightage) / nullif(sum(p.weightage) filter (where p.score is not null), 0) * 10),
         f.final_score, f.final_rating, f.generated_at,
         jsonb_agg(jsonb_build_object('id', p.id, 'score', round(p.score, 2), 'total', p.total, 'scored', p.scored,
                                      'overdue', p.overdue, 'submitted', p.submitted, 'approved', p.approved, 'not_applicable', p.not_applicable)
                   order by p.sort_order, p.name)
  from per_area p
  left join public.kpi_final_scores f on f.assignment_id = p.assignment_id
  group by p.assignment_id, f.final_score, f.final_rating, f.generated_at;
$$;
revoke execute on function public.kpi_assignment_results(uuid[]) from public, anon;
grant execute on function public.kpi_assignment_results(uuid[]) to authenticated;

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
    'kpi_to_review', (select count(*) from public.kpi_entries e join public.kpi_assignments a on a.id = e.assignment_id
                      where a.reviewer_id = auth.uid()
                        and (e.status = 'submitted'
                             or (e.status in ('open', 'changes_requested')
                                 and (e.due_date < public.institute_today() or a.status = 'ended')))),
    'kpi_to_score', (select count(*) from public.kpi_entries e join public.kpi_assignments a on a.id = e.assignment_id
                     where a.scorer_id = auth.uid() and e.status = 'approved'),
    'unread_notifications', (select count(*) from public.notifications
                             where user_id = auth.uid() and read_at is null)
  );
$$;

-- -----------------------------------------------------------------------------
-- Hand-over: scoring moves too
-- -----------------------------------------------------------------------------
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
    'kpi_scores', (select count(*) from public.kpi_assignments a
                   where a.scorer_id = p_user
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
  v_kpi_scores int := 0;
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

  -- Nor score it.
  select a.kpi_name into d from public.kpi_assignments a
  where a.scorer_id = p_from and a.user_id = p_to
    and (a.status = 'active'
         or exists (select 1 from public.kpi_entries e where e.assignment_id = a.id and e.status not in ('scored', 'not_applicable')))
  limit 1;
  if found then
    raise exception '% would become the scorer of their own KPI "%". Choose someone else, or change its scorer first.', v_to_name, d.kpi_name
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

  -- KPIs they review or score, with anything still to decide
  update public.kpi_assignments a set reviewer_id = p_to
   where a.reviewer_id = p_from
     and (a.status = 'active'
          or exists (select 1 from public.kpi_entries e where e.assignment_id = a.id and e.status not in ('scored', 'not_applicable')));
  get diagnostics v_kpi_reviews = row_count;
  if v_kpi_reviews > 0 then
    perform public.notify_link(p_to, 'kpi_to_review', 'KPIs handed over to you',
      v_kpi_reviews || case when v_kpi_reviews = 1 then ' KPI' else ' KPIs' end || ' to review were handed over to you.', '/tasks');
  end if;
  update public.kpi_assignments a set scorer_id = p_to
   where a.scorer_id = p_from
     and (a.status = 'active'
          or exists (select 1 from public.kpi_entries e where e.assignment_id = a.id and e.status not in ('scored', 'not_applicable')));
  get diagnostics v_kpi_scores = row_count;
  if v_kpi_scores > 0 then
    perform public.notify_link(p_to, 'kpi_to_score', 'KPIs handed over to you',
      v_kpi_scores || case when v_kpi_scores = 1 then ' KPI' else ' KPIs' end || ' to score were handed over to you.', '/tasks');
  end if;
  update public.kpis set reviewer_user_id = p_to where reviewer_user_id = p_from;
  update public.kpis set scorer_user_id = p_to where scorer_user_id = p_from;

  if p_move_reports then
    update public.profiles set reports_to_id = p_to where reports_to_id = p_from and id <> p_to;
    get diagnostics v_reports = row_count;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, meta)
  select auth.uid(), 'work_handed_over', 'user', p_from::text, p.department_id,
         jsonb_build_object('to_user_id', p_to, 'uploads', v_uploads, 'reviews', v_reviews,
                            'series', v_series, 'reports', v_reports, 'kpi_reviews', v_kpi_reviews, 'kpi_scores', v_kpi_scores)
  from public.profiles p where p.id = p_from;

  return jsonb_build_object('uploads', v_uploads, 'reviews', v_reviews, 'series', v_series,
                            'reports', v_reports, 'kpi_reviews', v_kpi_reviews, 'kpi_scores', v_kpi_scores);
end;
$$;
