import { before, describe, test } from "node:test"
import assert from "node:assert/strict"
import { applyMigration, asUser, createDb, createDept, createUser, expectError, expectErrorInTx, grantSystemRole, one } from "./harness.mjs"

/*
 *   ACAD: hod (head) ─┬─ fac1
 *                     └─ fac2
 *         fac3 (no reporting manager)
 *   QA:   qaHead (head)
 *   HR:   hr (HR role: kpi.manage + kpi.assign.any_dept + kpi.view_all), no head
 *   viewer (All-Access Viewer: document.view.all), no manager
 *
 * Faculty KPI (year starts in April), reviewed by the reporting manager, scored by the head of Quality
 *   Teaching 50% monthly · Research 30% quarterly · Admin 20% once
 */
let db
const u = {}
const d = {}
let kpi, folder, docType

// A closed quarter of a past KPI year: every period exists at once and is past its due date.
const PAST = { start: "2024-04-01", end: "2024-06-30" }

const setHead = (deptId, userId) => db.query("update public.departments set head_user_id = $1 where id = $2", [userId, deptId])
const asHr = (fn) => asUser(db, u.hr, fn)
const assign = (tx, who, users, start, end, opts = {}) =>
  asUser(tx, who, (t) =>
    one(t, "select public.assign_kpi($1, $2::uuid[], $3::date, $4::date, $5::uuid[], $6, $7::uuid) as n", [
      opts.kpi ?? kpi,
      users,
      start,
      end,
      opts.reviewer ? [opts.reviewer] : null,
      opts.backfill ?? false,
      opts.scorer ?? null,
    ])
  ).then((r) => r.n)
const count = (tx, who, sql, params = []) => asUser(tx, who, (t) => one(t, sql, params)).then((r) => r.n)
const assignmentOf = (tx, user) => one(tx, "select id from public.kpi_assignments where user_id = $1 order by created_at desc limit 1", [user]).then((r) => r.id)
const entries = (tx, assignment) =>
  tx
    .query(
      `select e.id, ar.name as area, e.period_key, e.period_label, e.status, e.due_date::text
       from public.kpi_entries e join public.kpi_assignment_areas ar on ar.id = e.assignment_area_id
       where e.assignment_id = $1 order by ar.sort_order, e.period_start`,
      [assignment]
    )
    .then((r) => r.rows)
const score = (tx, who, entry, value, comment = null) => asUser(tx, who, (t) => t.query("select public.score_kpi_entry($1, $2, $3)", [entry, value, comment]))
const approve = (tx, who, entry, comment = null) => asUser(tx, who, (t) => t.query("select public.approve_kpi_entry($1, $2)", [entry, comment]))
/** Reviewer approves (or forwards), then the scorer scores. */
const decide = async (tx, entry, value, comment = null, { reviewer = u.hod, scorer = u.qaHead } = {}) => {
  await approve(tx, reviewer, entry)
  await score(tx, scorer, entry, value, comment)
}
const scores = (tx, who, assignment) => asUser(tx, who, (t) => one(t, "select * from public.kpi_assignment_results($1::uuid[])", [[assignment]]))
const num = (v) => (v === null || v === undefined ? null : Number(v))
const currentYear = (tx) => one(tx, "select y_start::text as s, y_end::text as e from public.year_of(public.institute_today(), 4)")

/** Assigns the past quarter to Fac One: Teaching Apr, May, Jun · Research Q1 · Admin once. */
async function pastAssignment(tx, opts = {}) {
  await assign(tx, u.hr, [opts.user ?? u.fac1], PAST.start, PAST.end, { backfill: true, reviewer: opts.reviewer, scorer: opts.scorer })
  const id = await assignmentOf(tx, opts.user ?? u.fac1)
  const rows = await entries(tx, id)
  return {
    id,
    teaching: rows.filter((r) => r.area === "Teaching").map((r) => r.id),
    research: rows.find((r) => r.area === "Research").id,
    admin: rows.find((r) => r.area === "Admin").id,
  }
}

async function makeDocument(tx, uploader, name) {
  const docId = (
    await asUser(tx, u.hod, (t) => one(t, "select public.create_document($1, $2, $3, null, null, $4, false, '{}'::uuid[], null) as id", [folder, name, docType, uploader]))
  ).id
  await tx.query(
    `select public.record_document_version($1, $2,
       (select department_id::text from public.documents where id = $2) || '/' || $2 || '/v1.pdf',
       'evidence.pdf', 'pdf', 'application/pdf', 1024, $3, null)`,
    [uploader, docId, "a".repeat(64)]
  )
  return docId
}

before(async () => {
  db = await createDb()
  d.acad = await createDept(db, "Academics", "ACAD")
  d.qa = await createDept(db, "Quality", "QA")
  d.hr = await createDept(db, "Human Resources", "HR")
  u.hod = await createUser(db, { name: "Hod", deptId: d.acad })
  await setHead(d.acad, u.hod)
  u.fac1 = await createUser(db, { name: "Fac One", deptId: d.acad, reportsTo: u.hod })
  u.fac2 = await createUser(db, { name: "Fac Two", deptId: d.acad, reportsTo: u.hod })
  u.fac3 = await createUser(db, { name: "Fac Three", deptId: d.acad })
  u.qaHead = await createUser(db, { name: "Qa Head", deptId: d.qa })
  await setHead(d.qa, u.qaHead)
  u.hr = await createUser(db, { name: "Hr", deptId: d.hr })
  u.viewer = await createUser(db, { name: "Viewer", deptId: d.hr })
  await grantSystemRole(db, u.viewer, "all_access_viewer")
  const role = (await one(db, "insert into public.roles (name) values ('HR') returning id")).id
  for (const p of ["kpi.manage", "kpi.assign.any_dept", "kpi.view_all"]) {
    await db.query("insert into public.role_permissions (role_id, permission_key) values ($1, $2)", [role, p])
  }
  await db.query("insert into public.user_roles (user_id, role_id) values ($1, $2)", [u.hr, role])
  docType = (await one(db, "select id from public.document_types where code = 'DOC'")).id
  const root = await one(db, "select id from public.folders where level = 'root' and department_id = $1", [d.acad])
  folder = (
    await asUser(db, u.hod, (t) =>
      one(t, "insert into public.folders (parent_id, department_id, level, name, reference_id) values ($1, $2, 'child', 'Records', 'ACD-REC') returning id", [root.id, d.acad])
    )
  ).id

  await asHr(async (t) => {
    kpi = (await one(t, "insert into public.kpis (name, designation, scorer_department_id) values ('Faculty KPI', 'Faculty', $1) returning id", [d.qa])).id
    const area = (name, weight, recurrence, order) =>
      t.query("insert into public.kpi_areas (kpi_id, name, weightage, description, recurrence, sort_order) values ($1, $2, $3, $4, $5::public.recurrence_kind, $6)", [
        kpi,
        name,
        weight,
        `${name} results`,
        recurrence,
        order,
      ])
    await area("Teaching", 50, "monthly", 1)
    await area("Research", 30, "quarterly", 2)
    await area("Admin", 20, "once", 3)
  })
})

describe("period engine with a year start month", () => {
  const period = (kind, date, month) => one(db, "select * from public.period_for($1::public.recurrence_kind, $2::date, $3)", [kind, date, month])

  test("quarters and halves of a financial year (April)", async () => {
    const q = await period("quarterly", "2026-08-15", 4)
    assert.deepEqual([q.period_key, q.label], ["2026–27/Q2", "Q2 2026–27 (Jul–Sep 2026)"])
    const h = await period("half_yearly", "2027-01-10", 4)
    assert.deepEqual([h.period_key, h.label], ["2026–27/H2", "H2 2026–27 (Oct 2026 – Mar 2027)"])
    const y = await period("academic_year", "2026-03-31", 4)
    assert.equal(y.label, "2025–26")
  })

  test("academic (July) and calendar (January) years, and unchanged template periods", async () => {
    const july = await period("quarterly", "2026-08-15", 7)
    assert.deepEqual([july.period_key, july.label], ["2026–27/Q1", "Q1 2026–27 (Jul–Sep 2026)"])
    const q = await period("quarterly", "2026-08-15", 1)
    assert.deepEqual([q.period_key, q.label], ["2026/Q3", "Q3 2026 (Jul–Sep 2026)"])
    const legacy = await one(db, "select * from public.period_for('academic_year', '2026-06-30')")
    assert.equal(legacy.label, "2025–26", "templates still follow the July academic year")
  })
})

