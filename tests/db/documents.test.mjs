import { before, describe, test } from "node:test"
import assert from "node:assert/strict"
import { asUser, createDb, createDept, createUser, expectError, grantSystemRole, one } from "./harness.mjs"

/*
 *   ADMIN: director (head, Super Admin)
 *   ACAD:  hod (head, reports to director) ─┬─ senior ── junior
 *                                           └─ peer
 *   QA:    qaHead (head)
 *   HR:    hrHead (head) ── hrStaff
 */
let db
const u = {}
const d = {}
const f = {}
let qpType

const setHead = (deptId, userId) =>
  db.query("update public.departments set head_user_id = $1 where id = $2", [userId, deptId])

const sha = (c) => c.repeat(64)

function createDocument(tx, args) {
  const a = {
    folderId: f.questionPapers,
    name: "Navigation QP – Sem 1",
    typeId: qpType,
    ref: null,
    description: null,
    uploader: u.junior,
    review: true,
    reviewers: [u.senior, u.qaHead],
    due: null,
    ...args,
  }
  return one(tx, "select public.create_document($1, $2, $3, $4, $5, $6, $7, $8, $9) as id", [
    a.folderId, a.name, a.typeId, a.ref, a.description, a.uploader, a.review, a.reviewers, a.due,
  ]).then((r) => r.id)
}

// The server calls this with the service role after verifying the file.
function recordVersion(tx, docId, actor, n = 1) {
  return one(
    tx,
    `select public.record_document_version($1, $2,
       (select department_id::text from public.documents where id = $2) || '/' || $2 || '/file-' || $3 || '.pdf',
       'qp-v' || $3 || '.pdf', 'pdf', 'application/pdf', 1024, $4, null) as id`,
    [actor, docId, n, sha(String(n % 10))]
  ).then((r) => r.id)
}

const activeStep = (tx, docId) =>
  one(tx, "select id, reviewer_id, step_order, round from public.document_review_steps where document_id = $1 and state = 'active'", [docId])

const status = (tx, docId) => one(tx, "select status from public.documents where id = $1", [docId]).then((r) => r.status)

const canSee = (tx, viewer, docId) =>
  asUser(tx, viewer, (t) => t.query("select id from public.documents where id = $1", [docId])).then((r) => r.rows.length === 1)

// Sorted by type: inside one test transaction every row has the same now().
const notificationsOf = (tx, userId) =>
  tx.query("select type from public.notifications where user_id = $1 order by type", [userId]).then((r) => r.rows.map((x) => x.type))

before(async () => {
  db = await createDb()
  d.admin = await createDept(db, "Administration", "ADMIN")
  d.acad = await createDept(db, "Academics", "ACAD")
  d.qa = await createDept(db, "Quality", "QA")
  d.hr = await createDept(db, "HR", "HR")

  u.director = await createUser(db, { name: "Director", deptId: d.admin })
  await setHead(d.admin, u.director)
  await grantSystemRole(db, u.director, "super_admin")

  u.hod = await createUser(db, { name: "Hod", deptId: d.acad })
  await setHead(d.acad, u.hod)
  await db.query("update public.profiles set reports_to_id = $1 where id = $2", [u.director, u.hod])
  u.senior = await createUser(db, { name: "Senior", deptId: d.acad, reportsTo: u.hod })
  u.junior = await createUser(db, { name: "Junior", deptId: d.acad, reportsTo: u.senior })
  u.peer = await createUser(db, { name: "Peer", deptId: d.acad, reportsTo: u.hod })

  u.qaHead = await createUser(db, { name: "Qa Head", deptId: d.qa })
  await setHead(d.qa, u.qaHead)
  u.hrHead = await createUser(db, { name: "Hr Head", deptId: d.hr })
  await setHead(d.hr, u.hrHead)
  u.hrStaff = await createUser(db, { name: "Hr Staff", deptId: d.hr, reportsTo: u.hrHead })

  const roots = await db.query("select department_id, id from public.folders where level = 'root'")
  for (const r of roots.rows) f[`root_${r.department_id}`] = r.id
  f.acadRoot = f[`root_${d.acad}`]
  f.questionPapers = (
    await asUser(db, u.hod, (t) =>
      one(
        t,
        `insert into public.folders (parent_id, department_id, level, name, reference_id)
         values ($1, $2, 'child', 'Question Papers', 'ACD-QP') returning id`,
        [f.acadRoot, d.acad]
      )
    )
  ).id
  qpType = (await one(db, "select id from public.document_types where code = 'QP'")).id
})

