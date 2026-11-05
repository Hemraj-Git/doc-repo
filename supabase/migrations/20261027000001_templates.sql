-- =============================================================================
-- Phase 7B: folder templates
--
-- A template is a tree of nodes under the instance's root folder:
--   folder    a fixed sub-folder (e.g. "Course")
--   document  a file requirement — once, or recurring per week / month /
--             semester / academic year — with uploader and reviewer rules
--   slot      repeats another template, one entry per name given when the
--             instance is created (e.g. "Subjects" → the Subject template)
--
-- Instances copy these settings when they are created (Phase 7C), so editing a
-- template never changes programs that already exist.
-- =============================================================================

create type public.template_node_kind as enum ('folder', 'document', 'slot');
create type public.recurrence_kind as enum ('once', 'weekly', 'monthly', 'semester', 'academic_year');
create type public.period_storage as enum ('here', 'academic_year', 'academic_year_semester');
create type public.due_mode as enum ('none', 'period_end', 'after_creation');
create type public.uploader_rule as enum ('chosen', 'slot_owner', 'department_head', 'fixed');
create type public.reviewer_rule as enum ('fixed', 'department_head', 'uploader_manager', 'slot_owner_manager');

create table public.templates (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  description          text,
  -- What the instance's name is called in the wizard, e.g. "Program name", "Subject name".
  instance_label       text not null default 'Name',
  -- Allowed departments; null = every department.
  department_ids       uuid[],
  -- People may add their own folders inside instances.
  allow_extra_folders  boolean not null default true,
  is_active            boolean not null default true,
  version              int not null default 1,
  created_by           uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint templates_name_key unique (name),
  constraint templates_name_not_blank check (btrim(name) <> ''),
  constraint templates_label_not_blank check (btrim(instance_label) <> '')
);

create table public.template_nodes (
  id                  uuid primary key default gen_random_uuid(),
  template_id         uuid not null references public.templates (id) on delete cascade,
  -- null = directly inside the instance's root folder
  parent_id           uuid references public.template_nodes (id) on delete cascade,
  kind                public.template_node_kind not null,
  sort_order          int not null default 0,
  name                text not null,
  -- folder
  allow_subfolders    boolean not null default false,
  -- document
  document_type_id    uuid references public.document_types (id),
  description         text,
  recurrence          public.recurrence_kind not null default 'once',
  storage             public.period_storage not null default 'here',
  create_offset_days  int not null default 0 check (create_offset_days between 0 and 60),
  due_mode            public.due_mode not null default 'none',
  due_days            int not null default 3 check (due_days between 0 and 365),
  uploader_rule       public.uploader_rule not null default 'chosen',
  fixed_uploader_id   uuid references public.profiles (id),
  requires_review     boolean not null default false,
  -- slot
  slot_template_id    uuid references public.templates (id),
  slot_owner_label    text,
  created_at          timestamptz not null default now(),
  constraint template_nodes_name_not_blank check (btrim(name) <> '' and char_length(name) <= 120),
  constraint template_nodes_document_type check (kind <> 'document' or document_type_id is not null),
  constraint template_nodes_fixed_uploader check (uploader_rule <> 'fixed' or fixed_uploader_id is not null),
  constraint template_nodes_slot_template check (kind <> 'slot' or slot_template_id is not null),
  constraint template_nodes_once_storage check (recurrence <> 'once' or storage = 'here')
);

create index template_nodes_template_idx on public.template_nodes (template_id, parent_id, sort_order);

create table public.template_node_reviewers (
  node_id     uuid not null references public.template_nodes (id) on delete cascade,
  step_order  int not null check (step_order >= 1),
  rule        public.reviewer_rule not null,
  user_id     uuid references public.profiles (id),
  primary key (node_id, step_order),
  constraint template_node_reviewers_fixed check (rule <> 'fixed' or user_id is not null)
);

-- -----------------------------------------------------------------------------
-- Integrity
-- -----------------------------------------------------------------------------