describe("KPI definitions", () => {
  test("only KPI managers can create KPIs", async () => {
    await expectError(asUser(db, u.hod, (t) => t.query("insert into public.kpis (name) values ('Nope')")), /row-level security/)
  })

  test("activation needs weightages totalling 100% and every area saying what is measured", async () => {
    await db.transaction(async (tx) => {
      await tx.query("update public.kpi_areas set weightage = 40 where kpi_id = $1 and name = 'Teaching'", [kpi])
      await expectErrorInTx(tx, () => asUser(tx, u.hr, (t) => t.query("update public.kpis set is_active = true where id = $1", [kpi])), /must total 100% \(now 90.00%\)/)
      await tx.query("update public.kpi_areas set weightage = 50, description = null where kpi_id = $1 and name = 'Teaching'", [kpi])
      await expectErrorInTx(tx, () => asUser(tx, u.hr, (t) => t.query("update public.kpis set is_active = true where id = $1", [kpi])), /Add what is measured to "Teaching"/)
      await tx.rollback()
    })
    await asHr((t) => t.query("update public.kpis set is_active = true where id = $1", [kpi]))
  })

  test("weekly is not an area interval", async () => {
    await expectError(
      asHr((t) => t.query("insert into public.kpi_areas (kpi_id, name, weightage, recurrence) values ($1, 'Weekly', 1, 'weekly')", [kpi])),
      /kpi_areas_recurrence/
    )
  })

  test("duplicating copies areas, intervals and the reviewer rule, inactive", async () => {
    await db.transaction(async (tx) => {
      await tx.query("update public.kpis set reviewer_rule = 'fixed', reviewer_user_id = $1, due_days = 10 where id = $2", [u.qaHead, kpi])
      const copy = (await asUser(tx, u.hr, (t) => one(t, "select public.duplicate_kpi($1) as id", [kpi]))).id
      const row = await one(tx, "select name, is_active, reviewer_user_id, due_days, scorer_department_id from public.kpis where id = $1", [copy])
      assert.deepEqual(row, { name: "Faculty KPI (copy)", is_active: false, reviewer_user_id: u.qaHead, due_days: 10, scorer_department_id: d.qa })
      const areas = await tx.query("select name, recurrence::text as recurrence from public.kpi_areas where kpi_id = $1 order by sort_order", [copy])
      assert.deepEqual(areas.rows.map((a) => [a.name, a.recurrence]), [["Teaching", "monthly"], ["Research", "quarterly"], ["Admin", "once"]])
      await tx.rollback()
    })
  })
})

describe("assigning", () => {
  test("creates the periods from the current one, all or nothing, with the reviewer resolved", async () => {
    await db.transaction(async (tx) => {
      const y = await currentYear(tx)
      await expectErrorInTx(tx, () => assign(tx, u.hod, [u.fac1], y.s, y.e), /permission to assign KPIs/)
      const created = await assign(tx, u.hr, [u.fac1, u.fac2], y.s, y.e)
      assert.equal(created, 6, "per person: this month, this quarter, the one-time area")

      const a = await one(tx, "select reviewer_id, due_days, scores_released_at from public.kpi_assignments where user_id = $1", [u.fac1])
      assert.deepEqual(a, { reviewer_id: u.hod, due_days: 7, scores_released_at: null }, "their manager; scores start hidden")
      const once = (await entries(tx, await assignmentOf(tx, u.fac1))).find((r) => r.area === "Admin")
      assert.equal(once.period_label, "Whole KPI period")

      const note = await one(tx, "select title, link from public.notifications where user_id = $1 and type = 'kpi_to_fill'", [u.fac1])
      assert.match(note.title, /Faculty KPI/)

      await expectErrorInTx(tx, () => assign(tx, u.hr, [u.fac1], y.s, y.e), /already has "Faculty KPI" for overlapping dates/)
      await tx.rollback()
    })
  })

  test("one assignment fits one KPI year, so each year has its own Final Score", async () => {
    await db.transaction(async (tx) => {
      await expectErrorInTx(tx, () => assign(tx, u.hr, [u.fac1], "2025-04-01", "2026-04-30"), /within one KPI year \(2025-04-01 to 2026-03-31\)/)
      assert.equal(await assign(tx, u.hr, [u.fac1], "2025-10-01", "2026-03-31", { backfill: true }) > 0, true, "a mid-year joiner is fine")
      await tx.rollback()
    })
  })

  test("back-filling creates every past period; due dates use the KPI's days", async () => {
    await db.transaction(async (tx) => {
      await assign(tx, u.hr, [u.fac1], PAST.start, PAST.end, { backfill: true })
      const rows = await entries(tx, await assignmentOf(tx, u.fac1))
      assert.deepEqual(rows.map((r) => r.area), ["Teaching", "Teaching", "Teaching", "Research", "Admin"])
      assert.equal(rows[0].due_date, "2024-05-07", "April, due 7 days after it ends")
      assert.equal(rows[3].due_date, "2024-07-07")
      assert.equal(rows[4].due_date, "2024-07-07", "one-time: 7 days after the KPI period")
      await tx.rollback()
    })
  })

  test("someone always reviews, and never themselves", async () => {
    await db.transaction(async (tx) => {
      const y = await currentYear(tx)
      await expectErrorInTx(tx, () => assign(tx, u.hr, [u.fac1], y.s, y.e, { reviewer: u.fac1 }), /Fac One cannot review their own KPI/)
      await expectErrorInTx(tx, () => assign(tx, u.hr, [u.viewer], y.s, y.e), /Viewer has no reporting manager or department head/)
      await assign(tx, u.hr, [u.fac3], y.s, y.e)
      assert.equal((await one(tx, "select reviewer_id from public.kpi_assignments where user_id = $1", [u.fac3])).reviewer_id, u.hod, "no manager: their head")
      await assign(tx, u.hr, [u.viewer], y.s, y.e, { reviewer: u.qaHead })
      assert.equal((await one(tx, "select reviewer_id from public.kpi_assignments where user_id = $1", [u.viewer])).reviewer_id, u.qaHead, "chosen reviewer")
      await tx.rollback()
    })
  })
})

