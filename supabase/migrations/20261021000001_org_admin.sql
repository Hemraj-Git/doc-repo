-- =============================================================================
-- Phase 2: organisation administration helpers
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Department membership rules
--  * users can only be placed in an active department
--  * a department with active members cannot be deactivated
-- -----------------------------------------------------------------------------
create or replace function public.profiles_require_active_department()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT' or new.department_id <> old.department_id)
     and not exists (select 1 from public.departments where id = new.department_id and is_active) then
    raise exception 'Users can only be added to an active department' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger profiles_require_active_department
  before insert or update of department_id on public.profiles
  for each row execute function public.profiles_require_active_department();

create or replace function public.departments_guard_deactivation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_members int;
begin
  if old.is_active and not new.is_active then
    select count(*) into v_members from public.profiles where department_id = new.id and is_active;
    if v_members > 0 then
      raise exception 'This department still has % active user(s). Move or deactivate them first.', v_members
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger departments_guard_deactivation
  before update of is_active on public.departments
  for each row execute function public.departments_guard_deactivation();

-- -----------------------------------------------------------------------------
-- No privilege escalation: you can only grant what you already hold.
--  * a role can be assigned only by someone holding all of its permissions
--  * a permission can be added to a role only by someone holding it
-- -----------------------------------------------------------------------------
create or replace function public.can_grant_role(p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.role_permissions rp
    where rp.role_id = p_role_id
      and not public.has_perm(rp.permission_key)
  );
$$;

drop policy user_roles_insert on public.user_roles;
create policy user_roles_insert on public.user_roles
  for insert to authenticated
  with check ((select public.has_perm('user.manage')) and public.can_grant_role(role_id));

drop policy user_roles_delete on public.user_roles;
create policy user_roles_delete on public.user_roles
  for delete to authenticated
  using ((select public.has_perm('user.manage')) and public.can_grant_role(role_id));

drop policy role_permissions_insert on public.role_permissions;
create policy role_permissions_insert on public.role_permissions
  for insert to authenticated
  with check ((select public.has_perm('role.manage')) and public.has_perm(permission_key));

drop policy role_permissions_delete on public.role_permissions;
create policy role_permissions_delete on public.role_permissions
  for delete to authenticated
  using ((select public.has_perm('role.manage')) and public.has_perm(permission_key));

-- -----------------------------------------------------------------------------
-- Atomic replace helpers. SECURITY INVOKER: the caller's RLS policies apply,
-- so role.manage / user.manage are still required.
-- -----------------------------------------------------------------------------

-- Replace a role's permission set.
create or replace function public.set_role_permissions(p_role_id uuid, p_permission_keys text[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.has_perm('role.manage') then
    raise exception 'You do not have permission to edit roles' using errcode = '42501';
  end if;
  -- Only newly added permissions are checked; ones the role already has may stay.
  if exists (
    select 1 from unnest(coalesce(p_permission_keys, '{}')) k
    where not public.has_perm(k)
      and not exists (select 1 from public.role_permissions where role_id = p_role_id and permission_key = k)
  ) then
    raise exception 'You can only grant permissions that you hold yourself' using errcode = '42501';
  end if;

  delete from public.role_permissions
   where role_id = p_role_id
     and permission_key <> all (coalesce(p_permission_keys, '{}'));

  -- Insert only new keys: RLS checks even rows that ON CONFLICT would skip.
  insert into public.role_permissions (role_id, permission_key)
  select p_role_id, k from unnest(coalesce(p_permission_keys, '{}')) as k
  where not exists (select 1 from public.role_permissions where role_id = p_role_id and permission_key = k)
  on conflict do nothing;
end;
$$;

-- Replace a user's manually assigned roles. Employee (always held) and
-- Department Head (follows departments.head_user_id) are left untouched.
create or replace function public.set_user_roles(p_user_id uuid, p_role_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.has_perm('user.manage') then
    raise exception 'You do not have permission to assign roles' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.roles r
    where r.id = any (coalesce(p_role_ids, '{}')) and not public.can_grant_role(r.id)
  ) then
    raise exception 'You can only assign roles whose permissions you hold yourself' using errcode = '42501';
  end if;

  delete from public.user_roles ur
   using public.roles r
   where r.id = ur.role_id
     and ur.user_id = p_user_id
     and coalesce(r.system_key, '') not in ('employee', 'department_head')
     and ur.role_id <> all (coalesce(p_role_ids, '{}'));

  insert into public.user_roles (user_id, role_id)
  select p_user_id, r.id
  from public.roles r
  where r.id = any (coalesce(p_role_ids, '{}'))
    and coalesce(r.system_key, '') not in ('employee', 'department_head')
    and not exists (select 1 from public.user_roles where user_id = p_user_id and role_id = r.id)
  on conflict do nothing;
end;
$$;

-- -----------------------------------------------------------------------------
-- Admin actions on another user's account that happen outside the database
-- (in Supabase Auth) and therefore need an explicit audit entry.
-- -----------------------------------------------------------------------------
create or replace function public.log_user_admin_event(p_action text, p_user_id uuid, p_meta jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_perm('user.manage') then
    raise exception 'You do not have permission to manage users' using errcode = '42501';
  end if;
  if p_action not in ('password_reset', 'account_created', 'account_disabled', 'account_enabled') then
    raise exception 'Unsupported user admin event: %', p_action using errcode = '22023';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, meta)
  select auth.uid(), p_action, 'user', p_user_id::text, p.department_id, p_meta
  from public.profiles p where p.id = p_user_id;
end;
$$;

revoke execute on function public.can_grant_role(uuid) from public, anon;
grant execute on function public.can_grant_role(uuid) to authenticated;
revoke execute on function public.set_role_permissions(uuid, text[]) from public, anon;
revoke execute on function public.set_user_roles(uuid, uuid[]) from public, anon;
revoke execute on function public.log_user_admin_event(text, uuid, jsonb) from public, anon;
grant execute on function public.set_role_permissions(uuid, text[]) to authenticated;
grant execute on function public.set_user_roles(uuid, uuid[]) to authenticated;
grant execute on function public.log_user_admin_event(text, uuid, jsonb) to authenticated;

-- Name search on the user directory.
create index if not exists profiles_full_name_trgm on public.profiles using gin (full_name extensions.gin_trgm_ops);
