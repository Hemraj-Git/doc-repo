-- =============================================================================
-- Scale: cheaper audit visibility, paged document lists, missing FK indexes
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Audit log visibility
-- -----------------------------------------------------------------------------
-- The per-row SECURITY DEFINER checks (can_view_document_entity,
-- can_view_kpi_assignment) ran once for every audit row a non-admin scanned.
-- Semi-joins against documents / kpi_assignments let Postgres build the set of
-- visible ids once (their own RLS decides) and hash it. The department policy
-- checks the cheap permission flags before looking up whether a document is private.
alter policy audit_logs_select on public.audit_logs using (
  actor_id = (select auth.uid())
  or (((select public.has_perm('audit.view.all'))
       or ((select public.has_perm('audit.view.own_dept')) and department_id = (select public.my_dept())))
      and not public.audit_entity_is_private(entity_type, entity_id))
);
alter policy audit_logs_select_documents on public.audit_logs using (
  entity_type in ('document', 'document_version', 'document_reviewer', 'document_review')
  and entity_id in (select d.id::text from public.documents d)
);
alter policy audit_logs_select_kpis on public.audit_logs using (
  entity_type = 'kpi_assignment' and entity_id in (select a.id::text from public.kpi_assignments a)
);

-- -----------------------------------------------------------------------------
-- Document lists the app pages through
-- -----------------------------------------------------------------------------
-- SECURITY INVOKER: documents RLS still applies. Returning setof documents lets
-- PostgREST embed, order and range the result like a table, instead of the app
-- sending every reviewed document id in the URL.
create or replace function public.my_documents()
returns setof public.documents
language sql
stable
set search_path = public
as $$
  select d.* from public.documents d
  where d.assigned_uploader_id = (select auth.uid())
     or d.created_by = (select auth.uid())
     or d.id in (select r.document_id from public.document_reviewers r where r.reviewer_id = (select auth.uid()));
$$;

-- Documents of other departments where the caller uploads or reviews.
create or replace function public.shared_documents()
returns setof public.documents
language sql
stable
set search_path = public
as $$
  select d.* from public.documents d
  where d.department_id is distinct from (select public.my_dept())
    and (d.assigned_uploader_id = (select auth.uid())
         or d.id in (select r.document_id from public.document_reviewers r where r.reviewer_id = (select auth.uid())));
$$;

-- Total size of the file versions the caller may see (all, for admins).
create or replace function public.storage_used()
returns bigint
language sql
stable
set search_path = public
as $$
  select coalesce(sum(size_bytes), 0)::bigint from public.document_versions;
$$;

revoke execute on function public.my_documents() from public, anon;
revoke execute on function public.shared_documents() from public, anon;
revoke execute on function public.storage_used() from public, anon;
grant execute on function public.my_documents() to authenticated;
grant execute on function public.shared_documents() to authenticated;
grant execute on function public.storage_used() to authenticated;

-- -----------------------------------------------------------------------------
-- Folder creators can be embedded (saves a round trip per folder page)
-- -----------------------------------------------------------------------------
alter table public.folders
  add constraint folders_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null;

-- -----------------------------------------------------------------------------
-- Indexes for foreign keys (joins, and the checks Postgres runs when a parent
-- row such as a person or document type is changed)
-- -----------------------------------------------------------------------------
create index if not exists folders_created_by_idx on public.folders (created_by);
create index if not exists departments_head_user_id_idx on public.departments (head_user_id);
create index if not exists role_permissions_permission_key_idx on public.role_permissions (permission_key);
create index if not exists documents_current_version_id_idx on public.documents (current_version_id);
create index if not exists documents_document_type_id_idx on public.documents (document_type_id);
create index if not exists documents_not_applicable_by_idx on public.documents (not_applicable_by);
create index if not exists document_versions_uploaded_by_idx on public.document_versions (uploaded_by);
create index if not exists notifications_document_id_idx on public.notifications (document_id);
create index if not exists template_nodes_document_type_id_idx on public.template_nodes (document_type_id);
create index if not exists template_nodes_fixed_uploader_id_idx on public.template_nodes (fixed_uploader_id);
create index if not exists template_node_reviewers_user_id_idx on public.template_node_reviewers (user_id);
create index if not exists template_instances_created_by_idx on public.template_instances (created_by);
create index if not exists template_instances_slot_owner_id_idx on public.template_instances (slot_owner_id);
create index if not exists recurring_series_created_by_idx on public.recurring_series (created_by);
create index if not exists recurring_series_document_type_id_idx on public.recurring_series (document_type_id);
create index if not exists recurring_series_slot_owner_id_idx on public.recurring_series (slot_owner_id);
create index if not exists scheduler_runs_triggered_by_idx on public.scheduler_runs (triggered_by);
create index if not exists students_created_by_idx on public.students (created_by);
create index if not exists students_updated_by_idx on public.students (updated_by);
create index if not exists certificates_created_by_idx on public.certificates (created_by);
create index if not exists certificates_status_changed_by_idx on public.certificates (status_changed_by);
create index if not exists kpis_created_by_idx on public.kpis (created_by);