describe("filling in", () => {
  test("text is required; drafts save; reviewer gets one notification per assignment", async () => {
    await db.transaction(async (tx) => {
      const y = await currentYear(tx)
      await assign(tx, u.hr, [u.fac1], y.s, y.e)
      const a = await assignmentOf(tx, u.fac1)
      const rows = await entries(tx, a)
      const ids = rows.map((r) => r.id)

      await expectErrorInTx(tx, () => asUser(tx, u.fac1, (t) => t.query("select public.submit_kpi_entries($1::uuid[])", [[ids[0]]])), /Write the details/)
      await expectErrorInTx(tx, () => asUser(tx, u.fac2, (t) => t.query("select public.save_kpi_entry($1, 'x')", [ids[0]])), /Only the assigned person/)
      await expectErrorInTx(tx, () => asUser(tx, u.fac1, (t) => t.query("update public.kpi_entries set details = 'x' where id = $1 returning id", [ids[0]]).then((r) => {
        if (r.rows.length === 0) throw new Error("no direct writes")
      })), /no direct writes/)

      for (const id of ids) await asUser(tx, u.fac1, (t) => t.query("select public.save_kpi_entry($1, 'Delivered 42 lessons')", [id]))
      const n = await asUser(tx, u.fac1, (t) => one(t, "select public.submit_kpi_entries($1::uuid[]) as n", [ids]))
      assert.equal(n.n, 3)
      const notes = await tx.query("select body from public.notifications where user_id = $1 and type = 'kpi_to_review'", [u.hod])
      assert.equal(notes.rows.length, 1)
      assert.match(notes.rows[0].body, /^3 periods of Faculty KPI/)
      await expectErrorInTx(tx, () => asUser(tx, u.fac1, (t) => t.query("select public.save_kpi_entry($1, 'edit')", [ids[0]])), /already been submitted/)
      await tx.rollback()
    })
  })

  test("a late submission is flagged; ending the KPI stops submitting", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx)
      await asUser(tx, u.fac1, (t) => t.query("select public.save_kpi_entry($1, 'Late work')", [p.research]))
      await asUser(tx, u.fac1, (t) => t.query("select public.submit_kpi_entries($1::uuid[])", [[p.research]]))
      assert.equal((await one(tx, "select submitted_late from public.kpi_entries where id = $1", [p.research])).submitted_late, true)

      await asUser(tx, u.hr, (t) => t.query("select public.set_kpi_assignment_status($1, false)", [p.id]))
      await expectErrorInTx(tx, () => asUser(tx, u.fac1, (t) => t.query("select public.save_kpi_entry($1, 'more')", [p.admin])), /has ended/)
      await tx.rollback()
    })
  })

  test("a repository file must be visible to the person and stays on its exact version", async () => {
    await db.transaction(async (tx) => {
      const y = await currentYear(tx)
      await assign(tx, u.hr, [u.fac1], y.s, y.e, { reviewer: u.qaHead })
      const a = await assignmentOf(tx, u.fac1)
      const entry = (await entries(tx, a))[0].id
      const mine = await makeDocument(tx, u.fac1, "My record")
      const theirs = await makeDocument(tx, u.fac2, "Their record")
      const attach = (doc) => asUser(tx, u.fac1, (t) => one(t, "select public.attach_repository_file($1, $2) as id", [entry, doc]))

      await expectErrorInTx(tx, () => attach(theirs), /Document not found/)
      const file = (await attach(mine)).id
      await expectErrorInTx(tx, () => attach(mine), /already attached/)
      const original = await one(tx, "select version_id, storage_path from public.kpi_entry_files where id = $1", [file])

      // A new version of the document does not touch the evidence.
      await tx.query(
        `select public.record_document_version($1, $2,
           (select department_id::text from public.documents where id = $2) || '/' || $2 || '/v2.pdf',
           'v2.pdf', 'pdf', 'application/pdf', 2048, $3, null)`,
        [u.fac1, mine, "b".repeat(64)]
      )
      assert.deepEqual(await one(tx, "select version_id, storage_path from public.kpi_entry_files where id = $1", [file]), original)

      assert.equal(await count(tx, u.qaHead, "select count(*)::int as n from public.documents where id = $1", [mine]), 0, "the reviewer cannot browse the document")
      assert.equal(await count(tx, u.qaHead, "select count(*)::int as n from public.kpi_entry_files where id = $1", [file]), 1, "but can see the attached file")
      assert.equal(await count(tx, u.fac2, "select count(*)::int as n from public.kpi_entry_files where id = $1", [file]), 0)

      await asUser(tx, u.fac1, (t) => t.query("delete from public.kpi_entry_files where id = $1", [file]))
      assert.equal(await count(tx, u.fac1, "select count(*)::int as n from public.kpi_entry_files where entry_id = $1", [entry]), 0, "removable while still a draft")
      await tx.rollback()
    })
  })

  test("one period can mix uploaded files and repository files", async () => {
    await db.transaction(async (tx) => {
      const y = await currentYear(tx)
      await assign(tx, u.hr, [u.fac1], y.s, y.e)
      const a = await assignmentOf(tx, u.fac1)
      const entry = (await entries(tx, a))[0].id
      for (const name of ["one", "two"]) {
        await tx.query("select public.record_kpi_entry_file($1, $2, $3, 'a.pdf', 'pdf', 'application/pdf', 10, $4)", [u.fac1, entry, `${d.acad}/kpi/${entry}/${name}.pdf`, "c".repeat(64)])
      }
      for (const name of ["Record A", "Record B", "Record C"]) {
        const doc = await makeDocument(tx, u.fac1, name)
        await asUser(tx, u.fac1, (t) => t.query("select public.attach_repository_file($1, $2)", [entry, doc]))
      }
      const files = await asUser(tx, u.hod, (t) => t.query("select source, count(*)::int as n from public.kpi_entry_files where entry_id = $1 group by source order by source", [entry]))
      assert.deepEqual(files.rows, [{ source: "repository", n: 3 }, { source: "upload", n: 2 }], "and their reviewer sees all five")
      await tx.rollback()
    })
  })

  test("uploaded files need the entry's storage path, and at most 10 per period", async () => {
    await db.transaction(async (tx) => {
      const y = await currentYear(tx)
      await assign(tx, u.hr, [u.fac1], y.s, y.e)
      const entry = (await entries(tx, await assignmentOf(tx, u.fac1)))[0].id
      const record = (path) =>
        tx.query("select public.record_kpi_entry_file($1, $2, $3, 'a.pdf', 'pdf', 'application/pdf', 10, $4)", [u.fac1, entry, path, "c".repeat(64)])
      await expectErrorInTx(tx, () => record("elsewhere/a.pdf"), /Invalid storage path/)
      for (let i = 0; i < 10; i++) await record(`${d.acad}/kpi/${entry}/${i}.pdf`)
      await expectErrorInTx(tx, () => record(`${d.acad}/kpi/${entry}/x.pdf`), /at most 10 files/)
      await tx.rollback()
    })
  })
})

