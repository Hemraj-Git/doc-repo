-- =============================================================================
-- Phase 5: dashboard aggregates and search indexes
--
-- All functions are SECURITY INVOKER: they aggregate only the rows the caller's
-- RLS policies already let them see, so a chart never leaks a hidden document.
-- =============================================================================

-- Documents per department (visible to the caller).
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
  group by d.id, d.code, d.name
  order by count(doc.id) desc, d.name;
$$;

-- Documents per document type, optionally for one department.
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
  where p_department_id is null or doc.department_id = p_department_id
  group by t.code, t.name, t.sort_order
  order by count(doc.id) desc, t.sort_order;
$$;

-- Status counts for one department, plus approvals this calendar month.
create or replace function public.department_document_summary(p_department_id uuid, p_tz text default 'Asia/Kolkata')
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.documents where department_id = p_department_id),
    'pending_upload', (select count(*) from public.documents where department_id = p_department_id and status = 'pending_upload'),
    'changes_requested', (select count(*) from public.documents where department_id = p_department_id and status = 'changes_requested'),
    'in_review', (select count(*) from public.documents where department_id = p_department_id and status = 'in_review'),
    'approved', (select count(*) from public.documents where department_id = p_department_id and status = 'approved'),
    'approved_this_month', (
      select count(distinct a.entity_id) from public.audit_logs a
      where a.entity_type = 'document' and a.action = 'update'
        and a.department_id = p_department_id
        and a.after ->> 'status' = 'approved' and a.before ->> 'status' is distinct from 'approved'
        and date_trunc('month', a.created_at at time zone p_tz) = date_trunc('month', now() at time zone p_tz)
    )
  );
$$;

-- Daily uploads and approvals for the last p_days days (institute timezone).
-- Approvals come from the audit log, so they count for callers who can read it.
create or replace function public.activity_series(p_days int default 30, p_department_id uuid default null, p_tz text default 'Asia/Kolkata')
returns table (day date, uploads bigint, approvals bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with days as (
    select generate_series(
      (now() at time zone p_tz)::date - (greatest(p_days, 1) - 1),
      (now() at time zone p_tz)::date,
      interval '1 day'
    )::date as day
  ),
  uploads as (
    select (v.uploaded_at at time zone p_tz)::date as day, count(*) as n
    from public.document_versions v
    join public.documents d on d.id = v.document_id
    where v.uploaded_at >= now() - make_interval(days => greatest(p_days, 1) + 1)
      and (p_department_id is null or d.department_id = p_department_id)
    group by 1
  ),
  approvals as (
    select (a.created_at at time zone p_tz)::date as day, count(*) as n
    from public.audit_logs a
    where a.entity_type = 'document' and a.action = 'update'
      and a.after ->> 'status' = 'approved' and a.before ->> 'status' is distinct from 'approved'
      and a.created_at >= now() - make_interval(days => greatest(p_days, 1) + 1)
      and (p_department_id is null or a.department_id = p_department_id)
    group by 1
  )
  select days.day, coalesce(u.n, 0), coalesce(ap.n, 0)
  from days
  left join uploads u on u.day = days.day
  left join approvals ap on ap.day = days.day
  order by days.day;
$$;

-- Documents the caller recently viewed or downloaded.
create or replace function public.my_recent_documents(p_limit int default 8)
returns table (document_id uuid, last_access timestamptz, action text)
language sql
stable
security invoker
set search_path = public
as $$
  select * from (
    select distinct on (a.entity_id) a.entity_id::uuid as document_id, a.created_at as last_access, a.action
    from public.audit_logs a
    where a.actor_id = auth.uid()
      and a.entity_type = 'document'
      and a.action in ('view', 'download')
    order by a.entity_id, a.created_at desc
  ) latest
  order by last_access desc
  limit greatest(p_limit, 1);
$$;

-- Search: trigram indexes for name / Ref ID lookups.
create index if not exists documents_reference_id_trgm on public.documents using gin (reference_id extensions.gin_trgm_ops);
create index if not exists folders_name_trgm on public.folders using gin (name extensions.gin_trgm_ops);
create index if not exists audit_logs_action_idx on public.audit_logs (action, created_at desc);

revoke execute on function public.document_counts_by_department() from public, anon;
revoke execute on function public.document_counts_by_type(uuid) from public, anon;
revoke execute on function public.department_document_summary(uuid, text) from public, anon;
revoke execute on function public.activity_series(int, uuid, text) from public, anon;
revoke execute on function public.my_recent_documents(int) from public, anon;
grant execute on function public.document_counts_by_department() to authenticated;
grant execute on function public.document_counts_by_type(uuid) to authenticated;
grant execute on function public.department_document_summary(uuid, text) to authenticated;
grant execute on function public.activity_series(int, uuid, text) to authenticated;
grant execute on function public.my_recent_documents(int) to authenticated;
