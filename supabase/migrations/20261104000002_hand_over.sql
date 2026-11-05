-- =============================================================================
-- Hand over a person's open work (e.g. before deactivating someone who left)
-- =============================================================================
-- Without this, a deactivated user's open uploads and review steps had nobody to
-- act on them, and a document in review could not be reassigned at all (reviewers
-- are locked while a review runs).
--
--   user_open_work(user)                 what is still waiting on the person
--   hand_over_work(from, to, reports)    moves it to a successor in one transaction
--
-- Personal KPI evidence is not handed over: deactivating a person ends their
-- active KPI assignments and marks their outstanding evidence not applicable
-- (a trigger, so it happens however the account is deactivated).

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
  return null;
end;
$$;

create trigger profiles_end_kpis_on_deactivation
  after update of is_active on public.profiles
  for each row when (old.is_active and not new.is_active)
  execute function public.profiles_end_kpis_on_deactivation();

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
               where uploader_id = p_user or slot_owner_id = p_user
                  or reviewer_rules @> jsonb_build_array(jsonb_build_object('user_id', p_user))),
    'kpis', (select count(*) from public.kpi_assignments where user_id = p_user and status = 'active'),
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
  -- KPI series of other people that name the leaver as a fixed reviewer
  update public.recurring_series s
     set reviewer_rules = (
           select coalesce(jsonb_agg(case when e ->> 'user_id' = p_from::text then jsonb_set(e, '{user_id}', to_jsonb(p_to)) else e end order by o), '[]'::jsonb)
           from jsonb_array_elements(s.reviewer_rules) with ordinality as t(e, o)
         )
   where s.kpi_assignment_id is not null and s.uploader_id <> p_to
     and s.reviewer_rules @> jsonb_build_array(jsonb_build_object('user_id', p_from));
  update public.kpi_assignments
     set reviewer_ids = array_replace(reviewer_ids, p_from, p_to)
   where p_from = any (reviewer_ids) and user_id <> p_to and not (p_to = any (reviewer_ids));
  update public.template_instances set slot_owner_id = p_to where slot_owner_id = p_from;

  if p_move_reports then
    update public.profiles set reports_to_id = p_to where reports_to_id = p_from and id <> p_to;
    get diagnostics v_reports = row_count;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, meta)
  select auth.uid(), 'work_handed_over', 'user', p_from::text, p.department_id,
         jsonb_build_object('to_user_id', p_to, 'uploads', v_uploads, 'reviews', v_reviews,
                            'series', v_series, 'reports', v_reports)
  from public.profiles p where p.id = p_from;

  return jsonb_build_object('uploads', v_uploads, 'reviews', v_reviews, 'series', v_series, 'reports', v_reports);
end;
$$;

revoke execute on function public.profiles_end_kpis_on_deactivation() from public, anon, authenticated;
revoke execute on function public.user_open_work(uuid) from public, anon;
revoke execute on function public.hand_over_work(uuid, uuid, boolean) from public, anon;
grant execute on function public.user_open_work(uuid) to authenticated;
grant execute on function public.hand_over_work(uuid, uuid, boolean) to authenticated;
