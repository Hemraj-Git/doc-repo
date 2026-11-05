-- =============================================================================
-- Phase 8C/8D: the public certificate verification portal (/verify).
--
-- The portal runs on the server with the service role; these functions are the
-- only way in. Every request is logged — including failures — with a hashed IP.
-- A matched request stores a snapshot of exactly what was shown, so its slip can
-- be re-displayed and checked later but never altered.
-- =============================================================================

create sequence public.verification_code_seq;

create table public.verification_requests (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null default (
                          'VRF-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' ||
                          lpad(nextval('public.verification_code_seq')::text, 6, '0')),
  slip_token            text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  kind                  text not null check (kind in ('form', 'certificate_link')),
  outcome               text not null check (outcome in ('matched', 'not_matched', 'rate_limited', 'captcha_failed')),
  requester_name        text,
  requester_org         text,
  requester_email       text,
  purpose               text,
  input_regd_no         text,
  input_name            text,
  input_certificate_no  text,
  ip_hash               text not null,
  user_agent            text,
  student_id            uuid references public.students (id),
  certificate_id        uuid references public.certificates (id),
  department_id         uuid references public.departments (id),
  snapshot              jsonb,
  created_at            timestamptz not null default now(),
  constraint verification_requests_code_key unique (code),
  constraint verification_requests_slip_token_key unique (slip_token)
);
create index verification_requests_ip_idx on public.verification_requests (ip_hash, created_at desc);
create index verification_requests_email_idx on public.verification_requests (lower(requester_email), created_at desc);
create index verification_requests_student_idx on public.verification_requests (student_id, created_at desc);
create index verification_requests_created_idx on public.verification_requests (created_at desc);
create index verification_requests_department_idx on public.verification_requests (department_id);
create index verification_requests_certificate_idx on public.verification_requests (certificate_id);

create or replace function public.verification_requests_immutable()
returns trigger language plpgsql set search_path = public
as $$
begin
  raise exception 'Verification records cannot be changed' using errcode = '42501';
end;
$$;
create trigger verification_requests_immutable before update on public.verification_requests
  for each row execute function public.verification_requests_immutable();
revoke execute on function public.verification_requests_immutable() from public, anon, authenticated;

alter table public.verification_requests enable row level security;
create policy verification_requests_select on public.verification_requests
  for select to authenticated using (
    (select public.has_perm('verification.view_log'))
    or (student_id is not null and (select public.can_view_students(department_id)))
  );

-- What the portal may show about a student: no contact, identity documents or DOB.
create or replace function public.student_public_snapshot(p_student_id uuid, p_highlight uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'student', jsonb_build_object(
      'full_name', s.full_name, 'regd_no', s.regd_no, 'course', s.course_name, 'batch', s.batch,
      'status', s.status, 'completion_date', s.completion_date, 'department', d.name),
    'certificates', coalesce((
      select jsonb_agg(jsonb_build_object(
               'type', t.name, 'certificate_no', c.certificate_no, 'issue_date', c.issue_date,
               'academic_year', c.academic_year, 'semester', c.semester,
               'result', case when t.show_result then c.result end,
               'status', c.status, 'status_changed_at', c.status_changed_at,
               'replaced_by', (select r.certificate_no from public.certificates r where r.id = c.replaced_by_id),
               'highlight', c.id = p_highlight)
             order by c.issue_date, t.sort_order)
      from public.certificates c join public.certificate_types t on t.id = c.certificate_type_id
      where c.student_id = s.id and c.current_file_id is not null), '[]'::jsonb),
    'institute', (select jsonb_build_object('name', institute_name, 'address', address, 'contact_email', contact_email)
                  from public.institute_settings limit 1)
  )
  from public.students s join public.departments d on d.id = s.department_id
  where s.id = p_student_id;
$$;

