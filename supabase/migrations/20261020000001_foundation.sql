-- =============================================================================
-- Foundation: departments, user profiles + reporting hierarchy, RBAC, audit log
-- =============================================================================

create extension if not exists ltree with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------

-- The user performing the change. Server-side scripts that use the service role
-- (no JWT) can identify themselves with: select set_config('app.actor_id', '<uuid>', true);
create or replace function public.current_actor()
returns uuid
language sql
stable
set search_path = public
as $$
  select coalesce(auth.uid(), nullif(current_setting('app.actor_id', true), '')::uuid);
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ltree labels may not contain '-', so UUIDs are stored with '_' instead.
create or replace function public.ltree_label(p_id uuid)
returns text
language sql
immutable
set search_path = public
as $$
  select replace(p_id::text, '-', '_');
$$;

-- -----------------------------------------------------------------------------
-- Departments
-- -----------------------------------------------------------------------------
create table public.departments (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  code          text not null,
  description   text,
  head_user_id  uuid,
  is_active     boolean not null default true,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint departments_name_key unique (name),
  constraint departments_code_key unique (code),
  constraint departments_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'),
  constraint departments_name_not_blank check (btrim(name) <> '')
);

comment on table public.departments is 'Institute departments. Each one gets a root folder in the repository.';

-- -----------------------------------------------------------------------------
-- Profiles (one per auth user) with the reporting hierarchy
-- -----------------------------------------------------------------------------
create table public.profiles (
  id                    uuid primary key references auth.users (id) on delete restrict,
  full_name             text not null,
  email                 text not null,
  employee_code         text,
  designation           text,
  phone                 text,
  department_id         uuid not null,
  reports_to_id         uuid,
  -- Materialised reporting chain: <hod>.<senior>.<me>. Maintained by triggers.
  path                  extensions.ltree,
  is_active             boolean not null default true,
  must_change_password  boolean not null default true,
  created_by            uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint profiles_email_key unique (email),
  constraint profiles_employee_code_key unique (employee_code),
  constraint profiles_department_id_fkey foreign key (department_id) references public.departments (id),
  constraint profiles_reports_to_id_fkey foreign key (reports_to_id) references public.profiles (id),
  constraint profiles_not_own_manager check (reports_to_id is null or reports_to_id <> id),
  constraint profiles_full_name_not_blank check (btrim(full_name) <> '')
);

create index profiles_path_gist on public.profiles using gist (path);
create index profiles_department_id_idx on public.profiles (department_id);
create index profiles_reports_to_id_idx on public.profiles (reports_to_id);

alter table public.departments
  add constraint departments_head_user_id_fkey
  foreign key (head_user_id) references public.profiles (id) on delete set null;

comment on column public.profiles.path is 'Reporting chain as ltree. "X is below me" = X.path <@ me.path and X <> me.';

-- -----------------------------------------------------------------------------
-- RBAC
-- -----------------------------------------------------------------------------
create table public.permissions (
  key          text primary key,
  description  text not null,
  category     text not null,
  sort_order   int not null default 0
);

create table public.roles (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  is_system    boolean not null default false,
  system_key   text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint roles_name_key unique (name),
  constraint roles_system_key_key unique (system_key),
  constraint roles_system_key_consistency check ((is_system and system_key is not null) or (not is_system and system_key is null))
);

create table public.role_permissions (
  role_id         uuid not null references public.roles (id) on delete cascade,
  permission_key  text not null references public.permissions (key) on delete cascade,
  primary key (role_id, permission_key)
);

create table public.user_roles (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role_id      uuid not null references public.roles (id) on delete cascade,
  assigned_by  uuid default auth.uid(),
  assigned_at  timestamptz not null default now(),
  primary key (user_id, role_id)
);

create index user_roles_role_id_idx on public.user_roles (role_id);

-- -----------------------------------------------------------------------------
-- Audit log (append-only)
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id             bigint generated always as identity primary key,
  actor_id       uuid,
  action         text not null,
  entity_type    text not null,
  entity_id      text,
  department_id  uuid,
  before         jsonb,
  after          jsonb,
  meta           jsonb,
  created_at     timestamptz not null default now()
);

