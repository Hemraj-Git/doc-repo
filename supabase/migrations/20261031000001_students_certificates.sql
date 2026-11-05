-- =============================================================================
-- Phase 8A/8B: student profiles and their certificates.
--
-- Access is department-scoped like documents:
--   student.view.own_dept / student.view.all             see profiles + certificates
--   student.manage.own_dept / student.manage.any_dept     create, edit, import students
--   certificate.manage.own_dept / certificate.manage.any_dept   upload, replace, revoke
-- Certificates are issued the moment their file is recorded; files are written by
-- the server (service role) after it has checked them, as with document versions.
-- =============================================================================

insert into public.permissions (key, description, category, sort_order) values
  ('student.view.own_dept',       'View student profiles and certificates of own department',    'Students', 150),
  ('student.view.all',            'View student profiles and certificates of every department',  'Students', 155),
  ('student.manage.own_dept',     'Add, edit and import students of own department',             'Students', 160),
  ('student.manage.any_dept',     'Add, edit and import students of any department',             'Students', 165),
  ('certificate.manage.own_dept', 'Upload, replace and revoke certificates in own department',   'Students', 170),
  ('certificate.manage.any_dept', 'Upload, replace and revoke certificates in any department',   'Students', 175),
  ('verification.view_log',       'View the public certificate verification log',                'Students', 180)
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, 'student.view.own_dept' from public.roles r where r.system_key = 'department_head'
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Normalisation used for uniqueness and public matching
-- -----------------------------------------------------------------------------
-- "SOM/2026 001" → "SOM/2026001"
create or replace function public.normalize_regd(p text)
returns text language sql immutable set search_path = public
as $$
  select upper(regexp_replace(coalesce(p, ''), '\s+', '', 'g'));
$$;

-- "R. Kumar" and "r  kumar" → "r kumar"
create or replace function public.normalize_person_name(p text)
returns text language sql immutable set search_path = public
as $$
  select btrim(regexp_replace(lower(coalesce(p, '')), '[^[:alnum:]]+', ' ', 'g'));
$$;

-- -----------------------------------------------------------------------------
-- Permission helpers (current user, and an explicit user for server-side calls)
-- -----------------------------------------------------------------------------
create or replace function public.user_has_perm(p_user uuid, p_key text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = p_user and p.is_active and rp.permission_key = p_key
  );
$$;

