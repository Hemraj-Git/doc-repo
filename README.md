# Marine Institute DMS

Centralised document management for the institute: academic, HR, student records, and Quality & Compliance documents. Every document is traceable, with its versions, timestamps, owner and permissions. Access follows departments, the reporting hierarchy and configurable roles (RBAC).

**Stack:** Next.js 16 (App Router) · Supabase (Postgres, Auth, Storage, RLS) · Tailwind CSS 4 · shadcn/ui (Base UI) · Zod

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Foundation: login, forced password change, app shell, role-based nav and dashboard, schema for departments, users, hierarchy, RBAC and audit | ✅ Done |
| 2 | Departments, users (in hierarchy order), org chart, roles and permission matrix screens | ✅ Done |
| 3 | Repository: folders, sub-folders, Ref IDs, document types | ✅ Done |
| 4 | Document requirements (incl. standalone documents), uploads, versions, sequential review, in-app notifications | ✅ Done |
| 5 | Audit Log (filters, CSV export), search, dashboard charts and feeds | ✅ Done |
| 6a | In-browser preview of Word, Excel, PowerPoint, PDF and images | ✅ Done |
| 7 | Folder templates (programs, subjects …), recurring weekly / monthly / semester / yearly requirements, daily scheduler, program tracker | ✅ Done |
| 8 | Student profiles, certificates (issue, replace, revoke, QR), public verification portal at `/verify` with slip PDFs, verification log | ✅ Done |
| 9 | KPIs: areas with weightage, evidence (once / weekly / monthly / quarterly / half-yearly / yearly) uploaded and reviewed like documents, private records, assignment overview | ✅ Done |
| 6b | Email notifications, hardening, deployment | Next |

## Setup

### 1. Prerequisites

- **Node.js 24 LTS** (pinned in `.nvmrc`; with nvm-windows, run `nvm install 24.22.1` then `nvm use 24.22.1`). Node 22.12 or newer also works. Node 20 is end-of-life, and the Supabase client no longer supports it.
- A **Supabase Cloud** project (the free tier is fine).

### 2. Environment

```bash
cp .env.example .env.local
```

Fill in the values from **Supabase Dashboard → Project Settings → API Keys**:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable key (`sb_publishable_…`) or the legacy anon key |
| `SUPABASE_SECRET_KEY` | secret key (`sb_secret_…`) or the legacy service_role key. **Server only.** |
| `NEXT_PUBLIC_SITE_URL` | public address of the app, used in certificate QR codes and verification slips (falls back to the request host) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | [Cloudflare Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) keys for the CAPTCHA on `/verify`. Leave empty in development to use Cloudflare's always-pass test keys; **required in production**, where the portal is disabled without them. |
| `VERIFY_IP_SALT` | random secret used to hash requester IPs in the verification log (`openssl rand -hex 32`) |

### 3. Configure Auth in the dashboard

In **Authentication → Sign In / Providers → Email**:

- **Allow new users to sign up: OFF.** Only Admins create accounts.
- **Confirm email: OFF.** Accounts are created by an Admin and pre-confirmed.
- **Minimum password length: 8**, and require lowercase, uppercase and digits.

`supabase/config.toml` holds the same settings, but it only applies to a local Supabase stack.

### 4. Apply the database migrations

You can do this either way:

- **CLI:**
  ```bash
  npx supabase login
  npx supabase link --project-ref <project-ref>
  npm run db:push
  ```
- **SQL editor:** paste each file from `supabase/migrations/` in order, then run it.

### 5. Create the first Super Admin

```bash
npm run bootstrap:admin -- --email admin@institute.edu --name "Full Name"
```

This creates the **Administration** department and the Super Admin account, and makes the new admin that department's head. It prints a temporary password, which must be changed at first sign-in. Add `--password "…"` to set the password yourself. The script refuses to run if a Super Admin already exists.

### 6. Run