create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_department_idx on public.audit_logs (department_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create index audit_logs_created_at_idx on public.audit_logs (created_at desc);

-- =============================================================================
-- Access helper functions (used by RLS policies and the app)
-- =============================================================================

create or replace function public.has_perm(p_key text)
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
    where ur.user_id = auth.uid()
      and p.is_active
      and rp.permission_key = p_key
  );
$$;

create or replace function public.my_dept()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select department_id from public.profiles where id = auth.uid();
$$;

-- True when p_user sits anywhere below the caller in the caller's reporting tree.
create or replace function public.is_below_me(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.profiles me
    join public.profiles target on target.path <@ me.path
    where me.id = auth.uid()
      and target.id = p_user
      and target.id <> me.id
  );
$$;

create or replace function public.has_subordinates()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where reports_to_id = auth.uid());
$$;

-- Everything the app shell needs about the signed-in user, in one round trip.
create or replace function public.my_context()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id', p.id,
      'full_name', p.full_name,
      'email', p.email,
      'employee_code', p.employee_code,
      'designation', p.designation,
      'is_active', p.is_active,
      'must_change_password', p.must_change_password
    ),
    'department', jsonb_build_object('id', d.id, 'name', d.name, 'code', d.code),
    'is_hod', coalesce(d.head_user_id = p.id, false),
    'has_subordinates', exists (select 1 from public.profiles s where s.reports_to_id = p.id and s.is_active),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'system_key', r.system_key) order by r.name)
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = p.id
    ), '[]'::jsonb),
    'permissions', case when p.is_active then coalesce((
      select jsonb_agg(distinct rp.permission_key)
      from public.user_roles ur
      join public.role_permissions rp on rp.role_id = ur.role_id
      where ur.user_id = p.id
    ), '[]'::jsonb) else '[]'::jsonb end
  )
  from public.profiles p
  join public.departments d on d.id = p.department_id
  where p.id = auth.uid();
$$;

-- Clears the first-login flag after the user sets their own password.
create or replace function public.mark_password_changed()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set must_change_password = false where id = auth.uid();
$$;

-- App-level authentication events. Data changes are logged by triggers instead,
-- so callers cannot forge entries for other entities.
create or replace function public.log_auth_event(p_action text, p_meta jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_action not in ('login', 'logout', 'password_change') then
    raise exception 'Unsupported auth event: %', p_action using errcode = '22023';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, meta)
  values (auth.uid(), p_action, 'auth', auth.uid()::text, public.my_dept(), p_meta);
end;
$$;

-- =============================================================================
-- Integrity triggers
-- =============================================================================

-- Validate the reporting line and compute the ltree path.
create or replace function public.profiles_set_path()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_mgr record;
begin
  if tg_op = 'UPDATE' and new.department_id <> old.department_id then
    if exists (select 1 from public.profiles where reports_to_id = new.id) then
      raise exception 'Reassign this user''s direct reports before moving them to another department'
        using errcode = '23514';
    end if;
    if exists (select 1 from public.departments where id = old.department_id and head_user_id = new.id) then
      raise exception 'This user is the head of their current department. Assign a new head first.'
        using errcode = '23514';
    end if;
  end if;

  if new.reports_to_id is null then
    new.path := text2ltree(public.ltree_label(new.id));
    return new;
  end if;

  select id, department_id, path into v_mgr from public.profiles where id = new.reports_to_id;
  if not found then
    raise exception 'Reporting manager does not exist' using errcode = '23503';
  end if;
  if v_mgr.department_id <> new.department_id then
    raise exception 'A user must report to someone in the same department' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.path is not null and v_mgr.path <@ old.path then
    raise exception 'Circular reporting line: the selected manager already reports to this user'
      using errcode = '23514';
  end if;

  new.path := v_mgr.path || text2ltree(public.ltree_label(new.id));
  return new;
end;
$$;

create trigger profiles_set_path
  before insert or update of reports_to_id, department_id on public.profiles
  for each row execute function public.profiles_set_path();

-- When someone moves in the tree, move everyone below them with them.
create or replace function public.profiles_cascade_path()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.profiles
     set path = new.path || subpath(path, nlevel(old.path))
   where path <@ old.path
     and id <> new.id;
  return null;
end;
$$;

create trigger profiles_cascade_path
  after update of reports_to_id on public.profiles
  for each row
  when (old.path::text is distinct from new.path::text)
  execute function public.profiles_cascade_path();

