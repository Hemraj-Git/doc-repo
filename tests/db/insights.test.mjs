import { before, describe, test } from "node:test"
import assert from "node:assert/strict"
import { asUser, createDb, createDept, createUser, grantSystemRole, one } from "./harness.mjs"

/*
 *   ADMIN: admin (head, Super Admin)
 *   ACAD:  hod (head) ── staff
 *   HR:    hrHead (head)
 * Two Academics documents (one approved), one HR document.
 */
let db
const u = {}
const d = {}
const docs = {}

const setHead = (deptId, userId) => db.query("update public.departments set head_user_id = $1 where id = $2", [userId, deptId])

async function makeDoc(creator, folderId, uploader, name, typeCode) {
  const type = await one(db, "select id from public.document_types where code = $1", [typeCode])
  return asUser(db, creator, (t) =>
    one(t, "select public.create_document($1, $2, $3, null, null, $4, false, '{}', null) as id", [folderId, name, type.id, uploader])
  ).then((r) => r.id)
}

before(async () => {
  db = await createDb()
  d.admin = await createDept(db, "Administration", "ADMIN")
  d.acad = await createDept(db, "Academics", "ACAD")
  d.hr = await createDept(db, "HR", "HR")
  u.admin = await createUser(db, { name: "Admin", deptId: d.admin })
  await setHead(d.admin, u.admin)
  await grantSystemRole(db, u.admin, "super_admin")
  u.hod = await createUser(db, { name: "Hod", deptId: d.acad })
  await setHead(d.acad, u.hod)
  u.staff = await createUser(db, { name: "Staff", deptId: d.acad, reportsTo: u.hod })
  u.hrHead = await createUser(db, { name: "Hr Head", deptId: d.hr })
  await setHead(d.hr, u.hrHead)

  const folder = async (deptId, name, ref, by) => {
    const root = await one(db, "select id from public.folders where department_id = $1 and level = 'root'", [deptId])
    return asUser(db, by, (t) =>
      one(t, "insert into public.folders (parent_id, department_id, level, name, reference_id) values ($1, $2, 'child', $3, $4) returning id", [
        root.id,
        deptId,
        name,
        ref,
      ])
    ).then((r) => r.id)
  }
  const acadFolder = await folder(d.acad, "Syllabus", "ACD-SYL", u.hod)
  const hrFolder = await folder(d.hr, "Policies", "HR-POL", u.hrHead)

  docs.a1 = await makeDoc(u.hod, acadFolder, u.staff, "Syllabus 1", "DOC")
  docs.a2 = await makeDoc(u.hod, acadFolder, u.staff, "Question paper", "QP")
  docs.h1 = await makeDoc(u.hrHead, hrFolder, u.hrHead, "Leave policy", "DOC")

  // Staff uploads a1 (no review → approved straight away).
  await db.query(
    `select public.record_document_version($1::uuid, $2::uuid, $3::text || '/' || $2::text || '/f.pdf', 'f.pdf', 'pdf', 'application/pdf', 10, $4, null)`,
    [u.staff, docs.a1, d.acad, "a".repeat(64)]
  )
})

describe("aggregates respect visibility", () => {
  test("admin sees every department; the HOD only their own", async () => {
    const adminRows = await asUser(db, u.admin, (t) => t.query("select code, total::int, approved::int from public.document_counts_by_department()"))
    assert.deepEqual(
      adminRows.rows.sort((a, b) => a.code.localeCompare(b.code)),
      [
        { code: "ACAD", total: 2, approved: 1 },
        { code: "HR", total: 1, approved: 0 },
      ]
    )
    const hodRows = await asUser(db, u.hod, (t) => t.query("select code from public.document_counts_by_department()"))
    assert.deepEqual(hodRows.rows.map((r) => r.code), ["ACAD"])
  })

  test("counts by type, overall and per department", async () => {
    const all = await asUser(db, u.admin, (t) => t.query("select code, total::int from public.document_counts_by_type()"))
    assert.deepEqual(Object.fromEntries(all.rows.map((r) => [r.code, r.total])), { DOC: 2, QP: 1 })
    const hr = await asUser(db, u.admin, (t) => t.query("select code, total::int from public.document_counts_by_type($1)", [d.hr]))
    assert.deepEqual(hr.rows, [{ code: "DOC", total: 1 }])
  })

  test("department summary", async () => {
    const { s } = await asUser(db, u.hod, (t) => one(t, "select public.department_document_summary($1) as s", [d.acad]))
    assert.deepEqual(s, { total: 2, pending_upload: 1, changes_requested: 0, in_review: 0, approved: 1, approved_this_month: 1 })
  })

  test("activity series covers every day with uploads and approvals", async () => {
    const { rows } = await asUser(db, u.admin, (t) => t.query("select day, uploads::int, approvals::int from public.activity_series(7)"))
    assert.equal(rows.length, 7)
    const totals = rows.reduce((s, r) => ({ uploads: s.uploads + r.uploads, approvals: s.approvals + r.approvals }), { uploads: 0, approvals: 0 })
    assert.deepEqual(totals, { uploads: 1, approvals: 1 })
  })

  test("recently accessed lists only my own views, newest first", async () => {
    await asUser(db, u.hod, (t) => t.query("select public.log_document_access($1, 'view', null)", [docs.a2]))
    await asUser(db, u.staff, (t) => t.query("select public.log_document_access($1, 'view', null)", [docs.a1]))
    const { rows } = await asUser(db, u.hod, (t) => t.query("select document_id from public.my_recent_documents(5)"))
    assert.deepEqual(rows.map((r) => r.document_id), [docs.a2])
  })
})
