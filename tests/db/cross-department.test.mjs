import { before, describe, test } from "node:test"
import assert from "node:assert/strict"
import { asUser, createDb, createDept, createUser, expectError, one } from "./harness.mjs"

/*
 *   ADMIN: director (head)
 *   ACAD:  hodAcad (head) ── lecturer
 *   HR:    hodHr (head),  hrStaff (reports to hodHr)
 */
let db
const u = {}
const d = {}
const label = (id) => id.replaceAll("-", "_")
const setHead = (deptId, userId) =>
  db.query("update public.departments set head_user_id = $1 where id = $2", [userId, deptId])

before(async () => {
  db = await createDb()
  d.admin = await createDept(db, "Administration", "ADMIN")
  d.acad = await createDept(db, "Academics", "ACAD")
  d.hr = await createDept(db, "HR", "HR")

  u.director = await createUser(db, { name: "Director", deptId: d.admin })
  await setHead(d.admin, u.director)

  u.hodAcad = await createUser(db, { name: "Hod Acad", deptId: d.acad })
  await setHead(d.acad, u.hodAcad)
  u.lecturer = await createUser(db, { name: "Lecturer", deptId: d.acad, reportsTo: u.hodAcad })

  u.hodHr = await createUser(db, { name: "Hod Hr", deptId: d.hr })
  await setHead(d.hr, u.hodHr)
  u.hrStaff = await createUser(db, { name: "Hr Staff", deptId: d.hr, reportsTo: u.hodHr })

  // HODs report to the Director across departments.
  await db.query("update public.profiles set reports_to_id = $1 where id in ($2, $3)", [u.director, u.hodAcad, u.hodHr])
})

describe("department heads reporting across departments", () => {
  test("the whole chain sits under the Director", async () => {
    const { path } = await one(db, "select path::text from public.profiles where id = $1", [u.lecturer])
    assert.equal(path, [u.director, u.hodAcad, u.lecturer].map(label).join("."))
  })

  test("the Director sees everyone below; HODs still see only their own tree", async () => {
    const below = (viewer, target) =>
      asUser(db, viewer, (tx) => one(tx, "select public.is_below_me($1) as ok", [target])).then((r) => r.ok)
    assert.equal(await below(u.director, u.lecturer), true)
    assert.equal(await below(u.director, u.hrStaff), true)
    assert.equal(await below(u.hodAcad, u.hrStaff), false)
    assert.equal(await below(u.hodAcad, u.director), false)
  })

  test("non-heads still cannot report across departments", async () => {
    await expectError(
      db.query("update public.profiles set reports_to_id = $1 where id = $2", [u.director, u.hrStaff]),
      /only department heads may report across departments/
    )
  })

  test("replacing a head removes the former head's cross-department manager", async () => {
    await db.transaction(async (tx) => {
      await tx.query("update public.departments set head_user_id = $1 where id = $2", [u.hrStaff, d.hr])
      const former = await one(tx, "select reports_to_id, path::text from public.profiles where id = $1", [u.hodHr])
      assert.equal(former.reports_to_id, null)
      assert.equal(former.path, label(u.hodHr))
      await tx.rollback()
    })
  })

  test("a seeded Director role grants institute-wide visibility", async () => {
    const { keys } = await one(
      db,
      `select array_agg(rp.permission_key order by rp.permission_key) as keys
       from public.roles r join public.role_permissions rp on rp.role_id = r.id where r.name = 'Director'`
    )
    assert.deepEqual(keys, ["audit.view.all", "document.download", "document.view.all"])
  })
})
