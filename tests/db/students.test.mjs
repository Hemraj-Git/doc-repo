import { before, describe, test } from "node:test"
import assert from "node:assert/strict"
import { asUser, createDb, createDept, createUser, expectError, expectErrorInTx, grantSystemRole, one } from "./harness.mjs"

/*
 *   ACAD: hod (head; student.view.own_dept by default) ─ clerk (Student Welfare: student.manage.own_dept)
 *   HR:   hrHead (head)
 *   ADMIN: exam (Exam Cell: certificate.manage.any_dept + student.view.all), admin (Super Admin)
 */
let db
const u = {}
const d = {}
let marksheet, finalCert

async function customRole(name, perms) {
  const role = await one(db, "insert into public.roles (name) values ($1) returning id", [name])
  for (const p of perms) await db.query("insert into public.role_permissions (role_id, permission_key) values ($1, $2)", [role.id, p])
  return role.id
}
const giveRole = (user, role) => db.query("insert into public.user_roles (user_id, role_id) values ($1, $2)", [user, role])
const setHead = (deptId, userId) => db.query("update public.departments set head_user_id = $1 where id = $2", [userId, deptId])

const student = (overrides = {}) => ({
  regd_no: "SOM/2026/001",
  full_name: "R. Kumar",
  department_id: d.acad,
  course_name: "Diploma In Nautical Science",
  batch: "2026–27",
  ...overrides,
})