describe("reviewing and scoring", () => {
  const save = (tx, entry, text = "Done") => asUser(tx, u.fac1, (t) => t.query("select public.save_kpi_entry($1, $2)", [entry, text]))
  const submit = async (tx, entry) => {
    await save(tx, entry)
    await asUser(tx, u.fac1, (t) => t.query("select public.submit_kpi_entries($1::uuid[])", [[entry]]))
  }
  const statusOf = (tx, entry) => one(tx, "select status from public.kpi_entries where id = $1", [entry]).then((r) => r.status)

  test("a period goes from the person to the reviewer to the scorer", async () => {
    await db.transaction(async (tx) => {
      const y = await currentYear(tx)
      await assign(tx, u.hr, [u.fac1], y.s, y.e)
      const e = (await entries(tx, await assignmentOf(tx, u.fac1)))[0].id

      await expectErrorInTx(tx, () => approve(tx, u.hod, e), /once it is submitted or its due date has passed/)
      await submit(tx, e)
      assert.equal(await statusOf(tx, e), "submitted")
      await expectErrorInTx(tx, () => score(tx, u.qaHead, e, 8), /reviewer has to approve/)
      await expectErrorInTx(tx, () => score(tx, u.hod, e, 8), /Only the scorer/)

      await expectErrorInTx(tx, () => approve(tx, u.qaHead, e), /Only the reviewer/)
      await expectErrorInTx(tx, () => approve(tx, u.fac1, e), /Only the reviewer/)
      await approve(tx, u.hod, e, " Looks right ")
      const row = await one(tx, "select status, approved_by, approved_at is not null as stamped, approval_comment from public.kpi_entries where id = $1", [e])
      assert.deepEqual(row, { status: "approved", approved_by: u.hod, stamped: true, approval_comment: "Looks right" })
      await expectErrorInTx(tx, () => approve(tx, u.hod, e), /Only a submitted or missed period/)

      assert.match((await one(tx, "select title from public.notifications where user_id = $1 and type = 'kpi_to_score'", [u.qaHead])).title, /KPI to score: Fac One/)
      assert.match((await one(tx, "select title from public.notifications where user_id = $1 and type = 'kpi_reviewed'", [u.fac1])).title, /^KPI approved: Teaching/)

      await expectErrorInTx(tx, () => score(tx, u.hod, e, 8), /Only the scorer/)
      await expectErrorInTx(tx, () => score(tx, u.hr, e, 8), /Only the scorer/)
      await expectErrorInTx(tx, () => score(tx, u.fac2, e, 8), /Only the scorer/)
      await expectErrorInTx(tx, () => score(tx, u.fac1, e, 8), /your own KPI/)
      await expectErrorInTx(tx, () => score(tx, u.qaHead, e, 0), /from 1 to 10/)
      await expectErrorInTx(tx, () => score(tx, u.qaHead, e, 11), /from 1 to 10/)
      await score(tx, u.qaHead, e, 8)
      assert.equal(await statusOf(tx, e), "scored")
      assert.equal((await one(tx, "select scored_by from public.kpi_entry_scores where entry_id = $1", [e])).scored_by, u.qaHead)
      await tx.rollback()
    })
  })

  test("the reviewer and the scorer can be the same person, as two separate steps", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx, { reviewer: u.qaHead })
      await expectErrorInTx(tx, () => score(tx, u.qaHead, p.research, 7), /reviewer has to approve/)
      await approve(tx, u.qaHead, p.research)
      await score(tx, u.qaHead, p.research, 7)
      assert.equal(await statusOf(tx, p.research), "scored")
      await tx.rollback()
    })
  })

  test("a missed period is forwarded by the reviewer, and the person can then no longer submit it", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx)
      const e = p.research
      await expectErrorInTx(tx, () => score(tx, u.qaHead, e, 3), /reviewer has to approve/)
      await approve(tx, u.hod, e)
      const row = await one(tx, "select status, submitted_at from public.kpi_entries where id = $1", [e])
      assert.deepEqual(row, { status: "approved", submitted_at: null })
      assert.equal((await one(tx, "select count(*)::int as n from public.audit_logs where entity_id = $1 and action = 'kpi_entry_forwarded'", [p.id])).n, 1)
      assert.match((await one(tx, "select title from public.notifications where user_id = $1 and type = 'kpi_reviewed'", [u.fac1])).title, /^KPI forwarded for scoring: Research/)
      await expectErrorInTx(tx, () => save(tx, e), /already been submitted/)
      await score(tx, u.qaHead, e, 3)

      // Until it is forwarded, the person can still submit late.
      await submit(tx, p.admin)
      assert.equal(await statusOf(tx, p.admin), "submitted")
      await tx.rollback()
    })
  })

  test("send back needs a comment, returns it to the person, and is not possible once approved", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx)
      const e = p.research
      await expectErrorInTx(tx, () => asUser(tx, u.hod, (t) => t.query("select public.return_kpi_entry($1, 'too soon')", [e])), /Only a submitted period/)
      await submit(tx, e)
      await expectErrorInTx(tx, () => asUser(tx, u.hod, (t) => t.query("select public.return_kpi_entry($1, '  ')", [e])), /Explain what needs to change/)
      await expectErrorInTx(tx, () => asUser(tx, u.fac2, (t) => t.query("select public.return_kpi_entry($1, 'no')", [e])), /Only the reviewer/)
      await expectErrorInTx(tx, () => asUser(tx, u.qaHead, (t) => t.query("select public.return_kpi_entry($1, 'no')", [e])), /Only the reviewer/)
      await asUser(tx, u.hod, (t) => t.query("select public.return_kpi_entry($1, 'Add the links')", [e]))
      const back = await asUser(tx, u.fac1, (t) => one(t, "select status, returned_comment from public.kpi_entries where id = $1", [e]))
      assert.deepEqual(back, { status: "changes_requested", returned_comment: "Add the links" })
      await submit(tx, e)
      await approve(tx, u.hod, e)
      await expectErrorInTx(tx, () => asUser(tx, u.hod, (t) => t.query("select public.return_kpi_entry($1, 'wait')", [e])), /Only a submitted period/)
      await expectErrorInTx(tx, () => asUser(tx, u.qaHead, (t) => t.query("select public.return_kpi_entry($1, 'wait')", [e])), /Only the reviewer/)
      await score(tx, u.qaHead, e, 9)
      await tx.rollback()
    })
  })

  test("not applicable needs a reason, leaves the average, and can be reopened", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx)
      const [apr, may, jun] = p.teaching
      await decide(tx, apr, 8)
      const na = (who, entry, reason) => asUser(tx, who, (t) => t.query("select public.set_kpi_entry_not_applicable($1, $2)", [entry, reason]))
      const reopen = (who, entry) => asUser(tx, who, (t) => t.query("select public.reopen_kpi_entry($1)", [entry]))
      await expectErrorInTx(tx, () => na(u.hod, may, " "), /Give a reason/)
      await expectErrorInTx(tx, () => na(u.fac1, may, "I was busy"), /Only the reviewer, the scorer or HR/)
      await expectErrorInTx(tx, () => na(u.fac2, may, "Not mine"), /Only the reviewer, the scorer or HR/)
      await expectErrorInTx(tx, () => na(u.hod, apr, "scored"), /A scored period cannot/)
      await na(u.hod, may, "On leave")
      const s = await scores(tx, u.hod, p.id)
      assert.equal(num(s.areas[0].score), 8)
      assert.equal(num(s.not_applicable), 1)
      await reopen(u.hr, may)
      assert.equal(await statusOf(tx, may), "open")

      // The scorer's choices are a score or not applicable. Reopening clears the approval.
      await approve(tx, u.hod, jun, "Fine")
      await na(u.qaHead, jun, "Course cancelled")
      await reopen(u.qaHead, jun)
      assert.deepEqual(await one(tx, "select status, approved_by, approved_at, approval_comment from public.kpi_entries where id = $1", [jun]), {
        status: "open",
        approved_by: null,
        approved_at: null,
        approval_comment: null,
      })

      // Something was submitted: it goes back to the reviewer, not straight to scoring.
      await submit(tx, p.research)
      await approve(tx, u.hod, p.research)
      await na(u.qaHead, p.research, "Not this year")
      await reopen(u.hod, p.research)
      assert.equal(await statusOf(tx, p.research), "submitted")
      await expectErrorInTx(tx, () => score(tx, u.qaHead, p.research, 7), /reviewer has to approve/)
      await tx.rollback()
    })
  })

  test("corrections: the scorer until release, then HR only; the reviewer never; every change is logged", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx)
      const e = p.research
      await decide(tx, e, 6)
      await score(tx, u.qaHead, e, 7)
      await expectErrorInTx(tx, () => score(tx, u.hod, e, 8), /can only be changed by HR/)
      await asUser(tx, u.qaHead, (t) => t.query("select public.set_kpi_scores_released($1, true)", [p.id]))
      await expectErrorInTx(tx, () => score(tx, u.qaHead, e, 8), /can only be changed by HR/)
      await score(tx, u.hr, e, 8)
      const log = await tx.query("select action, meta ->> 'old_score' as old_score, meta ->> 'new_score' as new_score from public.audit_logs where entity_type = 'kpi_score' and entity_id = $1 and action like 'kpi_%score%' and action not like 'kpi_final%' order by id", [p.id])
      assert.deepEqual(log.rows, [
        { action: "kpi_entry_scored", old_score: null, new_score: "6" },
        { action: "kpi_score_changed", old_score: "6", new_score: "7" },
        { action: "kpi_score_changed", old_score: "7", new_score: "8" },
      ])
      await tx.rollback()
    })
  })

  test("the reviewer can be changed by HR; the new one approves", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx)
      await expectErrorInTx(tx, () => asUser(tx, u.hod, (t) => t.query("select public.change_kpi_reviewer($1, $2)", [p.id, u.qaHead])), /permission/)
      await expectErrorInTx(tx, () => asUser(tx, u.hr, (t) => t.query("select public.change_kpi_reviewer($1, $2)", [p.id, u.fac1])), /own KPI/)
      await asUser(tx, u.hr, (t) => t.query("select public.change_kpi_reviewer($1, $2)", [p.id, u.qaHead]))
      await expectErrorInTx(tx, () => approve(tx, u.hod, p.research), /Only the reviewer/)
      await approve(tx, u.qaHead, p.research)
      await tx.rollback()
    })
  })

  test("task counts: missed and submitted periods for the reviewer, approved ones for the scorer", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx)
      const counts = (who) => asUser(tx, who, (t) => one(t, "select public.my_task_counts() as c", [])).then((r) => r.c)
      assert.equal((await counts(u.hod)).kpi_to_review, 5, "all five are past due")
      assert.equal((await counts(u.hod)).kpi_to_score, 0)
      assert.equal((await counts(u.qaHead)).kpi_to_score, 0, "nothing has been approved")
      assert.equal((await counts(u.fac1)).kpi_to_fill, 5)
      assert.equal((await counts(u.fac1)).kpi_overdue, 5)

      await approve(tx, u.hod, p.research)
      assert.equal((await counts(u.hod)).kpi_to_review, 4)
      assert.equal((await counts(u.qaHead)).kpi_to_score, 1)
      assert.equal((await counts(u.fac1)).kpi_to_fill, 4)

      await score(tx, u.qaHead, p.research, 5)
      assert.equal((await counts(u.qaHead)).kpi_to_score, 0)
      await tx.rollback()
    })
  })

  test("the Final Score waits while a period is approved but not scored", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx)
      for (const [e, v] of [[p.teaching[0], 8], [p.teaching[1], 6], [p.teaching[2], 7], [p.research, 9]]) await decide(tx, e, v)
      await approve(tx, u.hod, p.admin)
      const s = await scores(tx, u.hod, p.id)
      assert.deepEqual([num(s.approved), num(s.undecided), s.final_score], [1, 1, null])
      await score(tx, u.qaHead, p.admin, 5)
      assert.equal(num((await scores(tx, u.hod, p.id)).final_score), 72)
      await tx.rollback()
    })
  })
})

