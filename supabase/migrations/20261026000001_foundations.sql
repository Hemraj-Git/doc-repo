-- =============================================================================
-- Phase 7A: deeper folders, optional Reference IDs, institute settings,
-- "not applicable" documents
--
--   depth 0  root    department folder (automatic, no Ref ID)
--   depth 1  child   Ref ID required (manual)
--   depth 2  sub     Ref ID automatic: "<child ref> (<name>)"   e.g. the program
--   depth 3+ sub     Ref ID optional (manual, unique if given)  e.g. Course, Navigation
--
-- Any non-root folder may allow sub-folders; nesting stops at depth 8.
-- =============================================================================

-- New enum value first. It is only referenced from PL/pgSQL bodies below, which
-- are not evaluated until called (a new enum value cannot be used in the same
-- transaction that adds it).
alter type public.document_status add value if not exists 'not_applicable';

-- -----------------------------------------------------------------------------
-- Permissions
-- -----------------------------------------------------------------------------
insert into public.permissions (key, description, category, sort_order) values
  ('template.manage', 'Create and edit folder templates', 'Configuration', 45),
  ('settings.manage', 'Edit institute settings (name, academic year, branding)', 'Configuration', 47)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- Institute settings (single row)
-- -----------------------------------------------------------------------------
create table public.institute_settings (
  id                         boolean primary key default true check (id),
  institute_name             text not null default 'Marine Institute',
  address                    text,
  contact_email              text,
  logo_path                  text,
  academic_year_start_month  int not null default 7 check (academic_year_start_month between 1 and 12),
  updated_by                 uuid default auth.uid(),
  updated_at                 timestamptz not null default now()
);

insert into public.institute_settings (id) values (true) on conflict do nothing;

create trigger institute_settings_updated_at before update on public.institute_settings
  for each row execute function public.set_updated_at();
create trigger audit_institute_settings after update on public.institute_settings
  for each row execute function public.audit_row_change('institute_settings', 'id');

alter table public.institute_settings enable row level security;
create policy institute_settings_select on public.institute_settings
  for select to authenticated using (true);
create policy institute_settings_update on public.institute_settings
  for update to authenticated
  using ((select public.has_perm('settings.manage')))
  with check ((select public.has_perm('settings.manage')));

-- -----------------------------------------------------------------------------
-- Folders: depth, deeper nesting, optional Ref IDs
-- -----------------------------------------------------------------------------
alter table public.folders add column depth int;
update public.folders set depth = case level when 'root' then 0 when 'child' then 1 else 2 end;
alter table public.folders alter column depth set not null;
alter table public.folders add constraint folders_depth_range check (depth between 0 and 8);

-- Ref ID and sub-folder rules now depend on depth, so they move into folders_prepare().
alter table public.folders drop constraint folders_ref_unless_root;
alter table public.folders drop constraint folders_subfolders_only_on_child;
alter table public.folders add constraint folders_root_has_no_ref check (level <> 'root' or reference_id is null);

create or replace function public.folders_prepare()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent public.folders;
begin
  if tg_op = 'UPDATE' then
    if new.level <> old.level or new.parent_id is distinct from old.parent_id
       or new.department_id <> old.department_id or new.depth <> old.depth then
      raise exception 'Folders cannot be moved to another location' using errcode = '23514';
    end if;
    if old.allow_subfolders and not new.allow_subfolders
       and exists (select 1 from public.folders where parent_id = new.id) then
      raise exception 'This folder already has sub-folders, so sub-folders cannot be switched off'
        using errcode = '23514';
    end if;
  end if;

  new.name := btrim(new.name);

  if new.level = 'root' then
    if tg_op = 'INSERT' and coalesce(current_setting('app.creating_root_folder', true), 'off') <> 'on' then
      raise exception 'Department folders are created automatically with the department' using errcode = '23514';
    end if;
    new.depth := 0;
    new.reference_id := null;
    new.allow_subfolders := false;
    return new;
  end if;

  select * into v_parent from public.folders where id = new.parent_id;
  if not found then
    raise exception 'Parent folder not found' using errcode = '23503';
  end if;
  new.department_id := v_parent.department_id;
  new.depth := v_parent.depth + 1;

  if v_parent.level = 'root' then
    -- Directly inside the department: a child folder with a manual Ref ID.
    new.level := 'child';
    new.reference_id := nullif(btrim(new.reference_id), '');
    if new.reference_id is null then
      raise exception 'A Reference ID is required' using errcode = '23514';
    end if;
  else
    new.level := 'sub';
    if not v_parent.allow_subfolders then
      raise exception 'Folder "%" does not allow sub-folders', v_parent.name using errcode = '23514';
    end if;
    if new.depth > 8 then
      raise exception 'Folders can be nested at most 8 levels deep' using errcode = '23514';
    end if;
    if new.depth = 2 then
      -- e.g. the program folder: Ref ID follows its parent.
      new.reference_id := v_parent.reference_id || ' (' || new.name || ')';
      return new;
    end if;
    -- Deeper folders: Ref ID optional.
    new.reference_id := nullif(btrim(new.reference_id), '');
  end if;

  if new.reference_id is not null and new.reference_id !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$' then
    raise exception 'Reference ID may only contain letters, digits, ".", "_", "/" and "-" (max 60 characters)'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- When a child's Ref ID changes, its depth-2 folders (whose Ref ID derives from it) follow.