```bash
npm run dev     # http://localhost:3000
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | Route-type generation + `tsc` |
| `npm run lint` | ESLint |
| `npm run test:db` | Runs every migration in an in-memory Postgres (PGlite) and tests the hierarchy, RBAC, RLS and audit rules. **No Docker or Supabase needed.** |
| `npm run db:push` | Applies migrations to the linked Supabase project |
| `npm run bootstrap:admin` | One-time creation of the first Super Admin |

## How access works

- **The database enforces every rule.** Row Level Security policies call `has_perm()`, `my_dept()` and `is_below_me()`, so the rules hold even when someone calls the API directly. The UI checks in `src/lib/auth/permissions.ts` only decide what to show.
- **Hierarchy:** each profile stores its reporting chain as an `ltree` path (`hod.senior.me`), maintained by triggers. A user may report only to someone in the same department, and circular reporting lines are rejected.
- **Roles:** there are four system roles: Super Admin, Department Head, Employee and All-Access Viewer. Admins can add custom roles. Setting a department's head grants the Department Head role automatically. The last Super Admin cannot be removed.
- **No privilege escalation:** you can only assign a role if you hold all of its permissions, and only add a permission to a role if you hold it yourself. The database enforces this, so it holds even outside the UI.
- **Accounts:** admins create users through the Supabase Auth admin API and give them a temporary password, which must be changed at first sign-in. Deactivating a user also bans their Auth account, so their session can't be refreshed.
- **Audit:** triggers record every change to departments, users, roles and role assignments, along with sign-in, sign-out and password-change events. Nobody can update or delete audit entries, not even the database owner.
- **Navigation and dashboard:** `src/lib/nav/config.ts` and `src/lib/dashboard/widgets.ts` decide what each user sees based on their permissions, whether they are an HOD, and whether anyone reports to them. Each page guard reuses the same rule as its sidebar entry.

## Folder access and direct uploads

- **Manage access** on a folder or department page gives a person, department or group **View** or **Upload** on that folder, including people outside its department. It needs `folder.share.any_dept` or `folder.share.own_dept`; only Super Admin has these by default, and they can be ticked for any role.
- **Access covers all sub-folders**, current and future. Private KPI folders are always excluded. If someone has several grants, the highest wins. Parent folder names become visible for navigation, but not their other contents, so a grant never opens a whole department.
- **Groups** (Administration → Groups, permission `group.manage`) are named sets of people from any department. They give folder access only, no other rights.
- **Upload files** appears on folders where someone has Upload, or where they may create documents (department heads in their own department, admins everywhere). Each file becomes its own document with the same file checks as any upload. Without reviewers it is live at once, shown as **Uploaded**; with reviewers it goes through normal review. Other department members can't upload until they are given access.
- **Mistakes:** the uploader or a manager can mark a live direct upload **Not applicable** with a reason, and reopen it. Documents aren't deleted.

## Templates and recurring requirements

- **Admins** build templates under **Administration → Templates**: folders, file items and *slots* that repeat another template (e.g. a Program template with a *Subjects* slot using the Subject template). Each file item has a recurrence (once, weekly, monthly, per semester, per academic year), where it is filed (here, Academic year, or Academic year → Semester), when it is due, who uploads it and an ordered reviewer chain.
- **HODs** create programs with **New from template** in any folder. Everything is created in one transaction. After a template changes, **Add new items** on its page adds new folders/items to existing instances (it never removes anything). Programs can be duplicated, closed and reopened.
- **Dates:** slots can give each entry its own dates. They are required at the first level (e.g. a semester). Entries inside another entry (e.g. a course in a semester) can leave a date blank to use that entry's date.
- **Past start dates:** if an entry with recurring files has already started, the creator chooses **Generate requirements from**: the **start date** (backfill, creating every past period) or **today** (go-forward, starting with the current period). The entry's dates don't change, and one-time files are created either way.
- **The academic year** starts in the month set under **Institute Settings**; Semester 1 is its first six months.
- **Scheduler:** `generate_due_requirements()` runs daily at 00:15 IST through **pg_cron** (job `dms-generate-due-requirements`, registered by the scheduler migration; enable the *pg_cron* extension first). It creates each period's requirement once, never back-fills, and logs every run. **Run now** and the last-run status are on the Templates page. Paused, ended or closed series restart from the current period.

## Students and certificate verification

- **Students** (sidebar) holds student profiles, scoped by department like documents. Permissions: `student.view.*`, `student.manage.*`, `certificate.manage.*` (own department / any department) and `verification.view_log`. Department Heads can view their own students by default; create custom roles such as *Exam Cell* or *Student Welfare* for the rest.
- **Import** a batch from Excel/CSV (validated in full before anything is saved), and **Bulk certificates** uploads many files at once, matched to students by file name.
- **A certificate is issued when it is uploaded.** Files go to the private `certificates` bucket; replacing a file keeps the earlier one; revoking (or marking as replaced) is permanent and shows on the portal. Each certificate has a QR code linking to `/verify/c/<token>`.
- **Public portal `/verify`** (no sign-in): Regd No. + student name (case, spaces and dots ignored), the requester's details and a Turnstile CAPTCHA. A mismatch always gives the same message. A match shows the student's course details and certificate list — never the files or personal details — and a downloadable **verification slip** whose QR code opens `/verify/slip/<token>`, re-read from the stored record. Limits: 10 checks an hour and 50 a day per IP (and 50 a day per requester email). Every request is logged with a hashed IP; see **Administration → Verification Log**.
- The portal runs entirely on the server with the service role; the `public_*` database functions are not callable by browsers.

## KPIs

- **KPIs** (sidebar, for `kpi.manage` / `kpi.assign.*` / `kpi.view_all`): a KPI per role, e.g. *Faculty KPI*. It has **areas** whose weightages must total **100%** before it can be activated, a **reviewer** (reporting manager, head of department or a fixed person) and a **scorer** (head of HR, head of Quality or a fixed person). Quarters, halves and years follow the **year start month** set on the KPI (April by default).
- **Each period goes through three people:** the person submits it, the **reviewer** approves or sends it back, and the **scorer** gives it a score from 1 to 10 or marks it not applicable. A period missed by its due date has nothing to approve, so the reviewer forwards it to the scorer or marks it not applicable. Scores stay hidden from the person until the scorer or HR releases them.
- **Assign** a KPI to people for a period: everyone with the KPI's designation is pre-selected. Optionally choose specific reviewers and whether to create periods already passed. One person can hold several KPIs (e.g. Faculty + Simulator Incharge). Assignments can be ended, reopened, renewed for the next period, and given evidence items added to the KPI later; each keeps its own copy of the KPI as it was assigned.
- **Evidence is an ordinary document requirement**: uploaded, checked, versioned, previewed and reviewed (approve / send back) like any other, listed in My Tasks with a KPI badge, and created each period by the same daily scheduler as template requirements. There is no rating: **completion** is the share of due evidence approved, weighted by area.
- **Private**: KPI evidence and its folders (`<department> › KPI Records`, hidden from the repository) are visible only to the person, their reporting line, their reviewers, whoever assigned it, and `kpi.view_all` / `kpi.assign.*` holders. Department-wide document access and audit visibility do not apply, and department statistics leave it out.
- **My KPIs** shows each person their KPIs and progress; **KPI assignments** gives HR / Quality filters, completion, overdue counts and a CSV export of every evidence item and period. Suggested custom roles: *HR* and *Quality Head* with `kpi.manage`, `kpi.assign.any_dept` and `kpi.view_all`.

## In-browser preview

Files are previewed inside the app. The file goes straight from private storage to the viewer's browser, so documents are never sent to a third-party viewer service, and every preview is recorded in the audit trail as a view.

| Format | Renderer |
|---|---|
| PDF, images | the browser's own viewer, from a local blob URL |
| Word `.docx` | [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) |
| Excel `.xlsx` / `.xls` / `.csv` | [SheetJS](https://sheetjs.com) 0.20.3 (from the official SheetJS CDN, because the npm release is outdated). Large sheets show the first 2,000 rows and 60 columns. |
| PowerPoint `.pptx` | pptx-preview (closed source). Charts inside slides render only approximately. |
| `.doc`, `.ppt` | not previewable; download only |

**Isolation.** Office renderers parse untrusted files. They run only inside `/preview/frame`, an iframe with `sandbox="allow-scripts"`, so it has an opaque origin and cannot reach the app's session, cookies or DOM. It is served with a strict CSP: nonce-only scripts, no network access, and `sandbox` set in the header too. The parent page posts it the file bytes. Links inside documents are limited to `http(s)`/`mailto` and open in a new tab. pptx-preview bundles ECharts 5.6, which has an XSS advisory, and the sandbox contains that risk.

The renderer bundle (`public/preview/frame.js`, about 1.8 MB, loaded only when someone opens a preview) is built from `preview-frame/frame.ts` by `npm run build:preview`. This runs automatically before `dev` and `build`.

## Project layout

```
src/app/(auth)/          login, change-password, auth server actions
src/app/(app)/           signed-in area (sidebar + header); dashboard and module pages
src/app/verify/          public certificate verification portal, slips and QR checks
src/app/auth/signout/    signs out inactive or unprovisioned accounts
src/components/shell/    sidebar, header, user menu
src/lib/auth/            session context, permission helpers, page guards
src/lib/nav/             sidebar definition
src/lib/dashboard/       dashboard widget registry
src/lib/supabase/        browser, server and proxy clients
src/lib/verification/    Turnstile, IP hashing, slip PDF
src/proxy.ts             session refresh + login redirect (Next 16 "proxy", formerly middleware)
supabase/migrations/     schema, triggers, RLS, seed roles and permissions
tests/db/                PGlite-based database tests
scripts/                 bootstrap-admin
```