describe("the scorer", () => {
  const scorerOf = (tx, user) => one(tx, "select scorer_id from public.kpi_assignments where user_id = $1 order by created_at desc limit 1", [user]).then((r) => r.scorer_id)
  const setScorer = (tx, department, user) => tx.query("update public.kpis set scorer_department_id = $1, scorer_user_id = $2 where id = $3", [department, user, kpi])

  test("comes from the KPI: the head of a department or a person; choosing one when assigning replaces it", async () => {
    await db.transaction(async (tx) => {
      const y = await currentYear(tx)
      await assign(tx, u.hr, [u.fac1], y.s, y.e)
      assert.equal(await scorerOf(tx, u.fac1), u.qaHead, "the head of Quality")

      await setScorer(tx, null, u.hod)
      await assign(tx, u.hr, [u.fac2], y.s, y.e)
      assert.equal(await scorerOf(tx, u.fac2), u.hod, "a specific person")

      await assign(tx, u.hr, [u.fac3], y.s, y.e, { scorer: u.qaHead })
      assert.equal(await scorerOf(tx, u.fac3), u.qaHead, "chosen when assigning")
      await tx.rollback()
    })
  })

  test("is saved on the assignment, so a new department head doesn't move it", async () => {
    await db.transaction(async (tx) => {
      const y = await currentYear(tx)
      await assign(tx, u.hr, [u.fac1], y.s, y.e)
      await tx.query("update public.departments set head_user_id = null where id = $1", [d.qa])
      assert.equal(await scorerOf(tx, u.fac1), u.qaHead)
      await tx.rollback()
    })
  })

  test("assigning is refused without a usable scorer", async () => {
    await db.transaction(async (tx) => {
      const y = await currentYear(tx)
      await tx.query("update public.departments set head_user_id = null where id = $1", [d.qa])
      await expectErrorInTx(tx, () => assign(tx, u.hr, [u.fac1], y.s, y.e), /Quality has no head\. Set one, or choose a specific scorer/)
      await assign(tx, u.hr, [u.fac1], y.s, y.e, { scorer: u.hod })
      assert.equal(await scorerOf(tx, u.fac1), u.hod, "a chosen scorer works without a head")

      await setScorer(tx, null, null)
      await expectErrorInTx(tx, () => assign(tx, u.hr, [u.fac2], y.s, y.e), /Set the scorer of "Faculty KPI"/)

      await setScorer(tx, null, u.fac2)
      await expectErrorInTx(tx, () => assign(tx, u.hr, [u.fac2], y.s, y.e), /Fac Two cannot score their own KPI/)
      await expectErrorInTx(tx, () => assign(tx, u.hr, [u.fac3], y.s, y.e, { scorer: u.fac3 }), /Fac Three cannot score their own KPI/)

      await tx.query("update public.profiles set is_active = false where id = $1", [u.fac2])
      await expectErrorInTx(tx, () => assign(tx, u.hr, [u.fac3], y.s, y.e), /scorer must be an active user/)
      await tx.rollback()
    })
  })

  test("sees the assignment, its files and its scores, without needing a role", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx, { user: u.fac3, reviewer: u.qaHead, scorer: u.hod })
      await tx.query("select public.record_kpi_entry_file($1, $2, $3, 'a.pdf', 'pdf', 'application/pdf', 10, $4)", [u.fac3, p.research, `${d.acad}/kpi/${p.research}/a.pdf`, "c".repeat(64)])
      await decide(tx, p.research, 8, null, { reviewer: u.qaHead, scorer: u.hod })
      const seen = (sql) => count(tx, u.hod, sql, [p.id])
      assert.equal(await seen("select count(*)::int as n from public.kpi_assignments where id = $1"), 1)
      assert.equal(await seen("select count(*)::int as n from public.kpi_entries where assignment_id = $1"), 5)
      assert.equal(await seen("select count(*)::int as n from public.kpi_entry_files where assignment_id = $1"), 1)
      assert.equal(await seen("select count(*)::int as n from public.kpi_entry_scores where assignment_id = $1"), 1)
      await tx.rollback()
    })
  })

  test("releases scores; the reviewer no longer can", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx)
      const release = (who, on) => asUser(tx, who, (t) => t.query("select public.set_kpi_scores_released($1, $2)", [p.id, on]))
      await expectErrorInTx(tx, () => release(u.hod, true), /permission/)
      await expectErrorInTx(tx, () => release(u.fac1, true), /permission/)
      await release(u.qaHead, true)
      await expectErrorInTx(tx, () => release(u.qaHead, false), /permission/)
      await release(u.hr, false)
      await tx.rollback()
    })
  })

  test("can be changed by HR, and the new one scores; renewing keeps them", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx)
      const change = (who, to) => asUser(tx, who, (t) => t.query("select public.change_kpi_scorer($1, $2)", [p.id, to]))
      await approve(tx, u.hod, p.research)
      await expectErrorInTx(tx, () => change(u.hod, u.fac2), /permission/)
      await expectErrorInTx(tx, () => change(u.hr, u.fac1), /score their own KPI/)
      await change(u.hr, u.fac2)
      assert.match((await one(tx, "select body from public.notifications where user_id = $1 and type = 'kpi_to_score'", [u.fac2])).body, /You are now the scorer/)
      await expectErrorInTx(tx, () => score(tx, u.qaHead, p.research, 5), /Only the scorer/)
      await score(tx, u.fac2, p.research, 5)
      assert.equal((await one(tx, "select count(*)::int as n from public.audit_logs where entity_id = $1 and action = 'kpi_scorer_changed'", [p.id])).n, 1)

      await asUser(tx, u.hr, (t) => t.query("select public.renew_kpi_assignments($1::uuid[], '2024-07-01', '2025-03-31')", [[p.id]]))
      const next = await one(tx, "select scorer_id from public.kpi_assignments where user_id = $1 and start_date = '2024-07-01'", [u.fac1])
      assert.equal(next.scorer_id, u.fac2)
      await tx.rollback()
    })
  })

  test("an assignment without one can still be approved, and whoever assigned it is told", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx)
      await tx.query("update public.kpi_assignments set scorer_id = null where id = $1", [p.id])
      await approve(tx, u.hod, p.research)
      assert.equal((await one(tx, "select status from public.kpi_entries where id = $1", [p.research])).status, "approved")
      assert.match((await one(tx, "select title from public.notifications where user_id = $1 and type = 'kpi_no_scorer'", [u.hr])).title, /KPI has no scorer: Fac One/)
      await expectErrorInTx(tx, () => score(tx, u.hr, p.research, 5), /Only the scorer/)
      await asUser(tx, u.hr, (t) => t.query("select public.change_kpi_scorer($1, $2)", [p.id, u.qaHead]))
      await score(tx, u.qaHead, p.research, 5)
      await tx.rollback()
    })
  })
})