const addStudent = (tx, who, s) =>
  asUser(tx, who, (t) =>
    one(
      t,
      `insert into public.students (regd_no, full_name, department_id, course_name, batch, passport_no)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [s.regd_no, s.full_name, s.department_id, s.course_name, s.batch, s.passport_no ?? null]
    )
  ).then((r) => r.id)

// Server side (service role) after the file has been checked.
const issue = (tx, actor, studentId, no, type = finalCert, extra = {}) =>
  one(tx, "select department_id from public.students where id = $1", [studentId]).then(({ department_id }) =>
    one(
      tx,
      `select public.record_certificate($1, $2, $3, $4, $5::date, $6, $7, $8, null, $9, 'cert.pdf', 'pdf', 'application/pdf', 1000, 'abc') as id`,
      [actor, studentId, type, no, extra.issueDate ?? "2026-06-30", extra.academicYear ?? null, extra.semester ?? null, extra.result ?? "First Class", `${department_id}/${studentId}/${no}.pdf`]
    ).then((r) => r.id)
  )

const verify = (tx, fields = {}) =>
  one(
    tx,
    "select public.public_verify($1, $2, $3, 'Asha Rao', 'Acme BGV', 'asha@acme.test', 'employment', $4, 'test-agent', $5) as r",
    [fields.regd ?? "SOM/2026/001", fields.name ?? "R Kumar", fields.cert ?? null, fields.ip ?? "ip-1", fields.captcha ?? true]
  ).then((x) => x.r)

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
  u.clerk = await createUser(db, { name: "Clerk", deptId: d.acad, reportsTo: u.hod })
  u.hrHead = await createUser(db, { name: "Hr Head", deptId: d.hr })
  await setHead(d.hr, u.hrHead)
  u.exam = await createUser(db, { name: "Exam", deptId: d.admin, reportsTo: u.admin })
  await giveRole(u.clerk, await customRole("Student Welfare", ["student.manage.own_dept"]))
  await giveRole(u.exam, await customRole("Exam Cell", ["certificate.manage.any_dept", "student.view.all"]))
  marksheet = (await one(db, "select id from public.certificate_types where code = 'MARKSHEET'")).id
  finalCert = (await one(db, "select id from public.certificate_types where code = 'FINAL'")).id
})

describe("students", () => {
  test("Regd No. is unique ignoring spaces and case; names are normalised", async () => {
    await db.transaction(async (tx) => {
      const id = await addStudent(tx, u.clerk, student())
      const row = await one(tx, "select regd_no_normalized, name_normalized from public.students where id = $1", [id])
      assert.deepEqual(row, { regd_no_normalized: "SOM/2026/001", name_normalized: "r kumar" })
      await expectErrorInTx(tx, () => addStudent(tx, u.clerk, student({ regd_no: "som/2026/ 001", full_name: "Other" })), /students_regd_no_normalized_key/)
      await tx.rollback()
    })
  })

  test("department scoping: HODs see their own students; only managers add them", async () => {
    await db.transaction(async (tx) => {
      await addStudent(tx, u.clerk, student())
      await expectErrorInTx(tx, () => addStudent(tx, u.hod, student({ regd_no: "X1" })), /row-level security/)
      await expectErrorInTx(tx, () => addStudent(tx, u.clerk, student({ regd_no: "X2", department_id: d.hr })), /row-level security/)
      const seen = async (who) => (await asUser(tx, who, (t) => one(t, "select count(*)::int as n from public.students"))).n
      assert.equal(await seen(u.hod), 1)
      assert.equal(await seen(u.hrHead), 0)
      assert.equal(await seen(u.exam), 1, "student.view.all")
      await tx.rollback()
    })
  })

  test("import is all or nothing and names the failing row", async () => {
    await db.transaction(async (tx) => {
      const rows = [student({ regd_no: "A1" }), student({ regd_no: "A2", full_name: "" }), student({ regd_no: "A3" })]
      await expectErrorInTx(tx, () => asUser(tx, u.clerk, (t) => t.query("select public.import_students($1::jsonb)", [JSON.stringify(rows)])), /Row 2: Enter the student's full name/)
      assert.equal((await one(tx, "select count(*)::int as n from public.students")).n, 0)
      rows[1].full_name = "B. Das"
      const ok = await asUser(tx, u.clerk, (t) => one(t, "select public.import_students($1::jsonb) as n", [JSON.stringify(rows)]))
      assert.equal(ok.n, 3)
      await tx.rollback()
    })
  })
})

describe("certificates", () => {
  test("issuing needs certificate.manage for the student's department", async () => {
    await db.transaction(async (tx) => {
      const s = await addStudent(tx, u.clerk, student())
      await expectErrorInTx(tx, () => issue(tx, u.hod, s, "FC-1"), /permission to issue certificates/)
      const id = await issue(tx, u.exam, s, "FC-1")
      const c = await one(tx, "select status, current_file_id is not null as has_file, length(verify_token) as token from public.certificates where id = $1", [id])
      assert.deepEqual(c, { status: "issued", has_file: true, token: 64 })
      await expectErrorInTx(tx, () => issue(tx, u.exam, s, "fc- 1"), /certificates_certificate_no_normalized_key/)
      await expectErrorInTx(tx, () => issue(tx, u.exam, s, "MS-1", marksheet), /needs the academic year/)
      const hodSees = await asUser(tx, u.hod, (t) => one(t, "select count(*)::int as n from public.certificates"))
      assert.equal(hodSees.n, 1)
      await tx.rollback()
    })
  })

  test("replace keeps the earlier file; revoke and replace-by need a reason", async () => {
    await db.transaction(async (tx) => {
      const s = await addStudent(tx, u.clerk, student())
      const id = await issue(tx, u.exam, s, "FC-1")
      await one(
        tx,
        `select public.replace_certificate_file($1, $2, 'Corrected scan', $3, 'v2.pdf', 'pdf', 'application/pdf', 900, 'def') as id`,
        [u.exam, id, `${d.acad}/${s}/v2.pdf`]
      )
      const files = await one(tx, "select count(*)::int as n from public.certificate_files where certificate_id = $1", [id])
      assert.equal(files.n, 2)

      await expectErrorInTx(tx, () => asUser(tx, u.hod, (t) => t.query("select public.revoke_certificate($1, 'x')", [id])), /permission/)
      await expectErrorInTx(tx, () => asUser(tx, u.exam, (t) => t.query("select public.revoke_certificate($1, '  ')", [id])), /Give a reason/)
      const newer = await issue(tx, u.exam, s, "FC-2")
      await asUser(tx, u.exam, (t) => t.query("select public.revoke_certificate($1, 'Name corrected', 'FC-2')", [id]))
      const c = await one(tx, "select status, replaced_by_id from public.certificates where id = $1", [id])
      assert.deepEqual(c, { status: "replaced", replaced_by_id: newer })
      await tx.rollback()
    })
  })
})

describe("public verification", () => {
  test("matches Regd No. + name loosely, shows certificates, and never leaks which field was wrong", async () => {
    await db.transaction(async (tx) => {
      const s = await addStudent(tx, u.clerk, student({ passport_no: "P1234567" }))
      await issue(tx, u.exam, s, "FC-1")
      const ms = await issue(tx, u.exam, s, "MS-1", marksheet, { academicYear: "2025–26", semester: 2, result: "8.4 CGPA" })

      const hit = await verify(tx, { regd: " som/2026/001 ", name: "r kumar", cert: "ms-1" })
      assert.equal(hit.outcome, "matched")
      assert.match(hit.code, /^VRF-\d{4}-\d{6}$/)
      assert.equal(hit.snapshot.student.full_name, "R. Kumar")
      assert.equal(hit.snapshot.certificates.length, 2)
      assert.equal(hit.snapshot.certificate_found, true)
      assert.equal(hit.snapshot.certificates.find((c) => c.certificate_no === "MS-1").highlight, true)
      assert.equal(hit.snapshot.certificates.find((c) => c.certificate_no === "MS-1").result, "8.4 CGPA")
      assert.ok(!JSON.stringify(hit.snapshot).includes("P1234567"), "no passport number on the portal")

      const wrongName = await verify(tx, { name: "R. Kumaran" })
      const wrongRegd = await verify(tx, { regd: "SOM/2026/002" })
      assert.deepEqual([wrongName.outcome, wrongRegd.outcome], ["not_matched", "not_matched"])
      assert.equal(wrongName.snapshot, null)
      assert.equal(wrongName.slip_token, null)

      await asUser(tx, u.exam, (t) => t.query("select public.revoke_certificate($1, 'Issued in error')", [ms]))
      const after = await verify(tx, { cert: "MS-1" })
      assert.equal(after.snapshot.certificates.find((c) => c.certificate_no === "MS-1").status, "revoked")

      const { rows } = await tx.query("select outcome from public.verification_requests order by created_at")
      assert.equal(rows.length, 4, "every request is logged")
      await tx.rollback()
    })
  })

  test("captcha failures and rate limits are logged and refused", async () => {
    await db.transaction(async (tx) => {
      const s = await addStudent(tx, u.clerk, student())
      await issue(tx, u.exam, s, "FC-1")
      assert.equal((await verify(tx, { captcha: false })).outcome, "captcha_failed")
      for (let i = 0; i < 9; i++) await verify(tx, { ip: "ip-2" })
      assert.equal((await verify(tx, { ip: "ip-2" })).outcome, "matched", "the 10th in an hour is allowed")
      assert.equal((await verify(tx, { ip: "ip-2" })).outcome, "rate_limited")
      await tx.rollback()
    })
  })

  test("slips are re-read from the stored record and cannot be altered", async () => {
    await db.transaction(async (tx) => {
      const s = await addStudent(tx, u.clerk, student())
      await issue(tx, u.exam, s, "FC-1")
      const hit = await verify(tx)
      const slip = (await one(tx, "select public.public_slip($1) as s", [hit.slip_token])).s
      assert.equal(slip.code, hit.code)
      assert.equal(slip.requester_org, "Acme BGV")
      await expectErrorInTx(tx, () => tx.query("update public.verification_requests set requester_org = 'x'"), /cannot be changed/)
      assert.equal((await one(tx, "select public.public_slip('nope') as s")).s, null)
      await tx.rollback()
    })
  })

  test("a certificate's QR link shows that certificate", async () => {
    await db.transaction(async (tx) => {
      const s = await addStudent(tx, u.clerk, student())
      const id = await issue(tx, u.exam, s, "FC-1")
      const token = (await one(tx, "select verify_token from public.certificates where id = $1", [id])).verify_token
      const r = (await one(tx, "select public.public_certificate_by_token($1, 'ip-3', 'ua') as r", [token])).r
      assert.equal(r.outcome, "matched")
      assert.equal(r.snapshot.certificate.certificate_no, "FC-1")
      assert.equal(r.snapshot.student.regd_no, "SOM/2026/001")
      const miss = (await one(tx, "select public.public_certificate_by_token('x', 'ip-3', 'ua') as r")).r
      assert.equal(miss.outcome, "not_matched")
      await tx.rollback()
    })
  })

  test("the public functions cannot be called by signed-in or anonymous users", async () => {
    await expectError(asUser(db, u.admin, (t) => t.query("select public.public_verify('a','b',null,'c','d','e','f','g','h',true)")), /permission denied/)
    await expectError(asUser(db, u.admin, (t) => t.query("select public.public_slip('x')")), /permission denied/)
    await expectError(
      db.transaction(async (t) => {
        await t.exec("set local role anon")
        await t.query("select public.public_certificate_by_token('x','y','z')")
      }),
      /permission denied/
    )
  })

  test("the verification log is visible to log viewers and to the student's viewers", async () => {
    await db.transaction(async (tx) => {
      const s = await addStudent(tx, u.clerk, student())
      await issue(tx, u.exam, s, "FC-1")
      await verify(tx)
      await verify(tx, { name: "nobody" })
      const count = async (who) => (await asUser(tx, who, (t) => one(t, "select count(*)::int as n from public.verification_requests"))).n
      assert.equal(await count(u.admin), 2, "verification.view_log sees everything")
      assert.equal(await count(u.hod), 1, "HOD sees requests that matched their students")
      assert.equal(await count(u.hrHead), 0)
      await tx.rollback()
    })
  })
})