-- Heads and Super Admins cannot be deactivated while they hold that position.
create or replace function public.profiles_guard_deactivation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_active and not new.is_active then
    if exists (select 1 from public.departments where head_user_id = new.id) then
      raise exception 'This user is a department head. Assign a new head before deactivating them.'
        using errcode = '23514';
    end if;
    if exists (
      select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
      where ur.user_id = new.id and r.system_key = 'super_admin'
    ) and (
      select count(*) from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      join public.profiles p on p.id = ur.user_id
      where r.system_key = 'super_admin' and p.is_active and p.id <> new.id
    ) = 0 then
      raise exception 'Cannot deactivate the last active Super Admin' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_deactivation
  before update of is_active on public.profiles
  for each row execute function public.profiles_guard_deactivation();

-- Every user gets the base Employee role.
create or replace function public.profiles_assign_default_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_roles (user_id, role_id, assigned_by)
  select new.id, r.id, public.current_actor()
  from public.roles r
  where r.system_key = 'employee'
  on conflict do nothing;
  return null;
end;
$$;

create trigger profiles_assign_default_role
  after insert on public.profiles
  for each row execute function public.profiles_assign_default_role();

-- A department head must be an active member of that department.
create or replace function public.departments_validate_head()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.head_user_id is not null and not exists (
    select 1 from public.profiles
    where id = new.head_user_id and department_id = new.id and is_active
  ) then
    raise exception 'The department head must be an active member of this department'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger departments_validate_head
  before insert or update of head_user_id on public.departments
  for each row execute function public.departments_validate_head();

-- Keep the "Department Head" role in sync with departments.head_user_id.
create or replace function public.departments_sync_head_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role uuid;
begin
  select id into v_role from public.roles where system_key = 'department_head';
  perform set_config('app.syncing_head_role', 'on', true);

  if tg_op = 'UPDATE' and old.head_user_id is not null
     and old.head_user_id is distinct from new.head_user_id then
    delete from public.user_roles where user_id = old.head_user_id and role_id = v_role;
  end if;

  if new.head_user_id is not null then
    insert into public.user_roles (user_id, role_id, assigned_by)
    values (new.head_user_id, v_role, public.current_actor())
    on conflict do nothing;
  end if;

  perform set_config('app.syncing_head_role', 'off', true);
  return null;
end;
$$;

create trigger departments_sync_head_role
  after insert or update of head_user_id on public.departments
  for each row execute function public.departments_sync_head_role();

-- Role-assignment rules:
--  * "Department Head" is only granted/revoked by setting departments.head_user_id
--  * "Employee" cannot be removed
--  * the last active Super Admin cannot lose the role
create or replace function public.user_roles_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_row public.user_roles;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;

  select system_key into v_key from public.roles where id = v_row.role_id;

  if v_key = 'department_head' and coalesce(current_setting('app.syncing_head_role', true), 'off') <> 'on' then
    raise exception 'The Department Head role is assigned by setting a department''s head'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' and v_key = 'employee'
     and exists (select 1 from public.profiles where id = old.user_id) then
    raise exception 'The Employee role cannot be removed' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' and v_key = 'super_admin'
     and exists (select 1 from public.profiles where id = old.user_id) and (
    select count(*) from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.role_id = old.role_id and p.is_active and ur.user_id <> old.user_id
  ) = 0 then
    raise exception 'Cannot remove the last active Super Admin' using errcode = '23514';
  end if;

  return v_row;
end;
$$;

create trigger user_roles_guard
  before insert or delete on public.user_roles
  for each row execute function public.user_roles_guard();

-- System roles cannot be deleted or renamed into custom roles.
create or replace function public.roles_guard_system()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and old.is_system then
    raise exception 'System roles cannot be deleted' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (new.is_system is distinct from old.is_system
                           or new.system_key is distinct from old.system_key) then
    raise exception 'is_system / system_key cannot be changed' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger roles_guard_system
  before update or delete on public.roles
  for each row execute function public.roles_guard_system();

-- Super Admin always holds every permission.
create or replace function public.role_permissions_guard_super_admin()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.roles where id = old.role_id and system_key = 'super_admin')
     and exists (select 1 from public.permissions where key = old.permission_key) then
    raise exception 'Permissions cannot be removed from the Super Admin role' using errcode = '23514';
  end if;
  return old;