-- True when p_template (directly or through nested slots) uses p_target.
create or replace function public.template_uses(p_template uuid, p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive used(id) as (
    select slot_template_id from public.template_nodes where template_id = p_template and kind = 'slot'
    union
    select n.slot_template_id from public.template_nodes n join used u on n.template_id = u.id where n.kind = 'slot'
  )
  select exists (select 1 from used where id = p_target);
$$;

create or replace function public.template_nodes_prepare()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent public.template_nodes;
  v_depth int := 0;
  v_cursor uuid;
begin
  new.name := btrim(new.name);

  if new.parent_id is not null then
    select * into v_parent from public.template_nodes where id = new.parent_id;
    if not found or v_parent.template_id <> new.template_id then
      raise exception 'Parent node not found in this template' using errcode = '23503';
    end if;
    if v_parent.kind <> 'folder' then
      raise exception 'Items can only be placed inside folders' using errcode = '23514';
    end if;
    -- Folders inside a template follow the 8-level limit (the instance root is level 2 or deeper).
    v_cursor := new.parent_id;
    while v_cursor is not null loop
      v_depth := v_depth + 1;
      select parent_id into v_cursor from public.template_nodes where id = v_cursor;
    end loop;
    if v_depth > 5 then
      raise exception 'Template folders can be nested at most 5 levels deep' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' and (new.template_id <> old.template_id or new.kind <> old.kind) then
    raise exception 'A node cannot change template or kind' using errcode = '23514';
  end if;

  if new.kind = 'slot' then
    if new.slot_template_id = new.template_id or public.template_uses(new.slot_template_id, new.template_id) then
      raise exception 'A template cannot contain itself, directly or through another template' using errcode = '23514';
    end if;
    new.slot_owner_label := nullif(btrim(new.slot_owner_label), '');
  else
    new.slot_template_id := null;
    new.slot_owner_label := null;
  end if;

  if new.kind <> 'document' then
    new.document_type_id := null;
    new.recurrence := 'once';
    new.storage := 'here';
    new.uploader_rule := 'chosen';
    new.fixed_uploader_id := null;
    new.requires_review := false;
  end if;
  if new.kind <> 'folder' then
    new.allow_subfolders := false;
  end if;
  if new.recurrence = 'once' then
    new.storage := 'here';
    new.create_offset_days := 0;
    if new.due_mode = 'period_end' then
      new.due_mode := 'after_creation';
    end if;
  end if;
  if new.uploader_rule <> 'fixed' then
    new.fixed_uploader_id := null;
  end if;
  return new;
end;
$$;

create trigger template_nodes_prepare
  before insert or update on public.template_nodes
  for each row execute function public.template_nodes_prepare();

-- Slot rules referencing the slot owner only make sense inside a template used as a slot;
-- they are resolved when instances are created (7C). Fixed reviewers must be active users.
create or replace function public.template_node_reviewers_prepare()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.template_nodes where id = new.node_id and kind = 'document' and requires_review) then
    raise exception 'Reviewers can only be added to document items that need review' using errcode = '23514';
  end if;
  if new.rule <> 'fixed' then
    new.user_id := null;
  elsif not exists (select 1 from public.profiles where id = new.user_id and is_active) then
    raise exception 'Reviewers must be active users' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger template_node_reviewers_prepare
  before insert or update on public.template_node_reviewers
  for each row execute function public.template_node_reviewers_prepare();

-- Any change to a template's structure bumps its version.
create or replace function public.templates_bump_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template uuid;
begin
  if tg_table_name = 'template_nodes' then
    v_template := coalesce(new.template_id, old.template_id);
  else
    select template_id into v_template from public.template_nodes where id = coalesce(new.node_id, old.node_id);
  end if;
  update public.templates set version = version + 1, updated_at = now() where id = v_template;
  return null;
end;
$$;

create trigger template_nodes_bump_version
  after insert or update or delete on public.template_nodes
  for each row execute function public.templates_bump_version();
create trigger template_node_reviewers_bump_version
  after insert or update or delete on public.template_node_reviewers
  for each row execute function public.templates_bump_version();

create trigger templates_updated_at before update on public.templates
  for each row execute function public.set_updated_at();

-- A template used by another template's slot cannot be deleted.
create or replace function public.templates_guard_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.template_nodes where slot_template_id = old.id) then
    raise exception 'Template "%" is used inside another template and cannot be deleted', old.name using errcode = '23514';
  end if;
  return old;
end;
$$;

create trigger templates_guard_delete
  before delete on public.templates
  for each row execute function public.templates_guard_delete();

create trigger audit_templates after insert or update or delete on public.templates
  for each row execute function public.audit_row_change('template');
create trigger audit_template_nodes after insert or update or delete on public.template_nodes
  for each row execute function public.audit_row_change('template_node', 'template_id');

-- -----------------------------------------------------------------------------
-- Access: everyone signed in can read templates (to use them); template.manage edits.
-- -----------------------------------------------------------------------------
alter table public.templates enable row level security;
alter table public.template_nodes enable row level security;
alter table public.template_node_reviewers enable row level security;

create policy templates_select on public.templates for select to authenticated using (true);
create policy templates_write on public.templates for all to authenticated
  using ((select public.has_perm('template.manage')))
  with check ((select public.has_perm('template.manage')));

create policy template_nodes_select on public.template_nodes for select to authenticated using (true);
create policy template_nodes_write on public.template_nodes for all to authenticated
  using ((select public.has_perm('template.manage')))
  with check ((select public.has_perm('template.manage')));

create policy template_node_reviewers_select on public.template_node_reviewers for select to authenticated using (true);
create policy template_node_reviewers_write on public.template_node_reviewers for all to authenticated
  using ((select public.has_perm('template.manage')))
  with check ((select public.has_perm('template.manage')));

-- Replace a node's reviewer chain atomically. SECURITY INVOKER: RLS applies.
create or replace function public.set_template_node_reviewers(p_node_id uuid, p_steps jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.has_perm('template.manage') then
    raise exception 'You do not have permission to edit templates' using errcode = '42501';
  end if;
  delete from public.template_node_reviewers where node_id = p_node_id;
  insert into public.template_node_reviewers (node_id, step_order, rule, user_id)
  select p_node_id, ord, (s ->> 'rule')::public.reviewer_rule, nullif(s ->> 'user_id', '')::uuid
  from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) with ordinality as t(s, ord);
end;
$$;

revoke execute on function public.template_uses(uuid, uuid) from public, anon;
revoke execute on function public.set_template_node_reviewers(uuid, jsonb) from public, anon;
grant execute on function public.template_uses(uuid, uuid) to authenticated;
grant execute on function public.set_template_node_reviewers(uuid, jsonb) to authenticated;
