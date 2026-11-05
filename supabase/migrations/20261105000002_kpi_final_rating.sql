-- =============================================================================
-- The KPI's yearly result is out of 100, as a whole number, with a rating.
--
--   Period score      1 to 10, whole numbers, given by the reviewer
--   Area score        average of its periods, out of 10 (keeps two decimals)
--   Projected Score   areas weighted by weightage, x 10, rounded to a whole number
--   Final Score       the same, stored once the year is over and every period is decided
--
--   85 to 100  Outstanding
--   75 to 84   Very Good
--   65 to 74   Satisfactory
--   50 to 64   Improvement Required
--   below 50   Unsatisfactory
--
-- Whole numbers leave no gap between the bands: 84.67 becomes 85, which is Outstanding.
-- The rating is stored with the Final Score, so changing these bands later does not
-- rewrite past years. Additive only: kpi_assignment_scores stays, unused.
-- =============================================================================

alter table public.kpi_final_scores
  alter column final_score type numeric(5, 2),
  add column final_rating text;

create or replace function public.kpi_score_rating(p_score numeric)
returns text language sql immutable set search_path = public
as $$
  select case
    when p_score is null then null
    when p_score >= 85 then 'Outstanding'
    when p_score >= 75 then 'Very Good'
    when p_score >= 65 then 'Satisfactory'
    when p_score >= 50 then 'Improvement Required'
    else 'Unsatisfactory'
  end;
$$;

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
    select round(sum(score * weightage) / nullif(sum(weightage) filter (where score is not null), 0) * 10),
           coalesce(jsonb_agg(jsonb_build_object('area_id', id, 'name', name, 'weightage', weightage, 'score', round(score, 2))
                              order by sort_order, name), '[]'::jsonb)
      into v_score, v_areas
    from per_area;
  end if;

  if v_score is null then
    if f.final_score is not null then
      update public.kpi_final_scores set final_score = null, final_rating = null, area_scores = '[]'::jsonb, generated_at = null where assignment_id = a.id;
      perform public.kpi_audit('kpi_final_score_cleared', 'kpi_score', a, jsonb_build_object('old_score', f.final_score));
    end if;
    return null;
  end if;

  if f.final_score is not distinct from v_score and f.area_scores = v_areas then
    return v_score;
  end if;

  insert into public.kpi_final_scores (assignment_id, final_score, final_rating, area_scores, generated_at)
  values (a.id, v_score, public.kpi_score_rating(v_score), v_areas, now())
  on conflict (assignment_id) do update
    set final_score = excluded.final_score, final_rating = excluded.final_rating,
        area_scores = excluded.area_scores, generated_at = excluded.generated_at;
  perform public.kpi_audit(
    case when f.final_score is null then 'kpi_final_score_generated' else 'kpi_final_score_changed' end,
    'kpi_score', a, jsonb_build_object('old_score', f.final_score, 'new_score', v_score, 'old_rating', f.final_rating, 'rating', public.kpi_score_rating(v_score))
  );
  return v_score;
end;
$$;

-- SECURITY INVOKER: RLS hides what the caller may not see, so the person gets blank
-- scores and no rating until release.
create or replace function public.kpi_assignment_results(p_ids uuid[])
returns table (
  assignment_id uuid, total bigint, open_periods bigint, overdue bigint, submitted bigint, scored bigint,
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
         round(sum(p.score * p.weightage) / nullif(sum(p.weightage) filter (where p.score is not null), 0) * 10),
         f.final_score, f.final_rating, f.generated_at,
         jsonb_agg(jsonb_build_object('id', p.id, 'score', round(p.score, 2), 'total', p.total, 'scored', p.scored,
                                      'overdue', p.overdue, 'submitted', p.submitted, 'not_applicable', p.not_applicable)
                   order by p.sort_order, p.name)
  from per_area p
  left join public.kpi_final_scores f on f.assignment_id = p.assignment_id
  group by p.assignment_id, f.final_score, f.final_rating, f.generated_at;
$$;

revoke execute on function public.kpi_score_rating(numeric) from public, anon;
revoke execute on function public.kpi_assignment_results(uuid[]) from public, anon;
grant execute on function public.kpi_score_rating(numeric) to authenticated;
grant execute on function public.kpi_assignment_results(uuid[]) to authenticated;
