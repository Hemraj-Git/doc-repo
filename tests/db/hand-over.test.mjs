import { before, describe, test } from "node:test"
import assert from "node:assert/strict"
import { asUser, createDb, createDept, createUser, expectError, grantSystemRole, one } from "./harness.mjs"

/*
 *   ADMIN: director (head, Super Admin)
 *   ACAD:  hod (head) ─┬─ senior ── junior
 *                      └─ peer
 *   QA:    qaHead (head) ── qaStaff
 */
let db
const u = {}
const d = {}
let folder
let qpType

const sha = (c) => c.repeat(64)

const createDocument = (tx, uploader, reviewers, name = "Navigation QP") =>
  asUser(tx, u.hod, (t) =>
    one(t, "select public.create_document($1, $2, $3, null, null, $4, $5, $6, null) as id", [
      folder, name, qpType, uploader, reviewers.length > 0, reviewers,
    ])
  ).then((r) => r.id)

const upload = (tx, docId, actor) =>
  one(
    tx,
    `select public.record_document_version($1, $2,
       (select department_id::text from public.documents where id = $2) || '/' || $2 || '/v1.pdf',
       'v1.pdf', 'pdf', 'application/pdf', 1024, $3, null) as id`,
    [actor, docId, sha("a")]
  )

const handOver = (tx, from, to, reports = false) =>
  asUser(tx, u.director, (t) => one(t, "select public.hand_over_work($1, $2, $3) as r", [from, to, reports])).then((r) => r.r)

before(async () => {
  db = await createDb()
  d.admin = await createDept(db, "Administration", "ADMIN")
  d.acad = await createDept(db, "Academics", "ACAD")
  d.qa = await createDept(db, "Quality", "QA")

  u.director = await createUser(db, { name: "Director", deptId: d.admin })
  await db.query("update public.departments set head_user_id = $1 where id = $2", [u.director, d.admin])
  await grantSystemRole(db, u.director, "super_admin")
  u.hod = await createUser(db, { name: "Hod", deptId: d.acad })
  await db.query("update public.departments set head_user_id = $1 where id = $2", [u.hod, d.acad])
  u.senior = await createUser(db, { name: "Senior", deptId: d.acad, reportsTo: u.hod })
  u.junior = await createUser(db, { name: "Junior", deptId: d.acad, reportsTo: u.senior })
  u.peer = await createUser(db, { name: "Peer", deptId: d.acad, reportsTo: u.hod })
  u.qaHead = await createUser(db, { name: "Qa Head", deptId: d.qa })
  await db.query("update public.departments set head_user_id = $1 where id = $2", [u.qaHead, d.qa])
  u.qaStaff = await createUser(db, { name: "Qa Staff", deptId: d.qa, reportsTo: u.qaHead })

  const root = await one(db, "select id from public.folders where level = 'root' and department_id = $1", [d.acad])
  folder = (
    await asUser(db, u.hod, (t) =>
      one(t, "insert into public.folders (parent_id, department_id, level, name, reference_id) values ($1, $2, 'child', 'Question Papers', 'ACD-QP') returning id", [root.id, d.acad])
    )
  ).id
  qpType = (await one(db, "select id from public.document_types where code = 'QP'")).id
})

