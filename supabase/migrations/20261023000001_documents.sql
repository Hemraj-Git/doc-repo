-- =============================================================================
-- Phase 4: documents (requirements), versions, sequential review, notifications
--
--   create_document()          HOD/Admin defines the requirement: name, type,
--                              uploader, optional reviewers in sequence
--   record_document_version()  server, after verifying the uploaded file
--   decide_review()            active reviewer approves or requests changes
--
-- All workflow writes go through these functions; clients have read-only RLS.
-- =============================================================================

create type public.document_status as enum ('pending_upload', 'in_review', 'changes_requested', 'approved');
create type public.file_format as enum ('image', 'pdf', 'word', 'excel', 'ppt');
create type public.review_state as enum ('waiting', 'active', 'approved', 'rejected', 'skipped');

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table public.documents (
  id                    uuid primary key default gen_random_uuid(),
  folder_id             uuid not null references public.folders (id),
  department_id         uuid not null references public.departments (id),
  name                  text not null,
  -- Required for standalone documents (directly in a department root), otherwise null.
  reference_id          text,
  document_type_id      uuid not null references public.document_types (id),
  description           text,
  assigned_uploader_id  uuid not null references public.profiles (id),
  requires_review       boolean not null default false,
  status                public.document_status not null default 'pending_upload',
  current_version_id    uuid,
  review_round          int not null default 0,
  due_date              date,
  created_by            uuid not null default auth.uid() references public.profiles (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint documents_name_length check (btrim(name) <> '' and char_length(name) <= 200)
);

create index documents_folder_id_idx on public.documents (folder_id);
create index documents_department_status_idx on public.documents (department_id, status);
create index documents_uploader_status_idx on public.documents (assigned_uploader_id, status);
create index documents_created_by_idx on public.documents (created_by);
create index documents_name_trgm on public.documents using gin (name extensions.gin_trgm_ops);

-- The reviewers configured on the requirement, in order.
create table public.document_reviewers (
  document_id  uuid not null references public.documents (id) on delete cascade,
  step_order   int not null check (step_order >= 1),
  reviewer_id  uuid not null references public.profiles (id),
  primary key (document_id, step_order),
  constraint document_reviewers_unique_reviewer unique (document_id, reviewer_id)
);
create index document_reviewers_reviewer_idx on public.document_reviewers (reviewer_id);

create table public.document_versions (
  id                 uuid primary key default gen_random_uuid(),
  document_id        uuid not null references public.documents (id),
  version_no         int not null,
  storage_path       text not null unique,
  original_filename  text not null,
  file_format        public.file_format not null,
  mime_type          text not null,
  size_bytes         bigint not null check (size_bytes > 0),
  sha256             text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  note               text,
  uploaded_by        uuid not null references public.profiles (id),
  uploaded_at        timestamptz not null default now(),
  constraint document_versions_number_key unique (document_id, version_no)
);

alter table public.documents
  add constraint documents_current_version_fkey foreign key (current_version_id) references public.document_versions (id);

-- One row per reviewer per review round (a round is created for every uploaded
-- version that needs review), so the full history is kept.
create table public.document_review_steps (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.documents (id),
  version_id    uuid not null references public.document_versions (id),
  round         int not null,
  step_order    int not null,
  reviewer_id   uuid not null references public.profiles (id),
  state         public.review_state not null,
  comment       text,
  activated_at  timestamptz,
  decided_at    timestamptz,
  constraint document_review_steps_order_key unique (version_id, step_order)
);
create index document_review_steps_reviewer_state_idx on public.document_review_steps (reviewer_id, state);
create index document_review_steps_document_idx on public.document_review_steps (document_id, round, step_order);

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  type         text not null,
  title        text not null,
  body         text,
  link         text,
  document_id  uuid references public.documents (id),
  actor_id     uuid,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- -----------------------------------------------------------------------------
-- Document integrity: department from folder, Ref ID only (and always) for
-- standalone documents, Ref ID register.
-- -----------------------------------------------------------------------------
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
  new.name := btrim(new.name);

  if v_folder.level = 'root' then
    new.reference_id := nullif(btrim(new.reference_id), '');
    if new.reference_id is null then
      raise exception 'Standalone documents need a Reference ID' using errcode = '23514';
    end if;
    if new.reference_id !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$' then
      raise exception 'Reference ID may only contain letters, digits, ".", "_", "/" and "-" (max 60 characters)'
        using errcode = '23514';
    end if;
  else
    new.reference_id := null;
  end if;
  return new;
end;
$$;

create trigger documents_prepare
  before insert or update on public.documents
  for each row execute function public.documents_prepare();

create or replace function public.documents_sync_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.reference_id is distinct from old.reference_id then
    perform public.sync_reference_id('document', new.id, new.reference_id);
  end if;
  return null;
end;
$$;

create trigger documents_sync_reference
  after insert or update of reference_id on public.documents
  for each row execute function public.documents_sync_reference();

create trigger documents_updated_at before update on public.documents
  for each row execute function public.set_updated_at();

-- Audit: everything about a document is filed under the document's id.
create trigger audit_documents after insert or update or delete on public.documents
  for each row execute function public.audit_row_change('document');
create trigger audit_document_versions after insert on public.document_versions
  for each row execute function public.audit_row_change('document_version', 'document_id');
create trigger audit_document_reviewers after insert or delete on public.document_reviewers
  for each row execute function public.audit_row_change('document_reviewer', 'document_id');
create trigger audit_document_review_steps after insert or update on public.document_review_steps
  for each row execute function public.audit_row_change('document_review', 'document_id');

-- audit_row_change reads department_id from the row; versions/reviews don't carry
-- one, so fill it in from the document.
create or replace function public.audit_fill_document_department()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.department_id is null and new.entity_type in ('document_version', 'document_reviewer', 'document_review')
     and new.entity_id ~ '^[0-9a-f-]{36}$' then
    select department_id into new.department_id from public.documents where id = new.entity_id::uuid;
  end if;
  return new;
end;
$$;

create trigger audit_fill_document_department
  before insert on public.audit_logs
  for each row execute function public.audit_fill_document_department();

-- Folders holding documents cannot be deleted.
create or replace function public.folders_guard_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.level = 'root' then
    raise exception 'Department folders cannot be deleted' using errcode = '23514';
  end if;
  if exists (select 1 from public.folders where parent_id = old.id) then
    raise exception 'Delete the sub-folders of "%" first', old.name using errcode = '23514';
  end if;
  if exists (select 1 from public.documents where folder_id = old.id) then
    raise exception 'Folder "%" contains documents and cannot be deleted', old.name using errcode = '23514';
  end if;
  return old;
end;
$$;

-- -----------------------------------------------------------------------------
-- Access rules
-- -----------------------------------------------------------------------------

-- Who can see a document:
--  * document.view.all, or document.view.own_dept within their department (HOD)
--  * the assigned uploader, the creator, any reviewer
--  * anyone above the uploader in the hierarchy
--  * anyone above the department head (the document owner), e.g. the Director
create or replace function public.can_view_document_row(
  p_document_id uuid, p_department_id uuid, p_uploader_id uuid, p_created_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_perm('document.view.all')
      or (public.has_perm('document.view.own_dept') and p_department_id = public.my_dept())
      or p_uploader_id = auth.uid()
      or p_created_by = auth.uid()
      or exists (select 1 from public.document_reviewers r where r.document_id = p_document_id and r.reviewer_id = auth.uid())
      or exists (select 1 from public.document_review_steps s where s.document_id = p_document_id and s.reviewer_id = auth.uid())
      or public.is_below_me(p_uploader_id)
      or exists (
        select 1 from public.departments d
        where d.id = p_department_id and d.head_user_id is not null and public.is_below_me(d.head_user_id)
      );
$$;

create or replace function public.can_view_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.documents d
    where d.id = p_document_id
      and public.can_view_document_row(d.id, d.department_id, d.assigned_uploader_id, d.created_by)
  );
$$;

create or replace function public.can_create_documents(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_perm('document.create.any_dept')
      or (public.has_perm('document.create.own_dept') and p_department_id = public.my_dept());
$$;

-- The requirement can be edited by its creator or anyone who may create documents there.
create or replace function public.can_manage_document(p_document_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.documents d
    where d.id = p_document_id
      and (d.created_by = auth.uid() or public.can_create_documents(d.department_id))
  );
$$;

alter table public.documents enable row level security;
alter table public.document_reviewers enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_review_steps enable row level security;
alter table public.notifications enable row level security;

create policy documents_select on public.documents
  for select to authenticated
  using (public.can_view_document_row(id, department_id, assigned_uploader_id, created_by));
create policy document_reviewers_select on public.document_reviewers
  for select to authenticated using (public.can_view_document(document_id));
create policy document_versions_select on public.document_versions
  for select to authenticated using (public.can_view_document(document_id));
create policy document_review_steps_select on public.document_review_steps
  for select to authenticated using (public.can_view_document(document_id));
create policy notifications_select on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

-- A document's audit trail is visible to everyone who can see the document.
create or replace function public.can_view_document_entity(p_entity_type text, p_entity_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_entity_type in ('document', 'document_version', 'document_reviewer', 'document_review')
     and p_entity_id ~ '^[0-9a-f-]{36}$'
     and public.can_view_document(p_entity_id::uuid);
$$;

create policy audit_logs_select_documents on public.audit_logs
  for select to authenticated using (public.can_view_document_entity(entity_type, entity_id));

-- -----------------------------------------------------------------------------
-- Internal helpers
-- -----------------------------------------------------------------------------
create or replace function public.notify(
  p_user_id uuid, p_type text, p_title text, p_body text, p_document_id uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, type, title, body, link, document_id, actor_id)
  select p_user_id, p_type, p_title, p_body, '/documents/' || p_document_id, p_document_id, public.current_actor()
  where p_user_id is not null and p_user_id is distinct from public.current_actor();
$$;

-- Validates and stores the ordered reviewer list.
create or replace function public.set_document_reviewers(p_document_id uuid, p_uploader_id uuid, p_reviewer_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[] := coalesce(p_reviewer_ids, '{}');
begin
  if array_length(v_ids, 1) is not null then
    if (select count(distinct x) from unnest(v_ids) x) <> array_length(v_ids, 1) then
      raise exception 'Each reviewer can appear only once' using errcode = '23514';
    end if;
    if p_uploader_id = any (v_ids) then
      raise exception 'The uploader cannot also review the document' using errcode = '23514';
    end if;
    if exists (
      select 1 from unnest(v_ids) x
      where not exists (select 1 from public.profiles p where p.id = x and p.is_active)
    ) then
      raise exception 'Every reviewer must be an active user' using errcode = '23514';
    end if;
  end if;

  delete from public.document_reviewers where document_id = p_document_id;
  insert into public.document_reviewers (document_id, step_order, reviewer_id)
  select p_document_id, o, x from unnest(v_ids) with ordinality as t(x, o);
end;
$$;

-- -----------------------------------------------------------------------------
-- Workflow
-- -----------------------------------------------------------------------------
create or replace function public.create_document(
  p_folder_id uuid,
  p_name text,
  p_document_type_id uuid,
  p_reference_id text,
  p_description text,
  p_uploader_id uuid,
  p_requires_review boolean,
  p_reviewer_ids uuid[],
  p_due_date date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder public.folders;
  v_id uuid;
begin
  select * into v_folder from public.folders where id = p_folder_id;
  if not found or not public.can_see_department(v_folder.department_id) then
    raise exception 'Folder not found' using errcode = '23503';
  end if;
  if not public.can_create_documents(v_folder.department_id) then
    raise exception 'You do not have permission to create documents in this department' using errcode = '42501';
  end if;
  if not exists (select 1 from public.document_types where id = p_document_type_id and is_active) then
    raise exception 'Select an active document type' using errcode = '23514';
  end if;
  if not exists (select 1 from public.profiles where id = p_uploader_id and is_active) then
    raise exception 'The uploader must be an active user' using errcode = '23514';
  end if;
  if p_requires_review and coalesce(array_length(p_reviewer_ids, 1), 0) = 0 then
    raise exception 'Add at least one reviewer, or turn review off' using errcode = '23514';
  end if;

  insert into public.documents (
    folder_id, department_id, name, reference_id, document_type_id, description,
    assigned_uploader_id, requires_review, due_date, created_by
  ) values (
    p_folder_id, v_folder.department_id, p_name, p_reference_id, p_document_type_id, nullif(btrim(p_description), ''),
    p_uploader_id, p_requires_review, p_due_date, auth.uid()
  )
  returning id into v_id;

  perform public.set_document_reviewers(v_id, p_uploader_id, case when p_requires_review then p_reviewer_ids else '{}' end);
  perform public.notify(p_uploader_id, 'upload_requested', 'Upload requested: ' || btrim(p_name),
                        'You have been asked to upload this document.', v_id);
  return v_id;
end;
$$;

create or replace function public.update_document(
  p_document_id uuid,
  p_name text,
  p_document_type_id uuid,
  p_reference_id text,
  p_description text,
  p_uploader_id uuid,
  p_requires_review boolean,
  p_reviewer_ids uuid[],
  p_due_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.documents;
  v_current uuid[];
begin
  select * into v_doc from public.documents where id = p_document_id for update;
  if not found or not public.can_manage_document(p_document_id) then
    raise exception 'You do not have permission to edit this document' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.document_types
    where id = p_document_type_id and (is_active or id = v_doc.document_type_id)
  ) then
    raise exception 'Select an active document type' using errcode = '23514';
  end if;
  if p_requires_review and coalesce(array_length(p_reviewer_ids, 1), 0) = 0 then
    raise exception 'Add at least one reviewer, or turn review off' using errcode = '23514';
  end if;

  select coalesce(array_agg(reviewer_id order by step_order), '{}') into v_current
  from public.document_reviewers where document_id = p_document_id;

  if v_doc.status = 'in_review' and (
       p_uploader_id <> v_doc.assigned_uploader_id
       or p_requires_review <> v_doc.requires_review
       or coalesce(p_reviewer_ids, '{}') <> v_current
     ) then
    raise exception 'The uploader and reviewers cannot be changed while a review is in progress' using errcode = '23514';
  end if;
  if p_uploader_id <> v_doc.assigned_uploader_id
     and not exists (select 1 from public.profiles where id = p_uploader_id and is_active) then
    raise exception 'The uploader must be an active user' using errcode = '23514';
  end if;

  update public.documents set
    name = p_name,
    document_type_id = p_document_type_id,
    reference_id = p_reference_id,
    description = nullif(btrim(p_description), ''),
    assigned_uploader_id = p_uploader_id,
    requires_review = p_requires_review,
    due_date = p_due_date
  where id = p_document_id;

  if coalesce(p_reviewer_ids, '{}') <> v_current or not p_requires_review then
    perform public.set_document_reviewers(p_document_id, p_uploader_id,
      case when p_requires_review then p_reviewer_ids else '{}' end);
  end if;

  if p_uploader_id <> v_doc.assigned_uploader_id and v_doc.status in ('pending_upload', 'changes_requested') then
    perform public.notify(p_uploader_id, 'upload_requested', 'Upload requested: ' || btrim(p_name),
                          'You have been asked to upload this document.', p_document_id);
  end if;
end;
$$;

-- Called by the server (service role) after it has verified the stored file:
-- size, real file type and SHA-256. p_actor is the signed-in uploader.
create or replace function public.record_document_version(
  p_actor uuid,
  p_document_id uuid,
  p_storage_path text,
  p_original_filename text,
  p_file_format public.file_format,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.documents;
  v_version_id uuid;
  v_version_no int;
  v_first_reviewer uuid;
begin
  perform set_config('app.actor_id', p_actor::text, true);

  select * into v_doc from public.documents where id = p_document_id for update;
  if not found then
    raise exception 'Document not found' using errcode = '23503';
  end if;
  if v_doc.assigned_uploader_id <> p_actor then
    raise exception 'Only the assigned uploader can upload this document' using errcode = '42501';
  end if;
  if v_doc.status = 'in_review' then
    raise exception 'A review is in progress. Wait for it to finish before uploading a new version.' using errcode = '23514';
  end if;
  if p_storage_path not like v_doc.department_id || '/' || v_doc.id || '/%' then
    raise exception 'Invalid storage path' using errcode = '23514';
  end if;

  select coalesce(max(version_no), 0) + 1 into v_version_no
  from public.document_versions where document_id = p_document_id;

  insert into public.document_versions (
    document_id, version_no, storage_path, original_filename, file_format, mime_type, size_bytes, sha256, note, uploaded_by
  ) values (
    p_document_id, v_version_no, p_storage_path, p_original_filename, p_file_format, p_mime_type, p_size_bytes,
    lower(p_sha256), nullif(btrim(p_note), ''), p_actor
  )
  returning id into v_version_id;

  if v_doc.requires_review and exists (select 1 from public.document_reviewers where document_id = p_document_id) then
    insert into public.document_review_steps (document_id, version_id, round, step_order, reviewer_id, state, activated_at)
    select p_document_id, v_version_id, v_doc.review_round + 1, r.step_order, r.reviewer_id,
           case when r.step_order = 1 then 'active'::public.review_state else 'waiting' end,
           case when r.step_order = 1 then now() end
    from public.document_reviewers r where r.document_id = p_document_id;

    update public.documents
       set current_version_id = v_version_id, status = 'in_review', review_round = review_round + 1
     where id = p_document_id;

    select reviewer_id into v_first_reviewer from public.document_reviewers
    where document_id = p_document_id order by step_order limit 1;
    perform public.notify(v_first_reviewer, 'review_requested', 'Review requested: ' || v_doc.name,
                          'Version ' || v_version_no || ' is waiting for your review.', p_document_id);
  else
    update public.documents set current_version_id = v_version_id, status = 'approved' where id = p_document_id;
    perform public.notify(v_doc.created_by, 'document_uploaded', 'Uploaded: ' || v_doc.name,
                          'Version ' || v_version_no || ' has been uploaded.', p_document_id);
  end if;

  return v_version_id;
end;
$$;

create or replace function public.decide_review(p_step_id uuid, p_approve boolean, p_comment text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step public.document_review_steps;
  v_doc public.documents;
  v_next public.document_review_steps;
  v_comment text := nullif(btrim(p_comment), '');
  v_version_no int;
begin
  select * into v_step from public.document_review_steps where id = p_step_id for update;
  if not found or v_step.reviewer_id <> auth.uid() then
    raise exception 'This review is not assigned to you' using errcode = '42501';
  end if;
  if v_step.state <> 'active' then
    raise exception 'This review step is not waiting for a decision' using errcode = '23514';
  end if;
  if not p_approve and v_comment is null then
    raise exception 'Explain what needs to change' using errcode = '23514';
  end if;

  select * into v_doc from public.documents where id = v_step.document_id for update;
  select version_no into v_version_no from public.document_versions where id = v_step.version_id;

  update public.document_review_steps
     set state = case when p_approve then 'approved'::public.review_state else 'rejected' end,
         comment = v_comment,
         decided_at = now()
   where id = p_step_id;

  if not p_approve then
    update public.document_review_steps set state = 'skipped'
     where version_id = v_step.version_id and state = 'waiting';
    update public.documents set status = 'changes_requested' where id = v_doc.id;
    perform public.notify(v_doc.assigned_uploader_id, 'changes_requested', 'Changes requested: ' || v_doc.name, v_comment, v_doc.id);
    perform public.notify(v_doc.created_by, 'changes_requested', 'Changes requested: ' || v_doc.name, v_comment, v_doc.id);
    return;
  end if;

  select * into v_next from public.document_review_steps
   where version_id = v_step.version_id and state = 'waiting'
   order by step_order limit 1;

  if found then
    update public.document_review_steps set state = 'active', activated_at = now() where id = v_next.id;
    perform public.notify(v_next.reviewer_id, 'review_requested', 'Review requested: ' || v_doc.name,
                          'Version ' || v_version_no || ' is waiting for your review.', v_doc.id);
  else
    update public.documents set status = 'approved' where id = v_doc.id;
    perform public.notify(v_doc.assigned_uploader_id, 'document_approved', 'Approved: ' || v_doc.name,
                          'Version ' || v_version_no || ' has been approved.', v_doc.id);
    perform public.notify(v_doc.created_by, 'document_approved', 'Approved: ' || v_doc.name,
                          'Version ' || v_version_no || ' has been approved.', v_doc.id);
  end if;
end;
$$;

-- Views and downloads, recorded in the document's audit trail.
create or replace function public.log_document_access(p_document_id uuid, p_action text, p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_action not in ('view', 'download') then
    raise exception 'Unsupported document event: %', p_action using errcode = '22023';
  end if;
  if not public.can_view_document(p_document_id) then
    raise exception 'Document not found' using errcode = '42501';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, meta)
  select auth.uid(), p_action, 'document', d.id::text, d.department_id,
         jsonb_build_object('version_id', p_version_id,
                            'version_no', (select version_no from public.document_versions where id = p_version_id))
  from public.documents d where d.id = p_document_id;
end;
$$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
$$;

-- Counts for the sidebar badge and dashboard tiles.
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
    'to_review', (select count(*) from public.document_review_steps
                  where reviewer_id = auth.uid() and state = 'active'),
    'approved', (select count(*) from public.documents
                 where assigned_uploader_id = auth.uid() and status = 'approved'),
    'unread_notifications', (select count(*) from public.notifications
                             where user_id = auth.uid() and read_at is null)
  );
$$;

-- Everyone below the caller in the reporting tree (for "Team documents").
create or replace function public.my_subordinate_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, extensions
as $$
  select t.id from public.profiles me
  join public.profiles t on t.path <@ me.path and t.id <> me.id
  where me.id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- Storage: private bucket. Clients never access it directly; the server issues
-- short-lived signed URLs after checking permissions.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 52428800)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke execute on function public.can_view_document_row(uuid, uuid, uuid, uuid) from public, anon;
revoke execute on function public.can_view_document(uuid) from public, anon;
revoke execute on function public.can_view_document_entity(text, text) from public, anon;
revoke execute on function public.can_create_documents(uuid) from public, anon;
revoke execute on function public.can_manage_document(uuid) from public, anon;
revoke execute on function public.notify(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.set_document_reviewers(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.create_document(uuid, text, uuid, text, text, uuid, boolean, uuid[], date) from public, anon;
revoke execute on function public.update_document(uuid, text, uuid, text, text, uuid, boolean, uuid[], date) from public, anon;
revoke execute on function public.record_document_version(uuid, uuid, text, text, public.file_format, text, bigint, text, text) from public, anon, authenticated;
revoke execute on function public.decide_review(uuid, boolean, text) from public, anon;
revoke execute on function public.log_document_access(uuid, text, uuid) from public, anon;
revoke execute on function public.mark_notifications_read(uuid[]) from public, anon;
revoke execute on function public.my_task_counts() from public, anon;
revoke execute on function public.my_subordinate_ids() from public, anon;

grant execute on function public.can_view_document_row(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.can_view_document(uuid) to authenticated;
grant execute on function public.can_view_document_entity(text, text) to authenticated;
grant execute on function public.can_create_documents(uuid) to authenticated;
grant execute on function public.can_manage_document(uuid) to authenticated;
grant execute on function public.create_document(uuid, text, uuid, text, text, uuid, boolean, uuid[], date) to authenticated;
grant execute on function public.update_document(uuid, text, uuid, text, text, uuid, boolean, uuid[], date) to authenticated;
grant execute on function public.record_document_version(uuid, uuid, text, text, public.file_format, text, bigint, text, text) to service_role;
grant execute on function public.decide_review(uuid, boolean, text) to authenticated;
grant execute on function public.log_document_access(uuid, text, uuid) to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.my_task_counts() to authenticated;
grant execute on function public.my_subordinate_ids() to authenticated;