describe("scores", () => {
  test("Area scores and the Projected Score: the worked example", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx)
      const [apr, may, jun] = p.teaching
      await decide(tx, apr, 8)
      await decide(tx, may, 6)
      await decide(tx, jun, 7)
      await decide(tx, p.research, 9)
      const s = await scores(tx, u.hod, p.id)
      assert.deepEqual(s.areas.map((a) => num(a.score)), [7, 9, null])
      assert.equal(num(s.projected_score), 78, "(7 × 50 + 9 × 30) ÷ 80 = 7.75 out of 10: 77.5 rounds to 78 out of 100")
      assert.equal(s.final_rating, null, "a rating belongs to the Final Score")
      assert.equal(s.final_score, null, "one period is still undecided")
      assert.equal(num(s.scored), 4)
      assert.equal(num(s.total), 5)
      assert.equal(num(s.undecided), 1)
      await tx.rollback()
    })
  })

  test("Final Score: only when the period is over and everything is decided; re-running changes nothing", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx)
      for (const [e, v] of [[p.teaching[0], 8], [p.teaching[1], 6], [p.teaching[2], 7], [p.research, 9]]) await decide(tx, e, v)
      assert.equal((await one(tx, "select count(*)::int as n from public.kpi_final_scores where assignment_id = $1 and final_score is not null", [p.id])).n, 0)
      await decide(tx, p.admin, 5)

      const f = await one(tx, "select final_score, final_rating, area_scores, generated_at from public.kpi_final_scores where assignment_id = $1", [p.id])
      assert.equal(num(f.final_score), 72, "(7 × 50 + 9 × 30 + 5 × 20) ÷ 100 = 7.2 out of 10")
      assert.equal(f.final_rating, "Satisfactory")
      assert.deepEqual(f.area_scores.map((a) => [a.name, Number(a.weightage), Number(a.score)]), [["Teaching", 50, 7], ["Research", 30, 9], ["Admin", 20, 5]])

      await tx.query("select public.generate_due_requirements()")
      const again = await one(tx, "select generated_at from public.kpi_final_scores where assignment_id = $1", [p.id])
      assert.deepEqual(again.generated_at, f.generated_at, "the daily job does not regenerate an unchanged score")

      // Later edits to the KPI don't change the stored result.
      await tx.query("update public.kpi_areas set weightage = 10 where kpi_id = $1 and name = 'Admin'", [kpi])
      await tx.query("select public.generate_due_requirements()")
      assert.equal(num((await one(tx, "select final_score from public.kpi_final_scores where assignment_id = $1", [p.id])).final_score), 72)
      await tx.rollback()
    })
  })

  test("Final Score waits for an open year; the daily job generates it when the year ends", async () => {
    await db.transaction(async (tx) => {
      const y = await currentYear(tx)
      await assign(tx, u.hr, [u.fac1], y.s, y.e)
      const a = await assignmentOf(tx, u.fac1)
      for (const r of await entries(tx, a)) {
        await asUser(tx, u.hr, (t) => t.query("select public.set_kpi_entry_not_applicable($1, 'n/a')", [r.id]))
      }
      assert.equal((await scores(tx, u.hod, a)).final_score, null, "the year is still open")

      // By year end the remaining periods exist and wait for decisions.
      const after = await one(tx, "select ($1::date + 1)::text as d", [y.e])
      await tx.query("select public.generate_due_requirements($1::date)", [after.d])
      const undecided = (await entries(tx, a)).filter((r) => r.status === "open")
      assert.ok(undecided.length > 0, "later months and quarters were created")
      assert.equal((await scores(tx, u.hod, a)).final_score, null, "periods are still undecided")

      for (const r of undecided) {
        await asUser(tx, u.fac1, (t) => t.query("select public.save_kpi_entry($1, 'Done')", [r.id]))
        await asUser(tx, u.fac1, (t) => t.query("select public.submit_kpi_entries($1::uuid[])", [[r.id]]))
        await decide(tx, r.id, 6)
      }
      assert.equal((await scores(tx, u.hod, a)).final_score, null, "all decided, but the year is not over yet")

      await tx.query("select public.generate_due_requirements($1::date)", [after.d])
      assert.equal(num((await scores(tx, u.hod, a)).final_score), 60, "the daily job generates it once the year has ended")
      await tx.rollback()
    })
  })

  test("an HR correction regenerates the Final Score and logs old and new", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx)
      for (const [e, v] of [[p.teaching[0], 8], [p.teaching[1], 6], [p.teaching[2], 7], [p.research, 9], [p.admin, 5]]) await decide(tx, e, v)
      await expectErrorInTx(tx, () => score(tx, u.qaHead, p.admin, 10), /can only be changed by HR/)
      await score(tx, u.hr, p.admin, 10)
      const corrected = await one(tx, "select final_score, final_rating from public.kpi_final_scores where assignment_id = $1", [p.id])
      assert.equal(num(corrected.final_score), 82, "the Admin area went from 5 to 10")
      assert.equal(corrected.final_rating, "Very Good", "the rating follows the correction")
      const log = await one(tx, "select meta from public.audit_logs where entity_type = 'kpi_score' and entity_id = $1 and action = 'kpi_final_score_changed'", [p.id])
      assert.deepEqual([Number(log.meta.old_score), Number(log.meta.new_score), log.meta.old_rating, log.meta.rating], [72, 82, "Satisfactory", "Very Good"])
      await tx.rollback()
    })
  })

  test("an area with every period not applicable is scaled out of the Final Score", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx)
      for (const [e, v] of [[p.teaching[0], 8], [p.teaching[1], 6], [p.teaching[2], 7], [p.admin, 5]]) await decide(tx, e, v)
      await asUser(tx, u.hod, (t) => t.query("select public.set_kpi_entry_not_applicable($1, 'No research this year')", [p.research]))
      const f = await one(tx, "select final_score from public.kpi_final_scores where assignment_id = $1", [p.id])
      assert.equal(num(f.final_score), 64, "(7 × 50 + 5 × 20) ÷ 70 = 6.43 out of 10: rounds to 64 out of 100")
      // Reopening makes the year incomplete again: the Final Score is cleared.
      await asUser(tx, u.hod, (t) => t.query("select public.reopen_kpi_entry($1)", [p.research]))
      assert.equal((await one(tx, "select final_score from public.kpi_final_scores where assignment_id = $1", [p.id])).final_score, null)
      await tx.rollback()
    })
  })

  test("ending an assignment early lets the Final Score generate from what was decided", async () => {
    await db.transaction(async (tx) => {
      const y = await currentYear(tx)
      await assign(tx, u.hr, [u.fac1], y.s, y.e)
      const a = await assignmentOf(tx, u.fac1)
      await asUser(tx, u.hr, (t) => t.query("select public.set_kpi_assignment_status($1, false)", [a]))
      const rows = await entries(tx, a)
      for (const r of rows) await decide(tx, r.id, 6)
      assert.equal(num((await one(tx, "select final_score from public.kpi_final_scores where assignment_id = $1", [a])).final_score), 60)
      // Reopening clears it, since the year is running again.
      await asUser(tx, u.hr, (t) => t.query("select public.set_kpi_assignment_status($1, true)", [a]))
      assert.equal((await one(tx, "select final_score from public.kpi_final_scores where assignment_id = $1", [a])).final_score, null)
      await tx.rollback()
    })
  })

  test("weights changed by a push stay on the 10 scale", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx)
      await tx.query("update public.kpi_assignment_areas set weightage = 80 where assignment_id = $1 and name = 'Teaching'", [p.id])
      for (const e of p.teaching) await decide(tx, e, 10)
      await decide(tx, p.research, 10)
      await decide(tx, p.admin, 10)
      assert.equal(num((await one(tx, "select final_score from public.kpi_final_scores where assignment_id = $1", [p.id])).final_score), 100, "the top of the scale fits")
      await tx.rollback()
    })
  })
})