describe("full review workflow", () => {
  test("requirement → upload → reject → re-upload → two approvals", async () => {
    await db.transaction(async (tx) => {
      // 1. HOD creates the requirement: uploader Junior, reviewers Senior then the QA head.
      const doc = await asUser(tx, u.hod, (t) => createDocument(t))
      assert.equal(await status(tx, doc), "pending_upload")
      assert.deepEqual(await notificationsOf(tx, u.junior), ["upload_requested"])

      // Only the assigned uploader may upload.
      await tx.query("savepoint s")
      await expectError(recordVersion(tx, doc, u.peer), /Only the assigned uploader/)
      await tx.query("rollback to savepoint s")

      // 2. Junior uploads v1 → review round 1, Senior is active.
      await recordVersion(tx, doc, u.junior, 1)
      assert.equal(await status(tx, doc), "in_review")
      let step = await activeStep(tx, doc)
      assert.equal(step.reviewer_id, u.senior)
      assert.equal(step.round, 1)
      assert.deepEqual(await notificationsOf(tx, u.senior), ["review_requested"])

      // No new version while a review is running; only the active reviewer may decide.
      await tx.query("savepoint s")
      await expectError(recordVersion(tx, doc, u.junior, 2), /review is in progress/)
      await tx.query("rollback to savepoint s")
      await tx.query("savepoint s")
      await expectError(
        asUser(tx, u.qaHead, (t) => t.query("select public.decide_review($1, true, null)", [step.id])),
        /not assigned to you/
      )
      await tx.query("rollback to savepoint s")

      // 3. Senior requests changes — a comment is required.
      await tx.query("savepoint s")
      await expectError(
        asUser(tx, u.senior, (t) => t.query("select public.decide_review($1, false, '  ')", [step.id])),
        /Explain what needs to change/
      )
      await tx.query("rollback to savepoint s")
      await asUser(tx, u.senior, (t) => t.query("select public.decide_review($1, false, 'Add marks per question')", [step.id]))
      assert.equal(await status(tx, doc), "changes_requested")
      const skipped = await one(tx, "select state from public.document_review_steps where document_id = $1 and step_order = 2 and round = 1", [doc])
      assert.equal(skipped.state, "skipped")
      assert.deepEqual(await notificationsOf(tx, u.junior), ["changes_requested", "upload_requested"])

      // 4. Junior uploads v2 → round 2 restarts at step 1.
      await recordVersion(tx, doc, u.junior, 2)
      step = await activeStep(tx, doc)
      assert.deepEqual([step.reviewer_id, step.round], [u.senior, 2])

      // 5. Senior approves → QA head active → QA head approves → approved.
      await asUser(tx, u.senior, (t) => t.query("select public.decide_review($1, true, 'Looks good')", [step.id]))
      step = await activeStep(tx, doc)
      assert.equal(step.reviewer_id, u.qaHead)
      await asUser(tx, u.qaHead, (t) => t.query("select public.decide_review($1, true, null)", [step.id]))
      assert.equal(await status(tx, doc), "approved")

      // History: 2 versions, 4 review steps, current version = v2.
      const versions = await one(tx, "select count(*)::int as n, max(version_no) as latest from public.document_versions where document_id = $1", [doc])
      assert.deepEqual(versions, { n: 2, latest: 2 })
      const current = await one(
        tx,
        "select v.version_no from public.documents d join public.document_versions v on v.id = d.current_version_id where d.id = $1",
        [doc]
      )
      assert.equal(current.version_no, 2)
      const steps = await one(tx, "select count(*)::int as n from public.document_review_steps where document_id = $1", [doc])
      assert.equal(steps.n, 4)
      assert.ok((await notificationsOf(tx, u.junior)).includes("document_approved"))

      // The audit trail records the uploader as actor of each version, even though the server wrote it.
      const actors = await tx.query(
        "select actor_id from public.audit_logs where entity_type = 'document_version' and entity_id = $1",
        [doc]
      )
      assert.deepEqual(actors.rows.map((r) => r.actor_id), [u.junior, u.junior])
      await tx.rollback()
    })
  })

  test("without review, an upload is approved straight away", async () => {
    await db.transaction(async (tx) => {
      const doc = await asUser(tx, u.hod, (t) => createDocument(t, { review: false, reviewers: [] }))
      await recordVersion(tx, doc, u.junior)
      assert.equal(await status(tx, doc), "approved")
      assert.deepEqual(await notificationsOf(tx, u.hod), ["document_uploaded"])
      await tx.rollback()
    })
  })
})

