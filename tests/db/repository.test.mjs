import { before, describe, test } from "node:test"
import assert from "node:assert/strict"
import { asUser, createDb, createDept, createUser, expectError, expectErrorInTx, grantSystemRole, one } from "./harness.mjs"

/*
 *   ADMIN: director (head, Super Admin)
 *   ACAD:  hodAcad (head, reports to director) ── lecturer
 *   HR:    hodHr (head)
 */
let db
const u = {}
const d = {}
const root = {}

const setHead = (deptId, userId) =>
  db.query("update public.departments set head_user_id = $1 where id = $2", [userId, deptId])

const createFolder = (tx, { parentId, level, name, ref = null, allowSub = false }) =>
  one(
    tx,
    `insert into public.folders (parent_id, department_id, level, name, reference_id, allow_subfolders)
     values ($1, (select department_id from public.folders where id = $1), $2, $3, $4, $5)
     returning id, department_id, reference_id`,
    [parentId, level, name, ref, allowSub]
  )

before(async () => {
  db = await createDb()
  d.admin = await createDept(db, "Administration", "ADMIN")
  d.acad = await createDept(db, "Academics", "ACAD")
  d.hr = await createDept(db, "HR", "HR")

  u.director = await createUser(db, { name: "Director", deptId: d.admin })
  await setHead(d.admin, u.director)
  await grantSystemRole(db, u.director, "super_admin")
  u.hodAcad = await createUser(db, { name: "Hod Acad", deptId: d.acad })
  await setHead(d.acad, u.hodAcad)
  u.lecturer = await createUser(db, { name: "Lecturer", deptId: d.acad, reportsTo: u.hodAcad })
  u.hodHr = await createUser(db, { name: "Hod Hr", deptId: d.hr })
  await setHead(d.hr, u.hodHr)

  const { rows } = await db.query("select department_id, id from public.folders where level = 'root'")
  for (const r of rows) root[r.department_id] = r.id
})

describe("department root folders", () => {
  test("every department gets one automatically", () => {
    assert.ok(root[d.admin] && root[d.acad] && root[d.hr])
  })

  test("renaming a department renames its root folder", async () => {
    await db.transaction(async (tx) => {
      await tx.query("update public.departments set name = 'Academic Studies' where id = $1", [d.acad])
      const { name } = await one(tx, "select name from public.folders where id = $1", [root[d.acad]])
      assert.equal(name, "Academic Studies")
      await tx.rollback()
    })
  })

  test("root folders cannot be created or deleted by hand", async () => {
    await expectError(
      db.query("insert into public.folders (department_id, level, name) values ($1, 'root', 'X')", [d.hr]),
      /created automatically/
    )
    await expectError(db.query("delete from public.folders where id = $1", [root[d.hr]]), /cannot be deleted/)
  })
})

