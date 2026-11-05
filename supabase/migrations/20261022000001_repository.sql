-- =============================================================================
-- Phase 3: repository folders, institute-wide Reference IDs, document types
--
--   <Department>            root  — created automatically, no Ref ID
--    └── <Child folder>     child — manual Ref ID, optional "allow sub-folders"
--         └── <Sub-folder>  sub   — Ref ID = "<child ref> (<sub-folder name>)"
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Reference ID register: one row per Ref ID, unique across folders and
-- documents (case-insensitive). Only touched by triggers.
-- -----------------------------------------------------------------------------
create table public.reference_ids (
  ref_id       text primary key,
  entity_type  text not null check (entity_type in ('folder', 'document')),
  entity_id    uuid not null,
  created_at   timestamptz not null default now()
);

create unique index reference_ids_ci_key on public.reference_ids (lower(ref_id));
create unique index reference_ids_entity_key on public.reference_ids (entity_type, entity_id);

alter table public.reference_ids enable row level security;
-- No policies: clients never read or write the register directly.

create or replace function public.reference_id_available(p_ref text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.reference_ids where lower(ref_id) = lower(btrim(p_ref)));
$$;

-- Insert / move / release a Ref ID for an entity. Raises a readable 23505 on clashes.
create or replace function public.sync_reference_id(p_type text, p_id uuid, p_ref text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_ref is null then
    delete from public.reference_ids where entity_type = p_type and entity_id = p_id;
    return;
  end if;

  update public.reference_ids set ref_id = p_ref where entity_type = p_type and entity_id = p_id;
  if not found then
    insert into public.reference_ids (ref_id, entity_type, entity_id) values (p_ref, p_type, p_id);
  end if;
exception
  when unique_violation then
    raise exception 'Reference ID "%" is already in use', p_ref
      using errcode = '23505', detail = 'reference_ids';
end;
$$;

-- -----------------------------------------------------------------------------
-- Folders
-- -----------------------------------------------------------------------------
create type public.folder_level as enum ('root', 'child', 'sub');

create table public.folders (
  id                uuid primary key default gen_random_uuid(),
  department_id     uuid not null references public.departments (id),
  parent_id         uuid references public.folders (id),
  level             public.folder_level not null,
  name              text not null,
  reference_id      text,
  description       text,
  allow_subfolders  boolean not null default false,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint folders_root_has_no_parent check ((level = 'root') = (parent_id is null)),
  constraint folders_ref_unless_root check ((level = 'root') = (reference_id is null)),
  constraint folders_subfolders_only_on_child check (not allow_subfolders or level = 'child'),
  constraint folders_name_length check (btrim(name) <> '' and char_length(name) <= 120)
);

create unique index folders_one_root_per_department on public.folders (department_id) where level = 'root';
create unique index folders_sibling_name_key on public.folders (parent_id, lower(name)) where parent_id is not null;
create index folders_parent_id_idx on public.folders (parent_id);
create index folders_department_id_idx on public.folders (department_id);
create index folders_reference_id_trgm on public.folders using gin (reference_id extensions.gin_trgm_ops);

comment on table public.folders is 'Repository folders: department root → child folder → optional sub-folder.';

-- Validate shape, inherit the department from the parent, compute sub-folder Ref IDs.
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
       or new.department_id <> old.department_id then
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
    new.reference_id := null;
    new.allow_subfolders := false;
    return new;
  end if;

  select * into v_parent from public.folders where id = new.parent_id;
  if not found then
    raise exception 'Parent folder not found' using errcode = '23503';
  end if;
  new.department_id := v_parent.department_id;

  if new.level = 'child' then
    if v_parent.level <> 'root' then
      raise exception 'Child folders are created directly inside a department' using errcode = '23514';
    end if;
    new.reference_id := nullif(btrim(new.reference_id), '');
    if new.reference_id is null then
      raise exception 'A Reference ID is required' using errcode = '23514';
    end if;
    if new.reference_id !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$' then
      raise exception 'Reference ID may only contain letters, digits, ".", "_", "/" and "-" (max 60 characters)'
        using errcode = '23514';
    end if;
  else
    if v_parent.level <> 'child' then
      raise exception 'Sub-folders can only be created inside a child folder' using errcode = '23514';
    end if;
    if not v_parent.allow_subfolders then
      raise exception 'Folder "%" does not allow sub-folders', v_parent.name using errcode = '23514';
    end if;
    new.allow_subfolders := false;
    new.reference_id := v_parent.reference_id || ' (' || new.name || ')';
  end if;

  return new;
end;
$$;

create trigger folders_prepare
  before insert or update on public.folders
  for each row execute function public.folders_prepare();

-- Keep the Ref ID register in step; when a child's Ref ID changes, its sub-folders follow.
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

  if tg_op = 'UPDATE' and new.level = 'child' and new.reference_id is distinct from old.reference_id then
    -- Re-run folders_prepare on each sub-folder so its Ref ID is recomputed.
    update public.folders set name = name where parent_id = new.id;
  end if;
  return null;
end;
$$;

create trigger folders_sync_reference
  after insert or update or delete on public.folders
  for each row execute function public.folders_sync_reference();

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
  return old;
end;
$$;

create trigger folders_guard_delete
  before delete on public.folders
  for each row execute function public.folders_guard_delete();

create trigger folders_updated_at before update on public.folders
  for each row execute function public.set_updated_at();

create trigger audit_folders after insert or update or delete on public.folders
  for each row execute function public.audit_row_change('folder');

-- Department ⇄ root folder
create or replace function public.departments_root_folder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform set_config('app.creating_root_folder', 'on', true);
    insert into public.folders (department_id, level, name, created_by)
    values (new.id, 'root', new.name, public.current_actor());
    perform set_config('app.creating_root_folder', 'off', true);
  elsif new.name is distinct from old.name then
    update public.folders set name = new.name where department_id = new.id and level = 'root';
  end if;
  return null;
end;
$$;

create trigger departments_root_folder
  after insert or update of name on public.departments
  for each row execute function public.departments_root_folder();

-- Backfill root folders for departments created before this migration.
-- Session-level setting: the SQL editor may run each statement in its own transaction.
select set_config('app.creating_root_folder', 'on', false);
insert into public.folders (department_id, level, name, created_by)
select d.id, 'root', d.name, d.created_by
from public.departments d
where not exists (select 1 from public.folders f where f.department_id = d.id and f.level = 'root');
select set_config('app.creating_root_folder', 'off', false);

-- -----------------------------------------------------------------------------
-- Access
-- -----------------------------------------------------------------------------

-- Who may browse a department's folders: its own members, institute-wide roles,
-- and anyone the department's head reports up to (e.g. the Director).
create or replace function public.can_see_department(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_perm('document.view.all')
      or public.has_perm('folder.create.any_dept')
      or public.has_perm('document.create.any_dept')
      or p_department_id = public.my_dept()
      or exists (
        select 1 from public.departments d
        where d.id = p_department_id
          and d.head_user_id is not null
          and public.is_below_me(d.head_user_id)
      );
$$;

create or replace function public.can_manage_folders(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_perm('folder.create.any_dept')
      or (public.has_perm('folder.create.own_dept') and p_department_id = public.my_dept());
$$;

alter table public.folders enable row level security;

create policy folders_select on public.folders
  for select to authenticated using (public.can_see_department(department_id));
-- department_id is filled from the parent by folders_prepare before this check runs.
create policy folders_insert on public.folders
  for insert to authenticated
  with check (level <> 'root' and public.can_manage_folders(department_id));
create policy folders_update on public.folders
  for update to authenticated
  using (level <> 'root' and public.can_manage_folders(department_id))
  with check (level <> 'root' and public.can_manage_folders(department_id));
create policy folders_delete on public.folders
  for delete to authenticated
  using (level <> 'root' and public.can_manage_folders(department_id));

-- -----------------------------------------------------------------------------
-- Document types (classification only; any file format can be uploaded)
-- -----------------------------------------------------------------------------
create table public.document_types (
  id           uuid primary key default gen_random_uuid(),
  code         text not null,
  name         text not null,
  description  text,
  is_active    boolean not null default true,
  sort_order   int not null default 0,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint document_types_code_key unique (code),
  constraint document_types_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,15}$'),
  constraint document_types_name_not_blank check (btrim(name) <> '')
);

create trigger document_types_updated_at before update on public.document_types
  for each row execute function public.set_updated_at();
create trigger audit_document_types after insert or update or delete on public.document_types
  for each row execute function public.audit_row_change('document_type');

alter table public.document_types enable row level security;
create policy document_types_select on public.document_types
  for select to authenticated using (true);
create policy document_types_insert on public.document_types
  for insert to authenticated with check ((select public.has_perm('document_type.manage')));
create policy document_types_update on public.document_types
  for update to authenticated
  using ((select public.has_perm('document_type.manage')))
  with check ((select public.has_perm('document_type.manage')));

insert into public.document_types (code, name, sort_order) values
  ('DOC',      'Doc',      10),
  ('FORM',     'Form',     20),
  ('QP',       'QP',       30),
  ('TEMPLATE', 'Template', 40),
  ('CL',       'CL',       50),
  ('QM',       'QM',       60);

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke execute on function public.reference_id_available(text) from public, anon;
revoke execute on function public.sync_reference_id(text, uuid, text) from public, anon, authenticated;
revoke execute on function public.can_see_department(uuid) from public, anon;
revoke execute on function public.can_manage_folders(uuid) from public, anon;
grant execute on function public.reference_id_available(text) to authenticated;
grant execute on function public.can_see_department(uuid) to authenticated;
grant execute on function public.can_manage_folders(uuid) to authenticated;
