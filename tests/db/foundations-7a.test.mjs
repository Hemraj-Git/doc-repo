import { before, describe, test } from "node:test"
import assert from "node:assert/strict"
import { asUser, createDb, createDept, createUser, expectError, expectErrorInTx, grantSystemRole, one } from "./harness.mjs"

/*
 *   ADMIN: admin (head, Super Admin)
 *   ACAD:  hod (head) ── lecturer
 */
let db
const u = {}
const d = {}
let root, qpType

const setHead = (deptId, userId) => db.query("update public.departments set head_user_id = $1 where id = $2", [userId, deptId])

const folder = (tx, parentId, name, { ref = null, allowSub = false } = {}) =>
  one(
    tx,
    `insert into public.folders (parent_id, department_id, level, name, reference_id, allow_subfolders)
     values ($1, (select department_id from public.folders where id = $1), 'sub', $2, $3, $4)
     returning id, level, depth, reference_id`,
    [parentId, name, ref, allowSub]
  )

const createDoc = (tx, folderId, ref = null) =>
  one(tx, "select public.create_document($1, 'Lesson Plan', $2, $3, null, $4, false, '{}', null) as id", [
    folderId,
    qpType,
    ref,
    u.lecturer,
  ]).then((r) => r.id)

before(async () => {
  db = await createDb()
  d.admin = await createDept(db, "Administration", "ADMIN")
  d.acad = await createDept(db, "Academics", "ACAD")
  u.admin = await createUser(db, { name: "Admin", deptId: d.admin })
  await setHead(d.admin, u.admin)
  await grantSystemRole(db, u.admin, "super_admin")
  u.hod = await createUser(db, { name: "Hod", deptId: d.acad })
  await setHead(d.acad, u.hod)
  u.lecturer = await createUser(db, { name: "Lecturer", deptId: d.acad, reportsTo: u.hod })
  root = (await one(db, "select id from public.folders where department_id = $1 and level = 'root'", [d.acad])).id
  qpType = (await one(db, "select id from public.document_types where code = 'QP'")).id
})

describe("deeper folders", () => {
  test("Program → Course → Subject: levels, depth and Ref IDs", async () => {
    await db.transaction(async (tx) => {
      const apg = await asUser(tx, u.hod, (t) => folder(t, root, "Academic Programme Guide", { ref: "SOMSQP-ADC-1-FL4", allowSub: true }))
      assert.deepEqual([apg.level, apg.depth, apg.reference_id], ["child", 1, "SOMSQP-ADC-1-FL4"])

      const program = await asUser(tx, u.hod, (t) => folder(t, apg.id, "DNS", { ref: "IGNORED", allowSub: true }))
      assert.deepEqual([program.level, program.depth, program.reference_id], ["sub", 2, "SOMSQP-ADC-1-FL4 (DNS)"])

      const course = await asUser(tx, u.hod, (t) => folder(t, program.id, "Course", { allowSub: true }))
      assert.deepEqual([course.depth, course.reference_id], [3, null], "deeper folders have no Ref ID by default")

      const subject = await asUser(tx, u.hod, (t) => folder(t, course.id, "Navigation", { ref: "DNS-NAV" }))
      assert.deepEqual([subject.depth, subject.reference_id], [4, "DNS-NAV"], "an optional Ref ID can be given")

      const { refs } = await one(tx, "select array_agg(ref_id order by ref_id) as refs from public.reference_ids")
      assert.deepEqual(refs, ["DNS-NAV", "SOMSQP-ADC-1-FL4", "SOMSQP-ADC-1-FL4 (DNS)"])

      const crumbs = await asUser(tx, u.lecturer, (t) => t.query("select name, depth from public.folder_ancestors($1)", [subject.id]))
      assert.deepEqual(crumbs.rows, [
        { name: "Academics", depth: 0 },
        { name: "Academic Programme Guide", depth: 1 },
        { name: "DNS", depth: 2 },
        { name: "Course", depth: 3 },
      ])
      await tx.rollback()
    })
  })

  test("optional Ref IDs are still unique and well-formed", async () => {
    await db.transaction(async (tx) => {
      const a = await asUser(tx, u.hod, (t) => folder(t, root, "A", { ref: "A-1", allowSub: true }))
      const b = await asUser(tx, u.hod, (t) => folder(t, a.id, "B", { allowSub: true }))
      await expectErrorInTx(tx, () => asUser(tx, u.hod, (t) => folder(t, b.id, "C", { ref: "a-1" })), /already in use/)
      await expectErrorInTx(tx, () => asUser(tx, u.hod, (t) => folder(t, b.id, "C", { ref: "bad ref" })), /may only contain/)
      await tx.rollback()
    })
  })

  test("nesting stops at 8 levels", async () => {
    await db.transaction(async (tx) => {
      let parent = (await asUser(tx, u.hod, (t) => folder(t, root, "L1", { ref: "L-1", allowSub: true }))).id
      for (let level = 2; level <= 8; level++) {
        parent = (await asUser(tx, u.hod, (t) => folder(t, parent, `L${level}`, { allowSub: true }))).id
      }
      await expectErrorInTx(tx, () => asUser(tx, u.hod, (t) => folder(t, parent, "L9")), /at most 8 levels/)
      await tx.rollback()
    })
  })
})