describe("child folders and sub-folders", () => {
  test("the HOD creates a child folder with a Ref ID, then a sub-folder whose Ref ID is derived", async () => {
    await db.transaction(async (tx) => {
      const guide = await asUser(tx, u.hodAcad, (t) =>
        createFolder(t, { parentId: root[d.acad], level: "child", name: "Academic Program Guide", ref: "SOMSQP-ADC-1-FL4", allowSub: true })
      )
      assert.equal(guide.department_id, d.acad)

      const program = await asUser(tx, u.hodAcad, (t) => createFolder(t, { parentId: guide.id, level: "sub", name: "X Program" }))
      assert.equal(program.reference_id, "SOMSQP-ADC-1-FL4 (X Program)")

      // Renaming the child's Ref ID carries through to its sub-folders and the register.
      await asUser(tx, u.hodAcad, (t) =>
        t.query("update public.folders set reference_id = 'SOMSQP-ADC-1-FL5' where id = $1", [guide.id])
      )
      const sub = await one(tx, "select reference_id from public.folders where id = $1", [program.id])
      assert.equal(sub.reference_id, "SOMSQP-ADC-1-FL5 (X Program)")
      const { refs } = await one(tx, "select array_agg(ref_id order by ref_id) as refs from public.reference_ids")
      assert.deepEqual(refs, ["SOMSQP-ADC-1-FL5", "SOMSQP-ADC-1-FL5 (X Program)"])
      await tx.rollback()
    })
  })

  test("Ref IDs are unique across the institute, ignoring case", async () => {
    await db.transaction(async (tx) => {
      await asUser(tx, u.hodAcad, (t) => createFolder(t, { parentId: root[d.acad], level: "child", name: "Policies", ref: "POL-001" }))
      await expectErrorInTx(
        tx,
        () =>
          asUser(tx, u.hodHr, (t) => createFolder(t, { parentId: root[d.hr], level: "child", name: "HR Policies", ref: "pol-001" })),
        /already in use/
      )
      await tx.rollback()
    })
  })

  test("reference_id_available reflects the register", async () => {
    await db.transaction(async (tx) => {
      await asUser(tx, u.hodAcad, (t) => createFolder(t, { parentId: root[d.acad], level: "child", name: "Syllabus", ref: "SYL-1" }))
      const check = (ref) =>
        asUser(tx, u.lecturer, (t) => one(t, "select public.reference_id_available($1) as ok", [ref])).then((r) => r.ok)
      assert.equal(await check(" syl-1 "), false)
      assert.equal(await check("SYL-2"), true)
      await tx.rollback()
    })
  })

  test("sub-folders only where the parent folder allows them", async () => {
    await db.transaction(async (tx) => {
      const plain = await asUser(tx, u.hodAcad, (t) =>
        createFolder(t, { parentId: root[d.acad], level: "child", name: "Circulars", ref: "CIR-1" })
      )
      await expectErrorInTx(
        tx,
        () =>
          asUser(tx, u.hodAcad, (t) => createFolder(t, { parentId: plain.id, level: "sub", name: "2026" })),
        /does not allow sub-folders/
      )
      const students = await asUser(tx, u.hodAcad, (t) =>
        createFolder(t, { parentId: root[d.acad], level: "child", name: "Student Records", ref: "STU-1", allowSub: true })
      )
      const ravi = await asUser(tx, u.hodAcad, (t) => createFolder(t, { parentId: students.id, level: "sub", name: "Ravi Kumar" }))
      await expectErrorInTx(
        tx,
        () =>
          asUser(tx, u.hodAcad, (t) => createFolder(t, { parentId: ravi.id, level: "sub", name: "Semester 1" })),
        /does not allow sub-folders/
      )
      await expectErrorInTx(
        tx,
        () =>
          asUser(tx, u.hodAcad, (t) =>
            t.query("update public.folders set allow_subfolders = false where id = $1", [students.id])
          ),
        /already has sub-folders/
      )
      await tx.rollback()
    })
  })

  test("a child folder needs a well-formed Ref ID", async () => {
    await expectError(
      asUser(db, u.hodAcad, (t) => createFolder(t, { parentId: root[d.acad], level: "child", name: "No Ref" })),
      /Reference ID is required/
    )
    await expectError(
      asUser(db, u.hodAcad, (t) => createFolder(t, { parentId: root[d.acad], level: "child", name: "Bad", ref: "has space" })),
      /may only contain/
    )
  })

  test("deleting a folder releases its Ref ID; a folder with sub-folders cannot be deleted", async () => {
    await db.transaction(async (tx) => {
      const f = await asUser(tx, u.hodAcad, (t) =>
        createFolder(t, { parentId: root[d.acad], level: "child", name: "Temp", ref: "TMP-1", allowSub: true })
      )
      await asUser(tx, u.hodAcad, (t) => createFolder(t, { parentId: f.id, level: "sub", name: "Inner" }))
      await expectErrorInTx(tx, () => asUser(tx, u.hodAcad, (t) => t.query("delete from public.folders where id = $1", [f.id])), /sub-folders/)
      await asUser(tx, u.hodAcad, (t) => t.query("delete from public.folders where parent_id = $1", [f.id]))
      await asUser(tx, u.hodAcad, (t) => t.query("delete from public.folders where id = $1", [f.id]))
      const { n } = await one(tx, "select count(*)::int as n from public.reference_ids")
      assert.equal(n, 0)
      await tx.rollback()
    })
  })
})

describe("folder permissions", () => {
  test("a HOD cannot create folders in another department", async () => {
    await expectError(
      asUser(db, u.hodHr, (t) => createFolder(t, { parentId: root[d.acad], level: "child", name: "Sneaky", ref: "SNK-1" })),
      /row-level security/
    )
  })

  test("staff cannot create folders", async () => {
    await expectError(
      asUser(db, u.lecturer, (t) => createFolder(t, { parentId: root[d.acad], level: "child", name: "Mine", ref: "MINE-1" })),
      /row-level security/
    )
  })

  test("the admin can create in any department", async () => {
    await db.transaction(async (tx) => {
      const f = await asUser(tx, u.director, (t) =>
        createFolder(t, { parentId: root[d.hr], level: "child", name: "Contracts", ref: "HR-CON" })
      )
      assert.equal(f.department_id, d.hr)
      await tx.rollback()
    })
  })

  test("who can browse which departments", async () => {
    const visible = (viewer) =>
      asUser(db, viewer, (t) =>
        t.query("select department_id from public.folders where level = 'root' order by department_id")
      ).then((r) => new Set(r.rows.map((x) => x.department_id)))

    assert.deepEqual(await visible(u.lecturer), new Set([d.acad]), "staff: own department")
    assert.deepEqual(await visible(u.hodHr), new Set([d.hr]), "HOD: own department")
    assert.deepEqual(await visible(u.director), new Set([d.admin, d.acad, d.hr]), "admin: all")
  })

  test("someone the department head reports to can browse that department", async () => {
    await db.transaction(async (tx) => {
      // A non-admin "Principal" in HR who the Academics head reports to.
      await tx.query("update public.profiles set reports_to_id = null where id = $1", [u.hodAcad])
      const principal = await createUser(tx, { name: "Principal", deptId: d.hr, reportsTo: u.hodHr })
      await tx.query("update public.departments set head_user_id = $1 where id = $2", [principal, d.hr])
      await tx.query("update public.profiles set reports_to_id = $1 where id = $2", [principal, u.hodAcad])
      const { rows } = await asUser(tx, principal, (t) =>
        t.query("select department_id from public.folders where level = 'root'")
      )
      assert.ok(rows.some((r) => r.department_id === d.acad))
      await tx.rollback()
    })
  })
})

describe("document types", () => {
  test("seeded, and only document_type.manage can change them", async () => {
    const { codes } = await one(db, "select array_agg(code order by sort_order) as codes from public.document_types")
    assert.deepEqual(codes, ["DOC", "FORM", "QP", "TEMPLATE", "CL", "QM"])
    await expectError(
      asUser(db, u.hodAcad, (t) => t.query("insert into public.document_types (code, name) values ('SOP', 'SOP')")),
      /row-level security/
    )
  })
})