describe("visibility", () => {
  test("follows the hierarchy, department and involvement", async () => {
    await db.transaction(async (tx) => {
      const doc = await asUser(tx, u.hod, (t) => createDocument(t))
      const expected = {
        junior: true, // uploader
        senior: true, // reviewer and above the uploader
        hod: true, // own department (owner)
        director: true, // admin, and above the HOD
        qaHead: true, // reviewer from another department
        peer: false, // same department, not above the uploader
        hrHead: false,
        hrStaff: false,
      }
      for (const [who, visible] of Object.entries(expected)) {
        assert.equal(await canSee(tx, u[who], doc), visible, `${who} should ${visible ? "" : "not "}see the document`)
      }
      await tx.rollback()
    })
  })

  test("the document's audit trail is visible to those who can see it", async () => {
    await db.transaction(async (tx) => {
      const doc = await asUser(tx, u.hod, (t) => createDocument(t))
      const trail = (viewer) =>
        asUser(tx, viewer, (t) => t.query("select id from public.audit_logs where entity_id = $1", [doc])).then((r) => r.rows.length)
      assert.ok((await trail(u.senior)) > 0)
      assert.equal(await trail(u.peer), 0)
      await tx.rollback()
    })
  })

  test("views and downloads are logged, but only for people who can see the document", async () => {
    await db.transaction(async (tx) => {
      const doc = await asUser(tx, u.hod, (t) => createDocument(t))
      const version = await recordVersion(tx, doc, u.junior)
      await asUser(tx, u.senior, (t) => t.query("select public.log_document_access($1, 'download', $2)", [doc, version]))
      const row = await one(tx, "select actor_id, meta->>'version_no' as v from public.audit_logs where action = 'download'")
      assert.deepEqual(row, { actor_id: u.senior, v: "1" })
      await tx.query("savepoint s")
      await expectError(
        asUser(tx, u.peer, (t) => t.query("select public.log_document_access($1, 'view', $2)", [doc, version])),
        /Document not found/
      )
      await tx.query("rollback to savepoint s")
      await tx.rollback()
    })
  })
})

describe("creating and editing requirements", () => {
  test("only HODs (own department) and admins can create", async () => {
    await expectError(asUser(db, u.junior, (t) => createDocument(t)), /permission to create documents/)
    await expectError(asUser(db, u.hrHead, (t) => createDocument(t)), /Folder not found|permission to create documents/)
    await db.transaction(async (tx) => {
      assert.ok(await asUser(tx, u.director, (t) => createDocument(t)))
      await tx.rollback()
    })
  })

  test("standalone documents need a unique Ref ID", async () => {
    await expectError(asUser(db, u.hod, (t) => createDocument(t, { folderId: f.acadRoot })), /need a Reference ID/)
    await expectError(asUser(db, u.hod, (t) => createDocument(t, { folderId: f.acadRoot, ref: "acd-qp" })), /already in use/)
    await db.transaction(async (tx) => {
      const doc = await asUser(tx, u.hod, (t) => createDocument(t, { folderId: f.acadRoot, ref: "ACD-SYL-2026" }))
      const reg = await one(tx, "select entity_type from public.reference_ids where ref_id = 'ACD-SYL-2026'")
      assert.equal(reg.entity_type, "document")
      assert.ok(doc)
      await tx.rollback()
    })
  })

  test("documents inside folders may carry an optional Ref ID", async () => {
    await db.transaction(async (tx) => {
      const withRef = await asUser(tx, u.hod, (t) => createDocument(t, { ref: "QP-NAV-01" }))
      const without = await asUser(tx, u.hod, (t) => createDocument(t, { ref: null }))
      const { rows } = await tx.query("select id, reference_id from public.documents where id in ($1, $2)", [withRef, without])
      assert.deepEqual(Object.fromEntries(rows.map((r) => [r.id, r.reference_id])), { [withRef]: "QP-NAV-01", [without]: null })
      await tx.rollback()
    })
  })

  test("reviewer rules: required when review is on, unique, and not the uploader", async () => {
    await expectError(asUser(db, u.hod, (t) => createDocument(t, { reviewers: [] })), /at least one reviewer/)
    await expectError(asUser(db, u.hod, (t) => createDocument(t, { reviewers: [u.senior, u.senior] })), /only once/)
    await expectError(asUser(db, u.hod, (t) => createDocument(t, { reviewers: [u.junior] })), /uploader cannot also review/)
  })

  test("uploader and reviewers are locked while a review is running", async () => {
    await db.transaction(async (tx) => {
      const doc = await asUser(tx, u.hod, (t) => createDocument(t))
      await recordVersion(tx, doc, u.junior)
      await tx.query("savepoint s")
      await expectError(
        asUser(tx, u.hod, (t) =>
          t.query("select public.update_document($1, 'Renamed', $2, null, null, $3, true, $4, null)", [doc, qpType, u.junior, [u.qaHead]])
        ),
        /cannot be changed while a review is in progress/
      )
      await tx.query("rollback to savepoint s")
      // Renaming is fine.
      await asUser(tx, u.hod, (t) =>
        t.query("select public.update_document($1, 'Renamed', $2, null, null, $3, true, $4, null)", [doc, qpType, u.junior, [u.senior, u.qaHead]])
      )
      const { name } = await one(tx, "select name from public.documents where id = $1", [doc])
      assert.equal(name, "Renamed")
      await tx.rollback()
    })
  })

  test("a folder that holds documents cannot be deleted", async () => {
    await db.transaction(async (tx) => {
      await asUser(tx, u.hod, (t) => createDocument(t))
      await tx.query("savepoint s")
      await expectError(
        asUser(tx, u.hod, (t) => t.query("delete from public.folders where id = $1", [f.questionPapers])),
        /contains documents/
      )
      await tx.query("rollback to savepoint s")
      await tx.rollback()
    })
  })
})