describe("document Ref IDs", () => {
  test("optional inside folders, unique when given; still required when standalone", async () => {
    await db.transaction(async (tx) => {
      const f = await asUser(tx, u.hod, (t) => folder(t, root, "Plans", { ref: "PLANS" }))
      const noRef = await asUser(tx, u.hod, (t) => createDoc(t, f.id))
      const withRef = await asUser(tx, u.hod, (t) => createDoc(t, f.id, "LP-2026-01"))
      const rows = await tx.query("select id, reference_id from public.documents where id in ($1, $2)", [noRef, withRef])
      assert.deepEqual(Object.fromEntries(rows.rows.map((r) => [r.id, r.reference_id])), { [noRef]: null, [withRef]: "LP-2026-01" })

      await expectErrorInTx(tx, () => asUser(tx, u.hod, (t) => createDoc(t, f.id, "plans")), /already in use/)
      await expectErrorInTx(tx, () => asUser(tx, u.hod, (t) => createDoc(t, root)), /need a Reference ID/)
      await tx.rollback()
    })
  })
})

describe("not applicable", () => {
  test("the uploader marks a period not applicable; uploads are blocked until a manager reopens it", async () => {
    await db.transaction(async (tx) => {
      const f = await asUser(tx, u.hod, (t) => folder(t, root, "Weekly", { ref: "WK" }))
      const doc = await asUser(tx, u.hod, (t) => createDoc(t, f.id))

      await expectErrorInTx(
        tx,
        () => asUser(tx, u.lecturer, (t) => t.query("select public.mark_not_applicable($1, ' ')", [doc])),
        /Give a reason/
      )
      await asUser(tx, u.lecturer, (t) => t.query("select public.mark_not_applicable($1, 'Holiday week')", [doc]))
      const marked = await one(tx, "select status, not_applicable_reason, not_applicable_by from public.documents where id = $1", [doc])
      assert.deepEqual(marked, { status: "not_applicable", not_applicable_reason: "Holiday week", not_applicable_by: u.lecturer })

      await expectErrorInTx(
        tx,
        () =>
          tx.query(
            `select public.record_document_version($1::uuid, $2::uuid, $3::text || '/' || $2::text || '/f.pdf', 'f.pdf', 'pdf', 'application/pdf', 10, $4, null)`,
            [u.lecturer, doc, d.acad, "a".repeat(64)]
          ),
        /Reopen it before uploading/
      )

      // Only managers can reopen.
      await expectErrorInTx(tx, () => asUser(tx, u.lecturer, (t) => t.query("select public.reopen_document($1)", [doc])), /cannot change/)
      await asUser(tx, u.hod, (t) => t.query("select public.reopen_document($1)", [doc]))
      const { status } = await one(tx, "select status from public.documents where id = $1", [doc])
      assert.equal(status, "pending_upload")
      await tx.rollback()
    })
  })
})

describe("institute settings", () => {
  test("readable by everyone, editable only with settings.manage", async () => {
    const s = await asUser(db, u.lecturer, (t) => one(t, "select academic_year_start_month from public.institute_settings"))
    assert.equal(s.academic_year_start_month, 7)
    const { rows } = await asUser(db, u.hod, (t) =>
      t.query("update public.institute_settings set academic_year_start_month = 8 returning id")
    )
    assert.equal(rows.length, 0, "HOD update is filtered out by RLS")
    await db.transaction(async (tx) => {
      const r = await asUser(tx, u.admin, (t) => t.query("update public.institute_settings set academic_year_start_month = 8 returning id"))
      assert.equal(r.rows.length, 1)
      await tx.rollback()
    })
    await expectError(db.query("insert into public.institute_settings (id) values (false)"), /check/)
  })
})