end;
$$;

create trigger role_permissions_guard_super_admin
  before delete on public.role_permissions
  for each row execute function public.role_permissions_guard_super_admin();

create or replace function public.permissions_grant_super_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.role_permissions (role_id, permission_key)
  select id, new.key from public.roles where system_key = 'super_admin'
  on conflict do nothing;
  return null;
end;
$$;

create trigger permissions_grant_super_admin
  after insert on public.permissions
  for each row execute function public.permissions_grant_super_admin();

-- updated_at
create trigger departments_updated_at before update on public.departments
  for each row execute function public.set_updated_at();
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger roles_updated_at before update on public.roles
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Audit triggers
-- =============================================================================

-- tg_argv[0] = entity type, tg_argv[1] = column holding the entity id (default 'id')
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old   jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new   jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row   jsonb := coalesce(v_new, v_old);
  v_dept  uuid;
begin
  -- Ignore no-op updates and path-only cascades.
  if tg_op = 'UPDATE' and (v_old - 'path' - 'updated_at') = (v_new - 'path' - 'updated_at') then
    return null;
  end if;

  v_dept := case
    when tg_table_name = 'departments' then (v_row ->> 'id')::uuid
    when tg_table_name = 'user_roles' then (select department_id from public.profiles where id = (v_row ->> 'user_id')::uuid)
    else (v_row ->> 'department_id')::uuid
  end;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, before, after)
  values (
    public.current_actor(),
    lower(tg_op),
    tg_argv[0],
    v_row ->> coalesce(tg_argv[1], 'id'),
    v_dept,
    v_old - 'path',
    v_new - 'path'
  );
  return null;
end;
$$;

create trigger audit_departments after insert or update or delete on public.departments
  for each row execute function public.audit_row_change('department');
create trigger audit_profiles after insert or update or delete on public.profiles
  for each row execute function public.audit_row_change('user');
create trigger audit_roles after insert or update or delete on public.roles
  for each row execute function public.audit_row_change('role');
create trigger audit_role_permissions after insert or delete on public.role_permissions
  for each row execute function public.audit_row_change('role_permission', 'role_id');
create trigger audit_user_roles after insert or delete on public.user_roles
  for each row execute function public.audit_row_change('user_role', 'user_id');

create or replace function public.audit_logs_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Audit log entries cannot be modified or deleted' using errcode = '42501';
end;
$$;

create trigger audit_logs_no_update_delete
  before update or delete on public.audit_logs
  for each row execute function public.audit_logs_immutable();
create trigger audit_logs_no_truncate
  before truncate on public.audit_logs
  for each statement execute function public.audit_logs_immutable();

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.departments      enable row level security;
alter table public.profiles         enable row level security;
alter table public.permissions      enable row level security;
alter table public.roles            enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles       enable row level security;
alter table public.audit_logs       enable row level security;

-- Directory data is visible to every signed-in user (needed to pick uploaders and
-- reviewers across departments). Documents are protected separately.
create policy departments_select on public.departments
  for select to authenticated using (true);
create policy departments_insert on public.departments
  for insert to authenticated with check ((select public.has_perm('department.manage')));
create policy departments_update on public.departments
  for update to authenticated
  using ((select public.has_perm('department.manage')))
  with check ((select public.has_perm('department.manage')));

create policy profiles_select on public.profiles
  for select to authenticated using (true);
create policy profiles_insert on public.profiles
  for insert to authenticated with check ((select public.has_perm('user.manage')));
create policy profiles_update on public.profiles
  for update to authenticated
  using ((select public.has_perm('user.manage')))
  with check ((select public.has_perm('user.manage')));

create policy permissions_select on public.permissions
  for select to authenticated using (true);

create policy roles_select on public.roles
  for select to authenticated using (true);
create policy roles_insert on public.roles
  for insert to authenticated with check ((select public.has_perm('role.manage')) and not is_system);
create policy roles_update on public.roles
  for update to authenticated
  using ((select public.has_perm('role.manage')))
  with check ((select public.has_perm('role.manage')));
create policy roles_delete on public.roles
  for delete to authenticated using ((select public.has_perm('role.manage')) and not is_system);