describe("final rating", () => {
  test("each band starts at its lower limit", async () => {
    const expected = [
      [100, "Outstanding"],
      [85, "Outstanding"],
      [84, "Very Good"],
      [75, "Very Good"],
      [74, "Satisfactory"],
      [65, "Satisfactory"],
      [64, "Improvement Required"],
      [50, "Improvement Required"],
      [49, "Unsatisfactory"],
      [10, "Unsatisfactory"],
    ]
    for (const [value, rating] of expected) {
      assert.equal((await one(db, "select public.kpi_score_rating($1::numeric) as r", [value])).r, rating, String(value))
    }
    assert.equal((await one(db, "select public.kpi_score_rating(null) as r")).r, null)
  })

  test("the Final Score is a whole number, so no result falls between two bands", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx)
      // Teaching 8.33 × 50 + Research 9 × 30 + Admin 8 × 20 = 84.67 out of 100
      for (const [e, v] of [[p.teaching[0], 9], [p.teaching[1], 8], [p.teaching[2], 8], [p.research, 9], [p.admin, 8]]) await decide(tx, e, v)
      const f = await one(tx, "select final_score, final_rating, area_scores from public.kpi_final_scores where assignment_id = $1", [p.id])
      assert.deepEqual([num(f.final_score), f.final_rating], [85, "Outstanding"])
      assert.equal(Number(f.area_scores[0].score), 8.33, "Area scores keep their decimals")
      await tx.rollback()
    })
  })

  test("the rating clears if the year is no longer complete", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx)
      for (const [e, v] of [[p.teaching[0], 10], [p.teaching[1], 8], [p.teaching[2], 9], [p.research, 9], [p.admin, 9]]) await decide(tx, e, v)
      const f = await one(tx, "select final_score, final_rating from public.kpi_final_scores where assignment_id = $1", [p.id])
      assert.deepEqual([num(f.final_score), f.final_rating], [90, "Outstanding"])
      await tx.query("update public.kpi_entries set status = 'open' where id = $1", [p.research])
      await tx.query("select public.generate_kpi_final_score($1)", [p.id])
      const cleared = await one(tx, "select final_score, final_rating from public.kpi_final_scores where assignment_id = $1", [p.id])
      assert.deepEqual([cleared.final_score, cleared.final_rating], [null, null])
      await tx.rollback()
    })
  })
})

describe("hidden scores", () => {
  test("before release the person gets no score by any route; afterwards they do", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx)
      for (const [e, v] of [[p.teaching[0], 8], [p.teaching[1], 6], [p.teaching[2], 7], [p.research, 9], [p.admin, 5]]) await decide(tx, e, v, "Good work")

      const person = async () => ({
        rows: await count(tx, u.fac1, "select count(*)::int as n from public.kpi_entry_scores where assignment_id = $1", [p.id]),
        finals: await count(tx, u.fac1, "select count(*)::int as n from public.kpi_final_scores where assignment_id = $1", [p.id]),
        audit: await count(tx, u.fac1, "select count(*)::int as n from public.audit_logs where entity_type = 'kpi_score' and entity_id = $1", [p.id]),
        s: await scores(tx, u.fac1, p.id),
      })

      const hidden = await person()
      assert.equal(hidden.rows, 0, "score table")
      assert.equal(hidden.finals, 0, "final score table")
      assert.equal(hidden.audit, 0, "audit log")
      assert.equal(hidden.s.projected_score, null, "projected score")
      assert.equal(hidden.s.final_score, null, "final score")
      assert.equal(hidden.s.final_rating, null, "final rating")
      assert.ok(hidden.s.areas.every((a) => a.score === null), "area scores")
      assert.equal(num(hidden.s.scored), 5, "they can see that periods were reviewed")

      const notes = await tx.query("select title, body from public.notifications where user_id = $1", [u.fac1])
      assert.ok(notes.rows.length > 0)
      assert.ok(notes.rows.every((n) => !/score(d)? (of )?\d/i.test(`${n.title} ${n.body}`) && !/Good work/.test(`${n.title} ${n.body}`)), "notifications")

      // The people around them can always see.
      assert.equal(num((await scores(tx, u.hod, p.id)).final_score), 72, "reviewer")
      assert.equal(num((await scores(tx, u.qaHead, p.id)).final_score), 72, "scorer")
      assert.equal(num((await scores(tx, u.hr, p.id)).final_score), 72, "HR")
      assert.equal(await count(tx, u.fac2, "select count(*)::int as n from public.kpi_entry_scores where assignment_id = $1", [p.id]), 0, "a colleague never")

      await expectErrorInTx(tx, () => asUser(tx, u.fac1, (t) => t.query("select public.set_kpi_scores_released($1, true)", [p.id])), /permission/)
      await asUser(tx, u.qaHead, (t) => t.query("select public.set_kpi_scores_released($1, true)", [p.id]))
      const release = await one(tx, "select body from public.notifications where user_id = $1 and type = 'kpi_scores_released'", [u.fac1])
      assert.ok(release, "the person is notified")

      const shown = await person()
      assert.equal(shown.rows, 5)
      assert.equal(shown.finals, 1)
      assert.ok(shown.audit > 0)
      assert.equal(num(shown.s.final_score), 72)
      assert.equal(shown.s.final_rating, "Satisfactory")

      await expectErrorInTx(tx, () => asUser(tx, u.qaHead, (t) => t.query("select public.set_kpi_scores_released($1, false)", [p.id])), /permission/)
      await asUser(tx, u.hr, (t) => t.query("select public.set_kpi_scores_released($1, false)", [p.id]))
      assert.equal((await person()).rows, 0, "HR can hide them again")
      await tx.rollback()
    })
  })

  test("a person with HR rights cannot see or release their own scores", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx, { user: u.hr, reviewer: u.qaHead })
      await decide(tx, p.research, 9, null, { reviewer: u.qaHead })
      assert.equal(await count(tx, u.hr, "select count(*)::int as n from public.kpi_entry_scores where assignment_id = $1", [p.id]), 0)
      assert.equal((await scores(tx, u.hr, p.id)).projected_score, null)
      await expectErrorInTx(tx, () => asUser(tx, u.hr, (t) => t.query("select public.set_kpi_scores_released($1, true)", [p.id])), /permission/)
      await expectErrorInTx(tx, () => score(tx, u.hr, p.research, 10), /your own KPI/)
      await tx.rollback()
    })
  })

  test("a renewed KPI starts hidden, for the next year", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx)
      await asUser(tx, u.hr, (t) => t.query("select public.set_kpi_scores_released($1, true)", [p.id]))
      await asUser(tx, u.hr, (t) => t.query("select public.renew_kpi_assignments($1::uuid[], '2024-07-01', '2025-03-31')", [[p.id]]))
      const next = await one(tx, "select reviewer_id, scorer_id, scores_released_at from public.kpi_assignments where user_id = $1 and start_date = '2024-07-01'", [u.fac1])
      assert.deepEqual(next, { reviewer_id: u.hod, scorer_id: u.qaHead, scores_released_at: null })
      await tx.rollback()
    })
  })
})

describe("privacy", () => {
  test("only the person, their line, reviewer and HR see entries and files", async () => {
    await db.transaction(async (tx) => {
      const y = await currentYear(tx)
      await assign(tx, u.hr, [u.fac1], y.s, y.e)
      await assign(tx, u.hr, [u.fac3], y.s, y.e, { reviewer: u.qaHead })
      const a3 = await assignmentOf(tx, u.fac3)
      const seen = (who, assignment) => count(tx, who, "select count(*)::int as n from public.kpi_entries where assignment_id = $1", [assignment])

      assert.equal(await seen(u.fac3, a3), 3, "the person")
      assert.equal(await seen(u.fac2, a3), 0, "a colleague")
      assert.equal(await seen(u.hod, a3), 0, "a head who is not above them and not their reviewer")
      assert.equal(await seen(u.viewer, a3), 0, "all-access viewers")
      assert.equal(await seen(u.qaHead, a3), 3, "their reviewer")
      assert.equal(await seen(u.hr, a3), 3, "kpi.view_all")

      const assignments = (who) => count(tx, who, "select count(*)::int as n from public.kpi_assignments")
      assert.equal(await assignments(u.fac2), 0)
      assert.equal(await assignments(u.hod), 1, "only Fac One reports to the HOD")
      assert.equal(await assignments(u.hr), 2)

      const audit = await count(tx, u.hod, "select count(*)::int as n from public.audit_logs where entity_type in ('kpi_assignment', 'kpi_score') and entity_id = $1", [a3])
      assert.equal(audit, 0, "department audit viewers don't see it")
      await tx.rollback()
    })
  })
})