create or replace function public.folders_sync_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_reference_id('folder', old.id, null);
    return null;
  end if;

  if tg_op = 'INSERT' or new.reference_id is distinct from old.reference_id then
    perform public.sync_reference_id('folder', new.id, new.reference_id);
  end if;

  if tg_op = 'UPDATE' and new.depth = 1 and new.reference_id is distinct from old.reference_id then
    update public.folders set name = name where parent_id = new.id and depth = 2;
  end if;
  return null;
end;
$$;

create index if not exists folders_parent_depth_idx on public.folders (parent_id, depth);

-- Breadcrumbs: the folder's ancestors from the department root down to its parent.
-- SECURITY INVOKER, so it only walks folders the caller can see.
create or replace function public.folder_ancestors(p_folder_id uuid)
returns table (id uuid, name text, level public.folder_level, depth int, reference_id text)
language sql
stable
security invoker
set search_path = public
as $$
  with recursive chain as (
    select f.id, f.parent_id, f.name, f.level, f.depth, f.reference_id
    from public.folders f
    where f.id = (select parent_id from public.folders where id = p_folder_id)
    union all
    select p.id, p.parent_id, p.name, p.level, p.depth, p.reference_id
    from public.folders p
    join chain c on p.id = c.parent_id
  )
  select id, name, level, depth, reference_id from chain order by depth;
$$;

-- -----------------------------------------------------------------------------
-- Documents: optional Ref ID inside folders; "not applicable"
-- -----------------------------------------------------------------------------
alter table public.documents
  add column not_applicable_reason text,
  add column not_applicable_by uuid references public.profiles (id),
  add column not_applicable_at timestamptz;

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
  new.reference_id := nullif(btrim(new.reference_id), '');

  -- Standalone documents (directly in a department) must have a Ref ID; elsewhere it is optional.
  if v_folder.level = 'root' and new.reference_id is null then
    raise exception 'Standalone documents need a Reference ID' using errcode = '23514';
  end if;
  if new.reference_id is not null and new.reference_id !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$' then
    raise exception 'Reference ID may only contain letters, digits, ".", "_", "/" and "-" (max 60 characters)'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Uploads are not accepted for a period marked "not applicable" until it is reopened.
create or replace function public.documents_guard_not_applicable_upload()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.documents where id = new.document_id and status::text = 'not_applicable') then
    raise exception 'This document is marked not applicable. Reopen it before uploading.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger document_versions_guard_not_applicable
  before insert on public.document_versions
  for each row execute function public.documents_guard_not_applicable_upload();

-- The uploader, or anyone who manages the document, can mark an open document
-- "not applicable" (e.g. a holiday week). A reason is required.
create or replace function public.mark_not_applicable(p_document_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.documents;
  v_reason text := nullif(btrim(p_reason), '');
begin
  select * into v_doc from public.documents where id = p_document_id for update;
  if not found or not (v_doc.assigned_uploader_id = auth.uid() or public.can_manage_document(p_document_id)) then
    raise exception 'You cannot change this document' using errcode = '42501';
  end if;
  if v_doc.status::text not in ('pending_upload', 'changes_requested') then
    raise exception 'Only documents waiting for an upload can be marked not applicable' using errcode = '23514';
  end if;
  if v_reason is null then
    raise exception 'Give a reason' using errcode = '23514';
  end if;

  update public.documents
     set status = 'not_applicable'::public.document_status,
         not_applicable_reason = v_reason,
         not_applicable_by = auth.uid(),
         not_applicable_at = now()
   where id = p_document_id;

  perform public.notify(v_doc.created_by, 'not_applicable', 'Marked not applicable: ' || v_doc.name, v_reason, v_doc.id);
end;
$$;

-- Managers can reopen a "not applicable" document; it goes back to waiting for an upload.
create or replace function public.reopen_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.documents;
begin
  select * into v_doc from public.documents where id = p_document_id for update;
  if not found or not public.can_manage_document(p_document_id) then
    raise exception 'You cannot change this document' using errcode = '42501';
  end if;
  if v_doc.status::text <> 'not_applicable' then
    raise exception 'Only documents marked not applicable can be reopened' using errcode = '23514';
  end if;

  update public.documents
     set status = case when v_doc.current_version_id is null then 'pending_upload'::public.document_status
                       else 'changes_requested'::public.document_status end,
         not_applicable_reason = null,
         not_applicable_by = null,
         not_applicable_at = null
   where id = p_document_id;

  perform public.notify(v_doc.assigned_uploader_id, 'upload_requested', 'Reopened: ' || v_doc.name,
                        'This document needs an upload again.', v_doc.id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke execute on function public.folder_ancestors(uuid) from public, anon;
revoke execute on function public.mark_not_applicable(uuid, text) from public, anon;
revoke execute on function public.reopen_document(uuid) from public, anon;
grant execute on function public.folder_ancestors(uuid) to authenticated;
grant execute on function public.mark_not_applicable(uuid, text) to authenticated;
grant execute on function public.reopen_document(uuid) to authenticated;
