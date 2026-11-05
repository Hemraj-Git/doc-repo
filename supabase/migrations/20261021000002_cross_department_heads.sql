-- =============================================================================
-- Department heads may report to someone in another department (e.g. a Director
-- in Administration), so one person can sit above every HOD. Everyone else still
-- reports within their own department.
-- =============================================================================

create or replace function public.profiles_set_path()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_mgr record;
  v_is_head boolean;
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
    select exists (
      select 1 from public.departments where id = new.department_id and head_user_id = new.id
    ) into v_is_head;
    if not v_is_head then
      raise exception 'A user must report to someone in the same department (only department heads may report across departments)'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.path is not null and v_mgr.path <@ old.path then
    raise exception 'Circular reporting line: the selected manager already reports to this user'
      using errcode = '23514';
  end if;

  new.path := v_mgr.path || text2ltree(public.ltree_label(new.id));
  return new;
end;
$$;

-- When a head is replaced, the former head loses the right to a cross-department
-- manager, so that link is removed (they become top-level in their department).
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

    update public.profiles p
       set reports_to_id = null
     where p.id = old.head_user_id
       and exists (
         select 1 from public.profiles m
         where m.id = p.reports_to_id and m.department_id <> p.department_id
       );
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

-- A ready-made custom role for the institute's Director: sees and audits everything,
-- on top of whatever the reporting hierarchy already shows them. Editable/deletable.
insert into public.roles (name, description)
values ('Director', 'Institute-wide oversight: views every document and the full audit log.')
on conflict (name) do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join (values ('document.view.all'), ('document.download'), ('audit.view.all')) as p(key)
where r.name = 'Director' and r.system_key is null
on conflict do nothing;
