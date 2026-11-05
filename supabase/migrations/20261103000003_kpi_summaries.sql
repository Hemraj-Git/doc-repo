-- Progress of many KPI assignments at once (overview, dashboard). SECURITY INVOKER:
-- only evidence the caller may see is counted.
create or replace function public.kpi_assignment_summaries(p_ids uuid[])
returns table (assignment_id uuid, total bigint, done bigint, overdue bigint, in_review bigint, completion numeric)
language sql stable security invoker set search_path = public
as $$
  with per_area as (
    select ar.assignment_id, ar.id, ar.weightage,
           count(d.id) as total,
           count(d.id) filter (where d.status in ('approved', 'not_applicable')) as done,
           count(d.id) filter (where d.status in ('pending_upload', 'changes_requested') and d.due_date < public.institute_today()) as overdue,
           count(d.id) filter (where d.status = 'in_review') as in_review
    from public.kpi_assignment_areas ar
    left join public.kpi_assignment_items it on it.assignment_area_id = ar.id
    left join public.documents d on d.kpi_assignment_item_id = it.id
    where ar.assignment_id = any (p_ids)
    group by ar.assignment_id, ar.id
  )
  select assignment_id, sum(total)::bigint, sum(done)::bigint, sum(overdue)::bigint, sum(in_review)::bigint,
         coalesce(round(sum(weightage * done::numeric / nullif(total, 0)) / nullif(sum(weightage) filter (where total > 0), 0) * 100, 1), 0)
  from per_area
  group by assignment_id;
$$;

revoke execute on function public.kpi_assignment_summaries(uuid[]) from public, anon;
grant execute on function public.kpi_assignment_summaries(uuid[]) to authenticated;