describe("generation and lifecycle", () => {
  test("the scheduler adds periods safely; ending stops them; reopening does not back-fill", async () => {
    await db.transaction(async (tx) => {
      await assign(tx, u.hr, [u.fac1, u.fac2], "2030-04-01", "2031-03-31")
      const a = await assignmentOf(tx, u.fac1)
      const a2 = await assignmentOf(tx, u.fac2)
      const n = async (id) => (await entries(tx, id)).length
      assert.equal(await n(a), 1, "only the one-time area: the year has not started")

      const run = await one(tx, "select * from public.generate_due_requirements('2030-05-15'::date)")
      assert.equal(run.error_count, 0)
      assert.equal(await n(a), 1 + 2 + 1, "plus April, May and Q1")
      await tx.query("select public.generate_due_requirements('2030-05-15'::date)")
      assert.equal(await n(a), 4, "running again adds nothing")

      await asUser(tx, u.hr, (t) => t.query("select public.set_kpi_assignment_status($1, false)", [a2]))
      const before = await n(a2)
      await tx.query("select public.generate_due_requirements('2030-09-15'::date)")
      assert.equal(await n(a2), before, "nothing new after ending")
      await expectErrorInTx(tx, () => asUser(tx, u.fac2, (t) => t.query("select public.set_kpi_assignment_status($1, true)", [a2])), /permission/)
      await tx.rollback()
    })
  })

  test("the reviewer is told once about missed periods", async () => {
    await db.transaction(async (tx) => {
      await pastAssignment(tx)
      await tx.query("select public.generate_due_requirements()")
      await tx.query("select public.generate_due_requirements()")
      const notes = await tx.query("select title, body from public.notifications where user_id = $1 and type = 'kpi_missed'", [u.hod])
      assert.equal(notes.rows.length, 1)
      assert.match(notes.rows[0].body, /^5 periods of Faculty KPI/)
      await tx.rollback()
    })
  })

  test("push adds new areas and takes the current weights; never removes", async () => {
    await db.transaction(async (tx) => {
      await assign(tx, u.hr, [u.fac1], PAST.start, PAST.end, { backfill: true })
      const a = await assignmentOf(tx, u.fac1)
      await asUser(tx, u.hr, (t) =>
        t.query("insert into public.kpi_areas (kpi_id, name, weightage, description, recurrence) values ($1, 'Mentoring', 10, 'Mentees', 'once')", [kpi])
      )
      await asUser(tx, u.hr, (t) => t.query("update public.kpi_areas set weightage = 40 where kpi_id = $1 and name = 'Teaching'", [kpi]))
      assert.equal((await asUser(tx, u.hr, (t) => one(t, "select public.push_kpi_updates($1) as n", [a]))).n, 1)
      assert.equal((await asUser(tx, u.hr, (t) => one(t, "select public.push_kpi_updates($1) as n", [a]))).n, 0)
      assert.equal(Number((await one(tx, "select weightage from public.kpi_assignment_areas where assignment_id = $1 and name = 'Teaching'", [a])).weightage), 40)
      assert.ok((await entries(tx, a)).some((r) => r.area === "Mentoring"))
      await tx.rollback()
    })
  })
})

describe("deactivation", () => {
  test("deactivating a person ends their KPIs and closes open periods; submitted work can still be scored", async () => {
    await db.transaction(async (tx) => {
      const p = await pastAssignment(tx)
      await asUser(tx, u.fac1, (t) => t.query("select public.save_kpi_entry($1, 'Done')", [p.research]))
      await asUser(tx, u.fac1, (t) => t.query("select public.submit_kpi_entries($1::uuid[])", [[p.research]]))
      await tx.query("update public.profiles set is_active = false where id = $1", [u.fac1])
      assert.equal((await one(tx, "select status from public.kpi_assignments where id = $1", [p.id])).status, "ended")
      const statuses = (await entries(tx, p.id)).map((r) => r.status)
      assert.deepEqual(statuses, ["not_applicable", "not_applicable", "not_applicable", "submitted", "not_applicable"])
      await decide(tx, p.research, 9)
      assert.equal(num((await one(tx, "select final_score from public.kpi_final_scores where assignment_id = $1", [p.id])).final_score), 90)
      await tx.rollback()
    })
  })
})

describe("moving existing data to the new model", () => {
  test("areas take the first item's interval, old assignments end, empty requirements close, nothing is deleted", async () => {
    const old = await createDb({ before: "20261105000001" })
    const dept = await createDept(old, "Academics", "ACAD")
    const head = await createUser(old, { name: "Hod", deptId: dept })
    await old.query("update public.departments set head_user_id = $1 where id = $2", [head, dept])
    const person = await createUser(old, { name: "Fac One", deptId: dept, reportsTo: head })
    const admin = await createUser(old, { name: "Admin", deptId: dept })
    await grantSystemRole(old, admin, "super_admin")
    const type = (await one(old, "select id from public.document_types where code = 'DOC'")).id

    const oldKpi = await asUser(old, admin, async (t) => {
      const id = (await one(t, "insert into public.kpis (name) values ('Old KPI') returning id")).id
      const area = async (name, weight, items) => {
        const a = (await one(t, "insert into public.kpi_areas (kpi_id, name, weightage, description) values ($1, $2, $3, 'Measured') returning id", [id, name, weight])).id
        for (const [i, [itemName, recurrence]] of items.entries()) {
          await t.query(
            "insert into public.kpi_evidence_items (area_id, name, document_type_id, recurrence, due_mode, due_days, requires_review, sort_order) values ($1, $2, $3, $4::public.recurrence_kind, 'after_creation', 3, false, $5)",
            [a, itemName, type, recurrence, i]
          )
        }
      }
      await area("Weekly first", 40, [["Plans", "weekly"], ["File", "once"]])
      await area("Quarterly", 40, [["Papers", "quarterly"]])
      await area("Once", 20, [["Course file", "once"]])
      await t.query("update public.kpis set is_active = true where id = $1", [id])
      return id
    })
    await asUser(old, admin, (t) => t.query("select public.assign_kpi($1, $2::uuid[], '2026-04-01', '2027-03-31', null, true)", [oldKpi, [person]]))
    const before = await one(old, "select count(*)::int as n from public.documents where kpi_assignment_id is not null")
    assert.ok(before.n > 0)

    await applyMigration(old, "20261105000001_kpi_scoring.sql")

    const areas = await old.query("select name, recurrence::text as recurrence from public.kpi_areas where kpi_id = $1 order by name", [oldKpi])
    assert.deepEqual(areas.rows.map((a) => [a.name, a.recurrence]), [["Once", "once"], ["Quarterly", "quarterly"], ["Weekly first", "monthly"]])
    const k = await one(old, "select is_active, reviewer_rule::text as rule, due_days from public.kpis where id = $1", [oldKpi])
    assert.deepEqual(k, { is_active: true, rule: "uploader_manager", due_days: 7 }, "the KPI stays usable")

    assert.equal((await one(old, "select status from public.kpi_assignments where user_id = $1", [person])).status, "ended")
    const docs = await one(old, "select count(*)::int as n, count(*) filter (where status = 'not_applicable')::int as closed from public.documents where kpi_assignment_id is not null")
    assert.deepEqual(docs, { n: before.n, closed: before.n }, "closed, not deleted")
    assert.equal((await one(old, "select count(*)::int as n from public.kpi_evidence_items")).n, 4, "old tables stay")

    // Re-assigning under the new model works straight away, and the daily job is clean.
    const created = await asUser(old, admin, (t) => one(t, "select public.assign_kpi($1, $2::uuid[], '2026-04-01', '2027-03-31', null, true) as n", [oldKpi, [person]]))
    assert.ok(created.n > 0)
    const run = await one(old, "select * from public.generate_due_requirements()")
    assert.equal(run.error_count, 0)
    await expectError(
      asUser(old, admin, async (t) => {
        const a = await one(t, "select id from public.kpi_assignments where reviewer_id is null")
        await t.query("select public.set_kpi_assignment_status($1, true)", [a.id])
      }),
      /made before KPI scoring/
    )
  })
})