create or replace function public.verification_rate_limited(p_ip_hash text, p_email text, p_per_hour int, p_per_day int)
returns boolean language sql stable security definer set search_path = public
as $$
  select (select count(*) from public.verification_requests where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= p_per_hour
      or (select count(*) from public.verification_requests where ip_hash = p_ip_hash and created_at > now() - interval '1 day') >= p_per_day
      or (p_email is not null and (select count(*) from public.verification_requests
                                   where lower(requester_email) = lower(p_email) and created_at > now() - interval '1 day') >= p_per_day);
$$;

-- The verification form. Never says which field did not match.
create or replace function public.public_verify(
  p_regd_no text, p_name text, p_certificate_no text,
  p_requester_name text, p_requester_org text, p_requester_email text, p_purpose text,
  p_ip_hash text, p_user_agent text, p_captcha_ok boolean
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_outcome text;
  v_student uuid;
  v_dept uuid;
  v_cert uuid;
  v_cert_no text := nullif(left(btrim(p_certificate_no), 80), '');
  v_snapshot jsonb;
  v_row public.verification_requests;
begin
  if not coalesce(p_captcha_ok, false) then
    v_outcome := 'captcha_failed';
  elsif public.verification_rate_limited(p_ip_hash, nullif(btrim(p_requester_email), ''), 10, 50) then
    v_outcome := 'rate_limited';
  else
    select id, department_id into v_student, v_dept
    from public.students
    where public.normalize_regd(p_regd_no) <> ''
      and regd_no_normalized = public.normalize_regd(p_regd_no)
      and name_normalized = public.normalize_person_name(p_name);

    if v_student is null then
      v_outcome := 'not_matched';
    else
      v_outcome := 'matched';
      if v_cert_no is not null then
        select id into v_cert from public.certificates
        where student_id = v_student and certificate_no_normalized = public.normalize_regd(v_cert_no) and current_file_id is not null;
      end if;
      v_snapshot := public.student_public_snapshot(v_student, v_cert)
                    || jsonb_build_object('certificate_query', v_cert_no, 'certificate_found', v_cert is not null);
    end if;
  end if;

  insert into public.verification_requests (
    kind, outcome, requester_name, requester_org, requester_email, purpose,
    input_regd_no, input_name, input_certificate_no, ip_hash, user_agent,
    student_id, certificate_id, department_id, snapshot
  ) values (
    'form', v_outcome, left(btrim(p_requester_name), 120), left(btrim(p_requester_org), 160), left(btrim(p_requester_email), 160),
    left(btrim(p_purpose), 60), left(btrim(p_regd_no), 60), left(btrim(p_name), 160), v_cert_no, p_ip_hash, left(p_user_agent, 300),
    v_student, v_cert, v_dept, v_snapshot
  ) returning * into v_row;

  return jsonb_build_object(
    'outcome', v_outcome,
    'code', v_row.code,
    'slip_token', case when v_outcome = 'matched' then v_row.slip_token end,
    'created_at', v_row.created_at,
    'snapshot', v_snapshot
  );
end;
$$;

-- A certificate's QR link (/verify/c/<token>).
create or replace function public.public_certificate_by_token(p_token text, p_ip_hash text, p_user_agent text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  c public.certificates;
  v_outcome text;
  v_snapshot jsonb;
  v_row public.verification_requests;
begin
  if public.verification_rate_limited(p_ip_hash, null, 60, 300) then
    v_outcome := 'rate_limited';
  else
    select * into c from public.certificates where verify_token = p_token and current_file_id is not null;
    if c.id is null then
      v_outcome := 'not_matched';
    else
      v_outcome := 'matched';
      select jsonb_build_object(
               'certificate', jsonb_build_object(
                 'type', t.name, 'certificate_no', c.certificate_no, 'issue_date', c.issue_date,
                 'academic_year', c.academic_year, 'semester', c.semester,
                 'result', case when t.show_result then c.result end,
                 'status', c.status, 'status_changed_at', c.status_changed_at,
                 'replaced_by', (select r.certificate_no from public.certificates r where r.id = c.replaced_by_id)),
               'student', s.snapshot -> 'student',
               'institute', s.snapshot -> 'institute')
        into v_snapshot
      from public.certificate_types t,
           lateral (select public.student_public_snapshot(c.student_id, c.id) as snapshot) s
      where t.id = c.certificate_type_id;
    end if;
  end if;

  insert into public.verification_requests (kind, outcome, ip_hash, user_agent, student_id, certificate_id, department_id, snapshot)
  values ('certificate_link', v_outcome, p_ip_hash, left(p_user_agent, 300), c.student_id, c.id, c.department_id, v_snapshot)
  returning * into v_row;

  return jsonb_build_object('outcome', v_outcome, 'code', v_row.code, 'created_at', v_row.created_at, 'snapshot', v_snapshot);
end;
$$;

-- A verification slip, re-read from the stored record (/verify/slip/<token>).
create or replace function public.public_slip(p_token text)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'code', code, 'created_at', created_at, 'requester_name', requester_name, 'requester_org', requester_org,
    'requester_email', requester_email, 'purpose', purpose, 'input_regd_no', input_regd_no, 'input_name', input_name,
    'slip_token', slip_token, 'snapshot', snapshot)
  from public.verification_requests
  where slip_token = p_token and outcome = 'matched' and kind = 'form';
$$;

-- Public branding for the portal and slips.
create or replace function public.public_institute()
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object('name', institute_name, 'address', address, 'contact_email', contact_email, 'logo_path', logo_path)
  from public.institute_settings limit 1;
$$;

insert into storage.buckets (id, name, public, file_size_limit)
values ('branding', 'branding', true, 2097152)
on conflict (id) do nothing;

revoke execute on function public.student_public_snapshot(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.verification_rate_limited(text, text, int, int) from public, anon, authenticated;
revoke execute on function public.public_verify(text, text, text, text, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.public_certificate_by_token(text, text, text) from public, anon, authenticated;
revoke execute on function public.public_slip(text) from public, anon, authenticated;
revoke execute on function public.public_institute() from public, anon, authenticated;

grant execute on function public.public_verify(text, text, text, text, text, text, text, text, text, boolean) to service_role;
grant execute on function public.public_certificate_by_token(text, text, text) to service_role;
grant execute on function public.public_slip(text) to service_role;
grant execute on function public.public_institute() to service_role;
