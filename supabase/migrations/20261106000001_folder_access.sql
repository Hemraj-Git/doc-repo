-- =============================================================================
-- Direct uploads and folder access
--
--   folder_permissions        an Admin gives a person, department or group View
--                             ("read") or Upload ("write") on a folder. Covers
--                             its sub-folders; never private (KPI) folders.
--   user_groups               named groups of people from any department. They
--                             carry folder access only, no other rights.
--   create_direct_document()  a file uploaded without a requirement. The document
--                             and its first version are created together.
--
-- A grant never opens a whole department: can_see_department() and
-- can_view_document_row() are unchanged.
-- =============================================================================

insert into public.permissions (key, description, category, sort_order) values
  ('folder.share.own_dept', 'Manage who can view or upload to folders in own department', 'Repository', 62),
  ('folder.share.any_dept', 'Manage who can view or upload to folders in any department', 'Repository', 64),
  ('group.manage',          'Create groups and manage their members',                     'Repository', 66)
on conflict (key) do nothing;

create type public.folder_access as enum ('read', 'write');

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table public.user_groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint user_groups_name_length check (btrim(name) <> '' and char_length(name) <= 120)
);
create unique index user_groups_name_key on public.user_groups (lower(btrim(name)));
create index user_groups_created_by_idx on public.user_groups (created_by);