create policy role_permissions_select on public.role_permissions
  for select to authenticated using (true);
create policy role_permissions_insert on public.role_permissions
  for insert to authenticated with check ((select public.has_perm('role.manage')));
create policy role_permissions_delete on public.role_permissions
  for delete to authenticated using ((select public.has_perm('role.manage')));

create policy user_roles_select on public.user_roles
  for select to authenticated using (true);
create policy user_roles_insert on public.user_roles
  for insert to authenticated with check ((select public.has_perm('user.manage')));
create policy user_roles_delete on public.user_roles
  for delete to authenticated using ((select public.has_perm('user.manage')));

create policy audit_logs_select on public.audit_logs
  for select to authenticated using (
    (select public.has_perm('audit.view.all'))
    or ((select public.has_perm('audit.view.own_dept')) and department_id = (select public.my_dept()))
    or actor_id = (select auth.uid())
  );

revoke insert, update, delete, truncate on public.audit_logs from anon, authenticated;

-- Helper functions are for signed-in users only.
revoke execute on function public.has_perm(text) from public, anon;
revoke execute on function public.my_dept() from public, anon;
revoke execute on function public.is_below_me(uuid) from public, anon;
revoke execute on function public.has_subordinates() from public, anon;
revoke execute on function public.my_context() from public, anon;
revoke execute on function public.mark_password_changed() from public, anon;
revoke execute on function public.log_auth_event(text, jsonb) from public, anon;
grant execute on function public.has_perm(text) to authenticated;
grant execute on function public.my_dept() to authenticated;
grant execute on function public.is_below_me(uuid) to authenticated;
grant execute on function public.has_subordinates() to authenticated;
grant execute on function public.my_context() to authenticated;
grant execute on function public.mark_password_changed() to authenticated;
grant execute on function public.log_auth_event(text, jsonb) to authenticated;

-- =============================================================================
-- Reference data: system roles and the permission catalogue
-- =============================================================================
insert into public.roles (name, description, is_system, system_key) values
  ('Super Admin',       'Full access to every department and all configuration.',            true, 'super_admin'),
  ('Department Head',   'Owns their department: creates folders and document requirements.', true, 'department_head'),
  ('Employee',          'Base role held by every user.',                                     true, 'employee'),
  ('All-Access Viewer', 'Read-only access to the documents of every department.',            true, 'all_access_viewer');

-- Inserting permissions auto-grants them to Super Admin (trigger above).
insert into public.permissions (key, description, category, sort_order) values
  ('department.manage',        'Create, edit and deactivate departments; assign department heads', 'Organisation', 10),
  ('user.manage',              'Add, edit and deactivate users; assign roles',                     'Organisation', 20),
  ('role.manage',              'Create custom roles and edit the permission matrix',               'Organisation', 30),
  ('document_type.manage',     'Manage document types (Doc, Form, QP …)',                          'Configuration', 40),
  ('folder.create.own_dept',   'Create child folders and sub-folders in own department',           'Repository', 50),
  ('folder.create.any_dept',   'Create child folders and sub-folders in any department',           'Repository', 60),
  ('document.create.own_dept', 'Create document requirements and standalone documents in own department', 'Documents', 70),
  ('document.create.any_dept', 'Create document requirements and standalone documents in any department', 'Documents', 80),
  ('document.view.own_dept',   'View every document in own department',                            'Documents', 90),
  ('document.view.all',        'View every document in every department',                          'Documents', 100),
  ('document.download',        'Download document files',                                          'Documents', 110),
  ('document.delete',          'Archive (soft-delete) documents',                                  'Documents', 120),
  ('audit.view.own_dept',      'View the audit log of own department',                             'Audit', 130),
  ('audit.view.all',           'View the audit log of every department',                           'Audit', 140);

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
join (values
  ('department_head',   'folder.create.own_dept'),
  ('department_head',   'document.create.own_dept'),
  ('department_head',   'document.view.own_dept'),
  ('department_head',   'document.download'),
  ('department_head',   'audit.view.own_dept'),
  ('employee',          'document.download'),
  ('all_access_viewer', 'document.view.all'),
  ('all_access_viewer', 'document.download')
) as p(system_key, key) on p.system_key = r.system_key
on conflict do nothing;