describe("tasks and notifications", () => {
  test("my_task_counts and marking notifications read", async () => {
    await db.transaction(async (tx) => {
      const doc = await asUser(tx, u.hod, (t) => createDocument(t))
      await recordVersion(tx, doc, u.junior)
      const counts = await asUser(tx, u.senior, (t) => one(t, "select public.my_task_counts() as c")).then((r) => r.c)
      assert.equal(counts.to_review, 1)
      assert.equal(counts.unread_notifications, 1)

      await asUser(tx, u.senior, (t) => t.query("select public.mark_notifications_read()"))
      const after = await asUser(tx, u.senior, (t) => one(t, "select public.my_task_counts() as c")).then((r) => r.c)
      assert.equal(after.unread_notifications, 0)

      // Users only ever see their own notifications.
      const { rows } = await asUser(tx, u.peer, (t) => t.query("select id from public.notifications"))
      assert.equal(rows.length, 0)
      await tx.rollback()
    })
  })
})

describe("paged document lists", () => {
  const ids = (tx, viewer, sql) => asUser(tx, viewer, (t) => t.query(sql)).then((r) => r.rows.map((x) => x.id))

  test("my_documents(): uploader, reviewers and creator; nobody else", async () => {
    await db.transaction(async (tx) => {
      const doc = await asUser(tx, u.hod, (t) => createDocument(t))
      for (const who of ["junior", "senior", "qaHead", "hod"]) {
        assert.ok((await ids(tx, u[who], "select id from public.my_documents()")).includes(doc), `${who} should list it`)
      }
      assert.deepEqual(await ids(tx, u.peer, "select id from public.my_documents()"), [])
      await tx.rollback()
    })
  })

  test("shared_documents(): only documents of other departments", async () => {
    await db.transaction(async (tx) => {
      const doc = await asUser(tx, u.hod, (t) => createDocument(t))
      assert.deepEqual(await ids(tx, u.qaHead, "select id from public.shared_documents()"), [doc])
      assert.deepEqual(await ids(tx, u.senior, "select id from public.shared_documents()"), [])
      await tx.rollback()
    })
  })

  test("storage_used() sums only the versions the caller may see", async () => {
    await db.transaction(async (tx) => {
      const doc = await asUser(tx, u.hod, (t) => createDocument(t))
      await recordVersion(tx, doc, u.junior)
      const used = (viewer) => asUser(tx, viewer, (t) => one(t, "select public.storage_used() as n")).then((r) => Number(r.n))
      assert.equal(await used(u.director), 1024)
      assert.equal(await used(u.peer), 0)
      await tx.rollback()
    })
  })
})