create table public.user_group_members (
  group_id  uuid not null references public.user_groups (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  added_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  added_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index user_group_members_user_idx on public.user_group_members (user_id);
create index user_group_members_added_by_idx on public.user_group_members (added_by);

create table public.folder_permissions (
  id                     uuid primary key default gen_random_uuid(),
  folder_id              uuid not null references public.folders (id) on delete cascade,
  user_id                uuid references public.profiles (id) on delete cascade,
  grantee_department_id  uuid references public.departments (id) on delete cascade,
  group_id               uuid references public.user_groups (id) on delete cascade,
  access                 public.folder_access not null,
  granted_by             uuid references public.profiles (id) on delete set null,
  granted_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint folder_permissions_one_grantee check (num_nonnulls(user_id, grantee_department_id, group_id) = 1)
);
create unique index folder_permissions_user_key on public.folder_permissions (folder_id, user_id) where user_id is not null;
create unique index folder_permissions_department_key on public.folder_permissions (folder_id, grantee_department_id) where grantee_department_id is not null;
create unique index folder_permissions_group_key on public.folder_permissions (folder_id, group_id) where group_id is not null;
create index folder_permissions_folder_idx on public.folder_permissions (folder_id);
create index folder_permissions_user_idx on public.folder_permissions (user_id) where user_id is not null;
create index folder_permissions_department_idx on public.folder_permissions (grantee_department_id) where grantee_department_id is not null;
create index folder_permissions_group_idx on public.folder_permissions (group_id) where group_id is not null;
create index folder_permissions_granted_by_idx on public.folder_permissions (granted_by);

create trigger user_groups_updated_at before update on public.user_groups
  for each row execute function public.set_updated_at();
create trigger folder_permissions_updated_at before update on public.folder_permissions
  for each row execute function public.set_updated_at();

-- A document uploaded straight into a folder, with no requirement behind it.
alter table public.documents add column is_direct boolean not null default false;

-- -----------------------------------------------------------------------------
-- Who has access
-- -----------------------------------------------------------------------------
create or replace function public.user_has_perm(p_user uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = p_user and p.is_active and rp.permission_key = p_key
  );
$$;

-- The person's grants (their own, their department's, their groups'), carried down
-- through sub-folders. The highest level wins. Private folders are never included,
-- nor anything below one.
create or replace function public.folder_access_for(p_user uuid)
returns table (folder_id uuid, can_write boolean)
language sql
stable
security definer
set search_path = public
as $$
  with recursive me as (
    select id, department_id from public.profiles where id = p_user and is_active
  ),
  granted as (
    select fp.folder_id, fp.access = 'write' as can_write
    from public.folder_permissions fp, me
    where fp.user_id = me.id
       or fp.grantee_department_id = me.department_id
       or fp.group_id in (select m.group_id from public.user_group_members m where m.user_id = me.id)
  ),
  tree as (
    select f.id, g.can_write
    from granted g join public.folders f on f.id = g.folder_id
    where not f.is_private
    union
    select c.id, t.can_write
    from tree t join public.folders c on c.parent_id = t.id
    where not c.is_private
  )
  select id, bool_or(can_write) from tree group by id;
$$;

-- Folders whose documents the caller can see through a grant.
create or replace function public.my_readable_folder_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select a.folder_id from public.folder_access_for(auth.uid()) a;
$$;

-- The same, plus their parents, so people can navigate to them. Parent names become
-- visible; their documents and other sub-folders do not.
create or replace function public.my_browsable_folder_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with recursive up as (
    select f.id, f.parent_id from public.folders f
    where f.id in (select a.folder_id from public.folder_access_for(auth.uid()) a)
    union
    select p.id, p.parent_id from public.folders p join up on p.id = up.parent_id
  )
  select id from up;
$$;

-- Takes the person explicitly: the last step of an upload runs as the server,
-- where auth.uid() is empty.
create or replace function public.can_upload_to_folder_as(p_folder uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.folders f
    where f.id = p_folder
      and not f.is_private
      and (public.user_has_perm(p_user, 'document.create.any_dept')
           or (public.user_has_perm(p_user, 'document.create.own_dept')
               and f.department_id = (select department_id from public.profiles where id = p_user))
           or exists (select 1 from public.folder_access_for(p_user) a where a.folder_id = f.id and a.can_write))
  );
$$;

-- 'write' (may upload here), 'read' (may see its documents through a grant) or 'none'.
create or replace function public.my_folder_access(p_folder uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.can_upload_to_folder_as(p_folder, auth.uid()) then 'write'
    when p_folder in (select public.my_readable_folder_ids()) then 'read'
    else 'none'
  end;
$$;

create or replace function public.can_manage_folder_access(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_perm('folder.share.any_dept')
      or (public.has_perm('folder.share.own_dept') and p_department_id = public.my_dept());
$$;

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------
alter table public.user_groups enable row level security;
alter table public.user_group_members enable row level security;
alter table public.folder_permissions enable row level security;

-- Group members see the groups they are in; admins see all of them.
create policy user_group_members_select on public.user_group_members
  for select to authenticated using (
    user_id = (select auth.uid())
    or (select public.has_perm('group.manage'))
    or (select public.has_perm('folder.share.any_dept'))
    or (select public.has_perm('folder.share.own_dept'))
  );
create policy user_group_members_insert on public.user_group_members
  for insert to authenticated with check ((select public.has_perm('group.manage')));
create policy user_group_members_delete on public.user_group_members
  for delete to authenticated using ((select public.has_perm('group.manage')));

create policy user_groups_select on public.user_groups
  for select to authenticated using (
    (select public.has_perm('group.manage'))
    or (select public.has_perm('folder.share.any_dept'))
    or (select public.has_perm('folder.share.own_dept'))
    or id in (select m.group_id from public.user_group_members m where m.user_id = (select auth.uid()))
  );
create policy user_groups_insert on public.user_groups
  for insert to authenticated with check ((select public.has_perm('group.manage')));
create policy user_groups_update on public.user_groups
  for update to authenticated
  using ((select public.has_perm('group.manage')))
  with check ((select public.has_perm('group.manage')));
create policy user_groups_delete on public.user_groups
  for delete to authenticated using ((select public.has_perm('group.manage')));

-- Grants are added and changed through set_folder_permission().
create policy folder_permissions_select on public.folder_permissions
  for select to authenticated using (
    user_id = (select auth.uid())
    or folder_id in (
      select f.id from public.folders f where public.can_manage_folder_access(f.department_id)
    )
    -- group.manage shows which folders a group can access
    or (group_id is not null and (select public.has_perm('group.manage')))
  );
create policy folder_permissions_delete on public.folder_permissions
  for delete to authenticated using (
    folder_id in (select f.id from public.folders f where public.can_manage_folder_access(f.department_id))
  );

-- Documents, and everything that follows can_view_document: versions, audit trail,
-- previews, download logging and the KPI repository picker.
alter policy documents_select on public.documents using (
  public.can_view_document_row(id, department_id, assigned_uploader_id, created_by)
  or folder_id in (select public.my_readable_folder_ids())
);

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
      and (public.can_view_document_row(d.id, d.department_id, d.assigned_uploader_id, d.created_by)
           or d.folder_id in (select public.my_readable_folder_ids()))
  );
$$;

alter policy folders_select on public.folders using (
  case
    when not is_private then public.can_see_department(department_id) or id in (select public.my_browsable_folder_ids())
    when kpi_assignment_id is not null then public.can_view_kpi_assignment(kpi_assignment_id)
    else public.has_perm('kpi.view_all') or public.can_assign_kpis(department_id)
  end
);

-- Shared program folders keep their tracker and period grouping.
alter policy template_instances_select on public.template_instances using (
  exists (select 1 from public.folders f where f.id = root_folder_id and public.can_see_department(f.department_id))
  or root_folder_id in (select public.my_readable_folder_ids())
);
alter policy recurring_series_select on public.recurring_series using (
  public.can_see_department(department_id)
  or folder_id in (select public.my_readable_folder_ids())
);

-- -----------------------------------------------------------------------------
-- Giving access
-- -----------------------------------------------------------------------------
-- Adds a grant or changes its level. Exactly one of user, department or group.
-- Everyone who newly gains access, or whose level changes, is notified.
create or replace function public.set_folder_permission(
  p_folder_id uuid,
  p_user_id uuid,
  p_department_id uuid,
  p_group_id uuid,
  p_access public.folder_access
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder public.folders;
  v_existing public.folder_permissions;
  v_id uuid;
  v_code text;
  v_link text;
begin
  select * into v_folder from public.folders where id = p_folder_id;
  if not found or v_folder.is_private then
    raise exception 'This folder cannot be shared' using errcode = '23514';
  end if;
  if not public.can_manage_folder_access(v_folder.department_id) then
    raise exception 'You do not have permission to manage access to this folder' using errcode = '42501';
  end if;
  if num_nonnulls(p_user_id, p_department_id, p_group_id) <> 1 then
    raise exception 'Choose a person, a department or a group' using errcode = '23514';
  end if;
  if p_user_id is not null and not exists (select 1 from public.profiles where id = p_user_id and is_active) then
    raise exception 'Access can only be given to an active user' using errcode = '23514';
  end if;
  if p_department_id is not null and not exists (select 1 from public.departments where id = p_department_id and is_active) then
    raise exception 'Access can only be given to an active department' using errcode = '23514';
  end if;
  if p_group_id is not null and not exists (select 1 from public.user_groups where id = p_group_id) then
    raise exception 'Group not found' using errcode = '23503';
  end if;

  select * into v_existing from public.folder_permissions
  where folder_id = p_folder_id
    and user_id is not distinct from p_user_id
    and grantee_department_id is not distinct from p_department_id
    and group_id is not distinct from p_group_id
  for update;

  if found and v_existing.access = p_access then
    return v_existing.id;
  end if;

  if v_existing.id is not null then
    update public.folder_permissions set access = p_access, granted_by = auth.uid()
    where id = v_existing.id
    returning id into v_id;
  else
    insert into public.folder_permissions (folder_id, user_id, grantee_department_id, group_id, access, granted_by)
    values (p_folder_id, p_user_id, p_department_id, p_group_id, p_access, auth.uid())
    returning id into v_id;
  end if;

  select code into v_code from public.departments where id = v_folder.department_id;
  v_link := '/repository/' || v_code || case when v_folder.level = 'root' then '' else '/' || v_folder.id end;

  insert into public.notifications (user_id, type, title, body, link, actor_id)
  select p.id, 'folder_shared', 'Folder shared: ' || v_folder.name,
         case when p_access = 'write' then 'You can now view and upload files in this folder.'
              else 'You can now view the files in this folder.' end,
         v_link, auth.uid()
  from public.profiles p
  where p.is_active
    and p.id is distinct from auth.uid()
    and (p.id = p_user_id
         or p.department_id = p_department_id
         or p.id in (select m.user_id from public.user_group_members m where m.group_id = p_group_id));

  return v_id;
end;
$$;

-- Folders shared with the caller, for the "Shared with me" page. Only the folders a
-- grant names, not every sub-folder below them.
create or replace function public.my_shared_folders()
returns table (
  folder_id uuid,
  name text,
  reference_id text,
  level public.folder_level,
  department_id uuid,
  department_code text,
  department_name text,
  can_write boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id, department_id from public.profiles where id = auth.uid() and is_active
  ),
  granted as (
    select distinct fp.folder_id
    from public.folder_permissions fp, me
    where fp.user_id = me.id
       or fp.grantee_department_id = me.department_id
       or fp.group_id in (select m.group_id from public.user_group_members m where m.user_id = me.id)
  )
  select f.id, f.name, f.reference_id, f.level, d.id, d.code, d.name, a.can_write
  from granted g
  join public.folders f on f.id = g.folder_id and not f.is_private
  join public.departments d on d.id = f.department_id
  join public.folder_access_for(auth.uid()) a on a.folder_id = f.id
  order by d.name, f.name;
$$;

-- -----------------------------------------------------------------------------
-- Direct upload
-- -----------------------------------------------------------------------------
-- Called by the server (service role) after it has verified the stored file. The
-- document and its first version are created in one transaction, so a refused or
-- failed upload never leaves an empty document behind. Reviewers are optional:
-- record_document_version() sends it for review, or makes it live.
create or replace function public.create_direct_document(
  p_actor uuid,
  p_document_id uuid,
  p_folder_id uuid,
  p_name text,
  p_document_type_id uuid,
  p_reference_id text,
  p_description text,
  p_reviewer_ids uuid[],
  p_storage_path text,
  p_original_filename text,
  p_file_format public.file_format,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder public.folders;
  v_reviewers uuid[] := coalesce(p_reviewer_ids, '{}');
begin
  perform set_config('app.actor_id', p_actor::text, true);

  select * into v_folder from public.folders where id = p_folder_id;
  if not found then
    raise exception 'Folder not found' using errcode = '23503';
  end if;
  if not public.can_upload_to_folder_as(p_folder_id, p_actor) then
    raise exception 'You do not have permission to upload to this folder' using errcode = '42501';
  end if;
  if not exists (select 1 from public.document_types where id = p_document_type_id and is_active) then
    raise exception 'Select an active document type' using errcode = '23514';
  end if;

  insert into public.documents (
    id, folder_id, department_id, name, reference_id, document_type_id, description,
    assigned_uploader_id, requires_review, is_direct, created_by
  ) values (
    p_document_id, p_folder_id, v_folder.department_id, p_name, p_reference_id, p_document_type_id,
    nullif(btrim(p_description), ''), p_actor, coalesce(array_length(v_reviewers, 1), 0) > 0, true, p_actor
  );

  perform public.set_document_reviewers(p_document_id, p_actor, v_reviewers);
  perform public.record_document_version(
    p_actor, p_document_id, p_storage_path, p_original_filename, p_file_format, p_mime_type, p_size_bytes, p_sha256, null
  );
  return p_document_id;
end;
$$;

-- A mistaken direct upload is withdrawn the same way as an open requirement.
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
  if not (v_doc.status::text in ('pending_upload', 'changes_requested') or (v_doc.is_direct and v_doc.status::text = 'approved')) then
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

-- Reopening a withdrawn direct upload makes its file live again; nothing is waiting for an upload.
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

  if v_doc.is_direct and v_doc.current_version_id is not null then
    update public.documents
       set status = 'approved'::public.document_status,
           not_applicable_reason = null,
           not_applicable_by = null,
           not_applicable_at = null
     where id = p_document_id;
    perform public.notify(v_doc.assigned_uploader_id, 'document_uploaded', 'Reopened: ' || v_doc.name,
                          'This document is available again.', v_doc.id);
    return;
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
-- Audit
-- -----------------------------------------------------------------------------
create trigger audit_user_groups after insert or update or delete on public.user_groups
  for each row execute function public.audit_row_change('user_group');
create trigger audit_user_group_members after insert or delete on public.user_group_members
  for each row execute function public.audit_row_change('user_group_member', 'group_id');
create trigger audit_folder_permissions after insert or update or delete on public.folder_permissions
  for each row execute function public.audit_row_change('folder_permission', 'folder_id');

-- These rows carry ids only. Keep the names with the row, since a folder or group may
-- later be renamed or deleted, and file grants under the folder's department so its
-- audit viewers see them.
create or replace function public.audit_fill_document_department()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
begin
  if new.department_id is null and new.entity_id ~ '^[0-9a-f-]{36}$' then
    if new.entity_type in ('document_version', 'document_reviewer', 'document_review') then
      select department_id into new.department_id from public.documents where id = new.entity_id::uuid;
    elsif new.entity_type = 'template_instance' then
      select f.department_id into new.department_id
      from public.template_instances i join public.folders f on f.id = i.root_folder_id
      where i.id = new.entity_id::uuid;
    end if;
  end if;

  if new.entity_type = 'folder_permission' then
    v_row := coalesce(new.after, new.before);
    select department_id into new.department_id from public.folders where id = (v_row ->> 'folder_id')::uuid;
    new.meta := coalesce(new.meta, '{}'::jsonb) || jsonb_build_object(
      'folder', (select name from public.folders where id = (v_row ->> 'folder_id')::uuid),
      'grantee', coalesce(
        (select full_name from public.profiles where id = (v_row ->> 'user_id')::uuid),
        (select name from public.departments where id = (v_row ->> 'grantee_department_id')::uuid),
        (select name from public.user_groups where id = (v_row ->> 'group_id')::uuid))
    );
  elsif new.entity_type = 'user_group_member' then
    v_row := coalesce(new.after, new.before);
    new.meta := coalesce(new.meta, '{}'::jsonb) || jsonb_build_object(
      'group', (select name from public.user_groups where id = (v_row ->> 'group_id')::uuid)
    );
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke execute on function public.user_has_perm(uuid, text) from public, anon, authenticated;
revoke execute on function public.folder_access_for(uuid) from public, anon, authenticated;
revoke execute on function public.can_upload_to_folder_as(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.my_readable_folder_ids() from public, anon;
revoke execute on function public.my_browsable_folder_ids() from public, anon;
revoke execute on function public.my_folder_access(uuid) from public, anon;
revoke execute on function public.can_manage_folder_access(uuid) from public, anon;
revoke execute on function public.set_folder_permission(uuid, uuid, uuid, uuid, public.folder_access) from public, anon;
revoke execute on function public.my_shared_folders() from public, anon;
revoke execute on function public.create_direct_document(uuid, uuid, uuid, text, uuid, text, text, uuid[], text, text, public.file_format, text, bigint, text) from public, anon, authenticated;

grant execute on function public.my_readable_folder_ids() to authenticated;
grant execute on function public.my_browsable_folder_ids() to authenticated;
grant execute on function public.my_folder_access(uuid) to authenticated;
grant execute on function public.can_manage_folder_access(uuid) to authenticated;
grant execute on function public.set_folder_permission(uuid, uuid, uuid, uuid, public.folder_access) to authenticated;
grant execute on function public.my_shared_folders() to authenticated;
grant execute on function public.create_direct_document(uuid, uuid, uuid, text, uuid, text, text, uuid[], text, text, public.file_format, text, bigint, text) to service_role;