describe("hand over work", () => {
  test("user_open_work counts what is waiting on a person; admins only", async () => {
    await db.transaction(async (tx) => {
      await createDocument(tx, u.junior, [u.senior, u.qaHead])
      await createDocument(tx, u.peer, [u.junior], "Second")
      const work = await asUser(tx, u.director, (t) => one(t, "select public.user_open_work($1) as w", [u.junior])).then((r) => r.w)
      assert.equal(work.uploads, 1)
      assert.equal(work.reviews, 1)
      await tx.query("savepoint s")
      await expectError(asUser(tx, u.hod, (t) => t.query("select public.user_open_work($1)", [u.junior])), /permission/)
      await tx.query("rollback to savepoint s")
      await tx.rollback()
    })
  })

  test("uploads and reviewer slots move to the successor, who is notified", async () => {
    await db.transaction(async (tx) => {
      const a = await createDocument(tx, u.junior, [u.senior, u.qaHead])
      const b = await createDocument(tx, u.peer, [u.junior], "Second")
      const moved = await handOver(tx, u.junior, u.qaStaff)
      assert.equal(moved.uploads, 1)
      assert.equal(moved.reviews, 1)
      assert.equal((await one(tx, "select assigned_uploader_id from public.documents where id = $1", [a])).assigned_uploader_id, u.qaStaff)
      assert.equal((await one(tx, "select reviewer_id from public.document_reviewers where document_id = $1", [b])).reviewer_id, u.qaStaff)
      const notes = await tx.query("select type from public.notifications where user_id = $1", [u.qaStaff])
      assert.deepEqual(notes.rows.map((r) => r.type), ["upload_requested"])
      await tx.rollback()
    })
  })

  test("an active review step moves too, so a running review is not stuck", async () => {
    await db.transaction(async (tx) => {
      const a = await createDocument(tx, u.junior, [u.senior, u.qaHead])
      await upload(tx, a, u.junior)
      await handOver(tx, u.senior, u.peer)
      const step = await one(tx, "select reviewer_id from public.document_review_steps where document_id = $1 and state = 'active'", [a])
      assert.equal(step.reviewer_id, u.peer)
      const notes = await tx.query("select type from public.notifications where user_id = $1", [u.peer])
      assert.deepEqual(notes.rows.map((r) => r.type), ["review_requested"])
      await tx.rollback()
    })
  })

  test("refuses a successor who already uploads or reviews the same document", async () => {
    await db.transaction(async (tx) => {
      await createDocument(tx, u.junior, [u.senior, u.qaHead])
      await tx.query("savepoint s")
      await expectError(handOver(tx, u.junior, u.senior), /already the uploader or a reviewer of "Navigation QP"/)
      await tx.query("rollback to savepoint s")
      await expectError(handOver(tx, u.senior, u.qaHead), /already the uploader or a reviewer/)
      await tx.rollback()
    })
  })

  test("KPIs they review or score move to the successor, but never to the person being reviewed", async () => {
    await db.transaction(async (tx) => {
      const kpi = (
        await asUser(tx, u.director, (t) => one(t, "insert into public.kpis (name, due_days, scorer_user_id) values ('Staff KPI', 7, $1) returning id", [u.senior]))
      ).id
      await asUser(tx, u.director, (t) =>
        t.query("insert into public.kpi_areas (kpi_id, name, weightage, description, recurrence) values ($1, 'Work', 100, 'Output', 'quarterly')", [kpi])
      )
      await asUser(tx, u.director, (t) => t.query("update public.kpis set is_active = true where id = $1", [kpi]))
      await asUser(tx, u.director, (t) =>
        t.query("select public.assign_kpi($1, $2::uuid[], '2024-04-01', '2025-03-31', null, true)", [kpi, [u.junior]])
      )
      const before = await asUser(tx, u.director, (t) => one(t, "select public.user_open_work($1) as w", [u.senior])).then((r) => r.w)
      assert.equal(before.kpi_reviews, 1, "Senior is Junior's manager, so their reviewer")
      assert.equal(before.kpi_scores, 1, "and the KPI's scorer")

      await tx.query("savepoint s")
      await expectError(handOver(tx, u.senior, u.junior), /reviewer of their own KPI "Staff KPI"/)
      await tx.query("rollback to savepoint s")

      const moved = await handOver(tx, u.senior, u.peer)
      assert.equal(moved.kpi_reviews, 1)
      assert.equal(moved.kpi_scores, 1)
      const after = await one(tx, "select reviewer_id, scorer_id from public.kpi_assignments where user_id = $1", [u.junior])
      assert.deepEqual(after, { reviewer_id: u.peer, scorer_id: u.peer })
      assert.equal((await one(tx, "select scorer_user_id from public.kpis where id = $1", [kpi])).scorer_user_id, u.peer, "and the KPI's own setting")
      for (const type of ["kpi_to_review", "kpi_to_score"]) {
        const notes = await tx.query("select link from public.notifications where user_id = $1 and type = $2", [u.peer, type])
        assert.equal(notes.rows.length, 1, type)
      }

      // Nobody may be handed the scoring of their own KPI either.
      await tx.query("update public.kpi_assignments set reviewer_id = $1 where user_id = $2", [u.qaHead, u.junior])
      await tx.query("savepoint s")
      await expectError(handOver(tx, u.peer, u.junior), /scorer of their own KPI "Staff KPI"/)
      await tx.query("rollback to savepoint s")
      await tx.rollback()
    })
  })

  test("the successor must be someone else and active; direct reports move on request", async () => {
    await db.transaction(async (tx) => {
      await tx.query("savepoint s")
      await expectError(handOver(tx, u.junior, u.junior), /someone else/)
      await tx.query("rollback to savepoint s")
      await tx.query("update public.profiles set is_active = false where id = $1", [u.qaStaff])
      await tx.query("savepoint s")
      await expectError(handOver(tx, u.junior, u.qaStaff), /active user/)
      await tx.query("rollback to savepoint s")

      const moved = await handOver(tx, u.senior, u.peer, true)
      assert.equal(moved.reports, 1)
      assert.equal((await one(tx, "select reports_to_id from public.profiles where id = $1", [u.junior])).reports_to_id, u.peer)
      await tx.rollback()
    })
  })
})