create or replace function public.can_view_students_as(p_user uuid, p_department_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.user_has_perm(p_user, 'student.view.all')
      or public.user_has_perm(p_user, 'student.manage.any_dept')
      or public.user_has_perm(p_user, 'certificate.manage.any_dept')
      or ((public.user_has_perm(p_user, 'student.view.own_dept')
           or public.user_has_perm(p_user, 'student.manage.own_dept')
           or public.user_has_perm(p_user, 'certificate.manage.own_dept'))
          and p_department_id = (select department_id from public.profiles where id = p_user));
$$;

create or replace function public.can_manage_certificates_as(p_user uuid, p_department_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.user_has_perm(p_user, 'certificate.manage.any_dept')
      or (public.user_has_perm(p_user, 'certificate.manage.own_dept')
          and p_department_id = (select department_id from public.profiles where id = p_user));
$$;

create or replace function public.can_view_students(p_department_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.can_view_students_as(auth.uid(), p_department_id);
$$;

create or replace function public.can_manage_students(p_department_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.has_perm('student.manage.any_dept')
      or (public.has_perm('student.manage.own_dept') and p_department_id = public.my_dept());
$$;

create or replace function public.can_manage_certificates(p_department_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.can_manage_certificates_as(auth.uid(), p_department_id);
$$;

-- -----------------------------------------------------------------------------
-- Students
-- -----------------------------------------------------------------------------
create type public.student_status as enum ('enrolled', 'completed', 'discontinued', 'transferred');

create table public.students (
  id                  uuid primary key default gen_random_uuid(),
  regd_no             text not null,
  regd_no_normalized  text not null,
  full_name           text not null,
  name_normalized     text not null,
  enrollment_no       text,
  date_of_birth       date,
  gender              text check (gender in ('male', 'female', 'other')),
  nationality         text,
  department_id       uuid not null references public.departments (id),
  course_name         text not null,
  course_code         text,
  batch               text not null,
  admission_date      date,
  current_semester    int check (current_semester between 1 and 20),
  status              public.student_status not null default 'enrolled',
  completion_date     date,
  final_result        text,
  indos_no            text,
  cdc_no              text,
  passport_no         text,
  passport_expiry     date,
  sponsor             text,
  email               text,
  mobile              text,
  address             text,
  program_folder_id   uuid references public.folders (id) on delete set null,
  created_by          uuid default auth.uid() references public.profiles (id),
  created_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles (id),
  updated_at          timestamptz not null default now(),
  constraint students_regd_no_normalized_key unique (regd_no_normalized),
  constraint students_dates check (completion_date is null or admission_date is null or completion_date >= admission_date)
);
create index students_department_idx on public.students (department_id, status);
create index students_course_idx on public.students (department_id, lower(course_name), batch);
create index students_name_trgm on public.students using gin (name_normalized extensions.gin_trgm_ops);
create index students_indos_idx on public.students (upper(indos_no)) where indos_no is not null;
create index students_program_folder_idx on public.students (program_folder_id) where program_folder_id is not null;

create or replace function public.students_prepare()
returns trigger language plpgsql set search_path = public
as $$
declare
  c text;
begin
  new.regd_no := btrim(new.regd_no);
  new.full_name := regexp_replace(btrim(new.full_name), '\s+', ' ', 'g');
  new.course_name := btrim(new.course_name);
  new.batch := btrim(new.batch);
  if new.regd_no = '' then
    raise exception 'Enter the Regd No.' using errcode = '23514';
  end if;
  if new.full_name = '' then
    raise exception 'Enter the student''s full name' using errcode = '23514';
  end if;
  if new.course_name = '' then
    raise exception 'Enter the course' using errcode = '23514';
  end if;
  if new.batch = '' then
    raise exception 'Enter the batch' using errcode = '23514';
  end if;
  new.regd_no_normalized := public.normalize_regd(new.regd_no);
  new.name_normalized := public.normalize_person_name(new.full_name);
  -- Optional text fields: blank → null.
  foreach c in array array['enrollment_no', 'nationality', 'course_code', 'final_result', 'indos_no', 'cdc_no',
                           'passport_no', 'sponsor', 'email', 'mobile', 'address'] loop
    new := jsonb_populate_record(new, jsonb_build_object(c, nullif(btrim(to_jsonb(new) ->> c), '')));
  end loop;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.updated_by := public.current_actor();
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger students_prepare before insert or update on public.students
  for each row execute function public.students_prepare();
create trigger audit_students after insert or update on public.students
  for each row execute function public.audit_row_change('student');

alter table public.students enable row level security;
create policy students_select on public.students
  for select to authenticated using ((select public.can_view_students(department_id)));
create policy students_insert on public.students
  for insert to authenticated with check ((select public.can_manage_students(department_id)));
create policy students_update on public.students
  for update to authenticated
  using ((select public.can_manage_students(department_id)))
  with check ((select public.can_manage_students(department_id)));

-- All-or-nothing import. Each row: the students columns as JSON keys (department_id required).
-- SECURITY INVOKER: RLS decides which departments the caller may import into.
create or replace function public.import_students(p_rows jsonb)
returns int language plpgsql security invoker set search_path = public
as $$
declare
  r jsonb;
  i int := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Nothing to import' using errcode = '23514';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Import at most 2000 students at a time' using errcode = '23514';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      insert into public.students (
        regd_no, full_name, enrollment_no, date_of_birth, gender, nationality, department_id, course_name, course_code,
        batch, admission_date, current_semester, status, completion_date, final_result, indos_no, cdc_no,
        passport_no, passport_expiry, sponsor, email, mobile, address
      ) values (
        r ->> 'regd_no', r ->> 'full_name', r ->> 'enrollment_no', nullif(r ->> 'date_of_birth', '')::date,
        nullif(r ->> 'gender', ''), r ->> 'nationality', (r ->> 'department_id')::uuid, r ->> 'course_name', r ->> 'course_code',
        r ->> 'batch', nullif(r ->> 'admission_date', '')::date, nullif(r ->> 'current_semester', '')::int,
        coalesce(nullif(r ->> 'status', ''), 'enrolled')::public.student_status, nullif(r ->> 'completion_date', '')::date,
        r ->> 'final_result', r ->> 'indos_no', r ->> 'cdc_no', r ->> 'passport_no', nullif(r ->> 'passport_expiry', '')::date,
        r ->> 'sponsor', r ->> 'email', r ->> 'mobile', r ->> 'address'
      );
    exception
      when unique_violation then
        raise exception 'Row %: Regd No. "%" already exists', i, r ->> 'regd_no' using errcode = '23505';
      when insufficient_privilege then
        raise exception 'Row %: you cannot add students to this department', i using errcode = '42501';
      when others then
        raise exception 'Row %: %', i, sqlerrm using errcode = sqlstate;
    end;
  end loop;
  return i;
end;
$$;

-- -----------------------------------------------------------------------------
-- Certificate types
-- -----------------------------------------------------------------------------
create table public.certificate_types (
  id            uuid primary key default gen_random_uuid(),
  code          text not null,
  name          text not null,
  needs_period  boolean not null default false,
  show_result   boolean not null default false,
  is_active     boolean not null default true,
  sort_order    int not null default 100,
  created_at    timestamptz not null default now(),
  constraint certificate_types_code_key unique (code),
  constraint certificate_types_name_key unique (name)
);

insert into public.certificate_types (code, name, needs_period, show_result, sort_order) values
  ('MARKSHEET',   'Semester Marksheet',               true,  true,  10),
  ('PROVISIONAL', 'Provisional Certificate',          false, true,  20),
  ('FINAL',       'Final Certificate / Diploma',      false, true,  30),
  ('COMPLETION',  'Course Completion Certificate',    false, false, 40),
  ('TRANSCRIPT',  'Transcript',                       false, true,  50),
  ('BONAFIDE',    'Bonafide Certificate',             false, false, 60),
  ('MIGRATION',   'Migration Certificate',            false, false, 70),
  ('CONDUCT',     'Conduct Certificate',              false, false, 80),
  ('BST',         'STCW Basic Safety Training (BST)', false, false, 90),
  ('PST',         'STCW Personal Survival Techniques (PST)', false, false, 91),
  ('FPFF',        'STCW Fire Prevention & Fire Fighting (FPFF)', false, false, 92),
  ('EFA',         'STCW Elementary First Aid (EFA)',  false, false, 93),
  ('PSSR',        'STCW Personal Safety & Social Responsibilities (PSSR)', false, false, 94)
on conflict do nothing;

create trigger audit_certificate_types after insert or update on public.certificate_types
  for each row execute function public.audit_row_change('certificate_type');

alter table public.certificate_types enable row level security;
create policy certificate_types_select on public.certificate_types for select to authenticated using (true);
create policy certificate_types_insert on public.certificate_types
  for insert to authenticated with check ((select public.has_perm('document_type.manage')));
create policy certificate_types_update on public.certificate_types
  for update to authenticated
  using ((select public.has_perm('document_type.manage')))
  with check ((select public.has_perm('document_type.manage')));

-- -----------------------------------------------------------------------------
-- Certificates and their files
-- -----------------------------------------------------------------------------
create type public.certificate_status as enum ('issued', 'revoked', 'replaced');

create table public.certificates (
  id                         uuid primary key default gen_random_uuid(),
  student_id                 uuid not null references public.students (id),
  department_id              uuid not null references public.departments (id),
  certificate_type_id        uuid not null references public.certificate_types (id),
  certificate_no             text not null,
  certificate_no_normalized  text not null,
  issue_date                 date not null,
  academic_year              text,
  semester                   int check (semester between 1 and 20),
  result                     text,
  remarks                    text,
  status                     public.certificate_status not null default 'issued',
  status_reason              text,
  status_changed_at          timestamptz,
  status_changed_by          uuid references public.profiles (id),
  replaced_by_id             uuid references public.certificates (id),
  -- Printed as a QR code on the certificate: /verify/c/<token>.
  verify_token               text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  current_file_id            uuid,
  created_by                 uuid references public.profiles (id),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint certificates_certificate_no_normalized_key unique (certificate_no_normalized),
  constraint certificates_verify_token_key unique (verify_token)
);
create index certificates_student_idx on public.certificates (student_id, issue_date desc);
create index certificates_department_idx on public.certificates (department_id);
create index certificates_type_idx on public.certificates (certificate_type_id);
create index certificates_replaced_by_idx on public.certificates (replaced_by_id) where replaced_by_id is not null;

create table public.certificate_files (
  id                 uuid primary key default gen_random_uuid(),
  certificate_id     uuid not null references public.certificates (id),
  version_no         int not null,
  storage_path       text not null unique,
  original_filename  text not null,
  file_format        public.file_format not null,
  mime_type          text not null,
  size_bytes         bigint not null,
  sha256             text not null,
  reason             text,
  uploaded_by        uuid not null references public.profiles (id),
  uploaded_at        timestamptz not null default now(),
  constraint certificate_files_version_key unique (certificate_id, version_no)
);
create index certificate_files_uploaded_by_idx on public.certificate_files (uploaded_by);

alter table public.certificates
  add constraint certificates_current_file_fkey foreign key (current_file_id) references public.certificate_files (id);
create index certificates_current_file_idx on public.certificates (current_file_id);

create trigger audit_certificates after insert or update on public.certificates
  for each row execute function public.audit_row_change('certificate');

alter table public.certificates enable row level security;
alter table public.certificate_files enable row level security;
create policy certificates_select on public.certificates
  for select to authenticated using ((select public.can_view_students(department_id)));
create policy certificate_files_select on public.certificate_files
  for select to authenticated using (
    exists (select 1 from public.certificates c where c.id = certificate_id and public.can_view_students(c.department_id))
  );

insert into storage.buckets (id, name, public, file_size_limit)
values ('certificates', 'certificates', false, 20971520)
on conflict (id) do nothing;

-- Server side, after the uploaded file has been checked. Issues the certificate.
create or replace function public.record_certificate(
  p_actor uuid, p_student_id uuid, p_type_id uuid, p_certificate_no text, p_issue_date date,
  p_academic_year text, p_semester int, p_result text, p_remarks text,
  p_storage_path text, p_original_filename text, p_file_format public.file_format, p_mime_type text,
  p_size_bytes bigint, p_sha256 text
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  s public.students;
  t public.certificate_types;
  v_id uuid;
  v_file uuid;
begin
  perform set_config('app.actor_id', p_actor::text, true);
  select * into s from public.students where id = p_student_id;
  if not found then
    raise exception 'Student not found' using errcode = '23503';
  end if;
  if not public.can_manage_certificates_as(p_actor, s.department_id) then
    raise exception 'You do not have permission to issue certificates in this department' using errcode = '42501';
  end if;
  if p_storage_path not like s.department_id || '/' || s.id || '/%' then
    raise exception 'Invalid storage path' using errcode = '23514';
  end if;
  select * into t from public.certificate_types where id = p_type_id and is_active;
  if not found then
    raise exception 'Choose an active certificate type' using errcode = '23514';
  end if;
  if nullif(btrim(p_certificate_no), '') is null then
    raise exception 'Enter the certificate number' using errcode = '23514';
  end if;
  if p_issue_date is null or p_issue_date > current_date + 1 then
    raise exception 'Enter a valid issue date (not in the future)' using errcode = '23514';
  end if;
  if t.needs_period and nullif(btrim(p_academic_year), '') is null then
    raise exception '% needs the academic year', t.name using errcode = '23514';
  end if;

  insert into public.certificates (student_id, department_id, certificate_type_id, certificate_no, certificate_no_normalized,
                                   issue_date, academic_year, semester, result, remarks, created_by)
  values (s.id, s.department_id, t.id, btrim(p_certificate_no), public.normalize_regd(p_certificate_no),
          p_issue_date, nullif(btrim(p_academic_year), ''), p_semester, nullif(btrim(p_result), ''), nullif(btrim(p_remarks), ''), p_actor)
  returning id into v_id;

  insert into public.certificate_files (certificate_id, version_no, storage_path, original_filename, file_format, mime_type,
                                        size_bytes, sha256, uploaded_by)
  values (v_id, 1, p_storage_path, p_original_filename, p_file_format, p_mime_type, p_size_bytes, p_sha256, p_actor)
  returning id into v_file;
  update public.certificates set current_file_id = v_file where id = v_id;
  return v_id;
end;
$$;

-- A corrected scan of the same certificate. The earlier file stays as a version.
create or replace function public.replace_certificate_file(
  p_actor uuid, p_certificate_id uuid, p_reason text,
  p_storage_path text, p_original_filename text, p_file_format public.file_format, p_mime_type text,
  p_size_bytes bigint, p_sha256 text
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  c public.certificates;
  v_file uuid;
  v_no int;
begin
  perform set_config('app.actor_id', p_actor::text, true);
  select * into c from public.certificates where id = p_certificate_id for update;
  if not found or not public.can_manage_certificates_as(p_actor, c.department_id) then
    raise exception 'You do not have permission to change this certificate' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Give a reason for replacing the file' using errcode = '23514';
  end if;
  if p_storage_path not like c.department_id || '/' || c.student_id || '/%' then
    raise exception 'Invalid storage path' using errcode = '23514';
  end if;
  select coalesce(max(version_no), 0) + 1 into v_no from public.certificate_files where certificate_id = c.id;
  insert into public.certificate_files (certificate_id, version_no, storage_path, original_filename, file_format, mime_type,
                                        size_bytes, sha256, reason, uploaded_by)
  values (c.id, v_no, p_storage_path, p_original_filename, p_file_format, p_mime_type, p_size_bytes, p_sha256, btrim(p_reason), p_actor)
  returning id into v_file;
  update public.certificates set current_file_id = v_file, updated_at = now() where id = c.id;
  return v_file;
end;
$$;

-- Revoke a certificate, or mark it replaced by a re-issued one (by its number).
create or replace function public.revoke_certificate(p_certificate_id uuid, p_reason text, p_replacement_no text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare
  c public.certificates;
  v_new uuid;
begin
  select * into c from public.certificates where id = p_certificate_id for update;
  if not found or not public.can_manage_certificates(c.department_id) then
    raise exception 'You do not have permission to change this certificate' using errcode = '42501';
  end if;
  if c.status <> 'issued' then
    raise exception 'This certificate is already %', c.status using errcode = '23514';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Give a reason' using errcode = '23514';
  end if;
  if nullif(btrim(p_replacement_no), '') is not null then
    select id into v_new from public.certificates
    where certificate_no_normalized = public.normalize_regd(p_replacement_no) and student_id = c.student_id and id <> c.id;
    if v_new is null then
      raise exception 'No certificate % found for this student. Upload the new one first.', btrim(p_replacement_no) using errcode = '23514';
    end if;
  end if;
  update public.certificates
     set status = case when v_new is null then 'revoked' else 'replaced' end::public.certificate_status,
         status_reason = btrim(p_reason), status_changed_at = now(), status_changed_by = auth.uid(),
         replaced_by_id = v_new, updated_at = now()
   where id = c.id;
end;
$$;

-- "Viewed profile" / "downloaded certificate" in the audit trail.
create or replace function public.log_student_access(p_student_id uuid, p_action text, p_certificate_id uuid default null)
returns void language plpgsql security definer set search_path = public
as $$
declare
  s public.students;
begin
  if p_action not in ('view', 'certificate_view', 'certificate_download') then
    raise exception 'Unknown action' using errcode = '22023';
  end if;
  select * into s from public.students where id = p_student_id;
  if not found or not public.can_view_students(s.department_id) then
    return;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, after)
  values (auth.uid(), p_action, 'student', s.id::text, s.department_id,
          jsonb_build_object('full_name', s.full_name, 'regd_no', s.regd_no, 'certificate_id', p_certificate_id));
end;
$$;

revoke execute on function public.user_has_perm(uuid, text) from public, anon, authenticated;
revoke execute on function public.can_view_students_as(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.can_manage_certificates_as(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.can_view_students(uuid) from public, anon;
revoke execute on function public.can_manage_students(uuid) from public, anon;
revoke execute on function public.can_manage_certificates(uuid) from public, anon;
revoke execute on function public.import_students(jsonb) from public, anon;
revoke execute on function public.record_certificate(uuid, uuid, uuid, text, date, text, int, text, text, text, text, public.file_format, text, bigint, text) from public, anon, authenticated;
revoke execute on function public.replace_certificate_file(uuid, uuid, text, text, text, public.file_format, text, bigint, text) from public, anon, authenticated;
revoke execute on function public.revoke_certificate(uuid, text, text) from public, anon;
revoke execute on function public.log_student_access(uuid, text, uuid) from public, anon;
revoke execute on function public.students_prepare() from public, anon, authenticated;

grant execute on function public.can_view_students(uuid) to authenticated;
grant execute on function public.can_manage_students(uuid) to authenticated;
grant execute on function public.can_manage_certificates(uuid) to authenticated;
grant execute on function public.import_students(jsonb) to authenticated;
grant execute on function public.record_certificate(uuid, uuid, uuid, text, date, text, int, text, text, text, text, public.file_format, text, bigint, text) to service_role;
grant execute on function public.replace_certificate_file(uuid, uuid, text, text, text, public.file_format, text, bigint, text) to service_role;
grant execute on function public.revoke_certificate(uuid, text, text) to authenticated;
grant execute on function public.log_student_access(uuid, text, uuid) to authenticated;
