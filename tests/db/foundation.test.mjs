import { before, describe, test } from "node:test"
import assert from "node:assert/strict"
import { asUser, createDb, createDept, createUser, expectError, grantSystemRole, one } from "./harness.mjs"

/*
 * Org used by these tests
 *
 *   ADMIN dept:  admin (Super Admin)
 *   ACAD dept:   hod ─┬─ senior ── junior
 *                     └─ peer
 *   HR dept:     hrUser
 */
let db
const u = {}
const d = {}

before(async () => {
  db = await createDb()
  d.admin = await createDept(db, "Administration", "ADMIN")
  d.acad = await createDept(db, "Academics", "ACAD")
  d.hr = await createDept(db, "Human Resources", "HR")

  u.admin = await createUser(db, { name: "Admin", deptId: d.admin })
  await grantSystemRole(db, u.admin, "super_admin")

  u.hod = await createUser(db, { name: "Hod", deptId: d.acad })
  u.senior = await createUser(db, { name: "Senior", deptId: d.acad, reportsTo: u.hod })
  u.junior = await createUser(db, { name: "Junior", deptId: d.acad, reportsTo: u.senior })
  u.peer = await createUser(db, { name: "Peer", deptId: d.acad, reportsTo: u.hod })
  u.hrUser = await createUser(db, { name: "Hr User", deptId: d.hr })

  await db.query("update public.departments set head_user_id = $1 where id = $2", [u.hod, d.acad])
})

const label = (id) => id.replaceAll("-", "_")

describe("reporting hierarchy", () => {
  test("path is built from the reporting chain", async () => {
    const { path } = await one(db, "select path::text from public.profiles where id = $1", [u.junior])
    assert.equal(path, [u.hod, u.senior, u.junior].map(label).join("."))
  })

  test("seniors see only people below them", async () => {
    const check = (viewer, target) =>
      asUser(db, viewer, (tx) => one(tx, "select public.is_below_me($1) as ok", [target])).then((r) => r.ok)

    assert.equal(await check(u.hod, u.junior), true)
    assert.equal(await check(u.senior, u.junior), true)
    assert.equal(await check(u.senior, u.peer), false, "peer is not below senior")
    assert.equal(await check(u.senior, u.hod), false, "manager is not below senior")
    assert.equal(await check(u.junior, u.senior), false)
    assert.equal(await check(u.senior, u.senior), false, "a user is not below themselves")
  })

  test("manager must be in the same department", async () => {
    await expectError(
      db.query("update public.profiles set reports_to_id = $1 where id = $2", [u.hod, u.hrUser]),
      /same department/
    )
  })

  test("circular reporting lines are rejected", async () => {
    await expectError(
      db.query("update public.profiles set reports_to_id = $1 where id = $2", [u.junior, u.hod]),
      /Circular reporting line/
    )
  })

  test("moving a manager moves their whole sub-tree", async () => {
    await db.transaction(async (tx) => {
      await tx.query("update public.profiles set reports_to_id = $1 where id = $2", [u.peer, u.senior])
      const { path } = await one(tx, "select path::text from public.profiles where id = $1", [u.junior])
      assert.equal(path, [u.hod, u.peer, u.senior, u.junior].map(label).join("."))
      await tx.rollback()
    })
  })

  test("cannot move a user with direct reports to another department", async () => {
    await expectError(
      db.query("update public.profiles set department_id = $1, reports_to_id = null where id = $2", [d.hr, u.senior]),
      /direct reports/
    )
  })
})

describe("RBAC", () => {
  test("every user gets the Employee role", async () => {
    const { n } = await one(
      db,
      `select count(*)::int as n from public.user_roles ur join public.roles r on r.id = ur.role_id
       where r.system_key = 'employee'`
    )
    assert.equal(n, 6)
  })

  test("setting a department head grants the Department Head role automatically", async () => {
    const ctx = await asUser(db, u.hod, (tx) => one(tx, "select public.my_context() as c")).then((r) => r.c)
    assert.equal(ctx.is_hod, true)
    assert.ok(ctx.roles.some((r) => r.system_key === "department_head"))
    assert.ok(ctx.permissions.includes("folder.create.own_dept"))
    assert.ok(!ctx.permissions.includes("folder.create.any_dept"))
  })

  test("changing the head moves the role", async () => {
    await db.transaction(async (tx) => {
      await tx.query("update public.departments set head_user_id = $1 where id = $2", [u.senior, d.acad])
      const { keys } = await one(
        tx,
        `select array_agg(ur.user_id::text) as keys from public.user_roles ur
         join public.roles r on r.id = ur.role_id where r.system_key = 'department_head'`
      )
      assert.deepEqual(keys, [u.senior])
      await tx.rollback()
    })
  })

  test("head must belong to the department", async () => {
    await expectError(
      db.query("update public.departments set head_user_id = $1 where id = $2", [u.hrUser, d.acad]),
      /active member of this department/
    )
  })

  test("Department Head role cannot be assigned by hand", async () => {
    await expectError(grantSystemRole(db, u.peer, "department_head"), /assigned by setting a department/)
  })

  test("Super Admin holds every permission, including ones added later", async () => {
    await db.transaction(async (tx) => {
      await tx.query("insert into public.permissions (key, description, category) values ('test.perm', 't', 'T')")
      const { ok } = await asUser(tx, u.admin, (t) => one(t, "select public.has_perm('test.perm') as ok"))
      assert.equal(ok, true)
      await tx.rollback()
    })
  })

  test("the last Super Admin cannot be removed or deactivated", async () => {
    await expectError(
      db.query(
        `delete from public.user_roles where user_id = $1
         and role_id = (select id from public.roles where system_key = 'super_admin')`,
        [u.admin]
      ),
      /last active Super Admin/
    )
    await expectError(
      db.query("update public.profiles set is_active = false where id = $1", [u.admin]),
      /last active Super Admin/
    )
  })

  test("deleting a profile (bootstrap rollback) cascades its roles", async () => {
    await db.transaction(async (tx) => {
      await tx.query("delete from public.profiles where id = $1", [u.admin])
      const { n } = await one(tx, "select count(*)::int as n from public.user_roles where user_id = $1", [u.admin])
      assert.equal(n, 0)
      await tx.rollback()
    })
  })

  test("a department head cannot be deactivated", async () => {
    await expectError(
      db.query("update public.profiles set is_active = false where id = $1", [u.hod]),
      /department head/
    )
  })

  test("system roles cannot be deleted", async () => {
    await expectError(db.query("delete from public.roles where system_key = 'employee'"), /System roles/)
  })
})

describe("row level security", () => {
  test("only department.manage can create departments", async () => {
    await expectError(
      asUser(db, u.junior, (tx) => tx.query("insert into public.departments (name, code) values ('X', 'XX')")),
      /row-level security/
    )
    await db.transaction(async (tx) => {
      const row = await asUser(tx, u.admin, (t) =>
        one(t, "insert into public.departments (name, code) values ('Engineering', 'ENG') returning id, created_by")
      )
      assert.equal(row.created_by, u.admin)
      await tx.rollback()
    })
  })

  test("only user.manage can edit profiles", async () => {
    const { rows } = await asUser(db, u.hod, (tx) =>
      tx.query("update public.profiles set designation = 'x' where id = $1 returning id", [u.junior])
    )
    assert.equal(rows.length, 0, "HOD update is filtered out by RLS")
  })

  test("users can clear their own first-login flag", async () => {
    await db.transaction(async (tx) => {
      await asUser(tx, u.junior, (t) => t.query("select public.mark_password_changed()"))
      const { must_change_password } = await one(tx, "select must_change_password from public.profiles where id = $1", [u.junior])
      assert.equal(must_change_password, false)
      await tx.rollback()
    })
  })
})

describe("audit log", () => {
  test("data changes are recorded with the actor", async () => {
    await db.transaction(async (tx) => {
      await asUser(tx, u.admin, (t) =>
        t.query("update public.departments set description = 'Teaching' where id = $1", [d.acad])
      )
      const row = await one(
        tx,
        `select actor_id, action, department_id, before->>'description' as b, after->>'description' as a
         from public.audit_logs where entity_type = 'department' and entity_id = $1
         order by id desc limit 1`,
        [d.acad]
      )
      assert.deepEqual(row, { actor_id: u.admin, action: "update", department_id: d.acad, b: null, a: "Teaching" })
      await tx.rollback()
    })
  })

  test("entries cannot be modified or deleted, even by the owner", async () => {
    await expectError(db.query("update public.audit_logs set action = 'x'"), /cannot be modified/)
    await expectError(db.query("delete from public.audit_logs"), /cannot be modified/)
  })

  test("users only see their own entries unless granted audit.view", async () => {
    await asUser(db, u.junior, (tx) => tx.query("select public.log_auth_event('login')"))
    const visible = await asUser(db, u.junior, (tx) =>
      tx.query("select distinct actor_id from public.audit_logs").then((r) => r.rows.map((x) => x.actor_id))
    )
    assert.deepEqual(visible, [u.junior])

    const hodSees = await asUser(db, u.hod, (tx) =>
      one(tx, "select count(*)::int as n from public.audit_logs where department_id = $1", [d.hr])
    )
    assert.equal(hodSees.n, 0, "HOD cannot see another department's audit trail")
  })

  test("auth events are whitelisted", async () => {
    await expectError(
      asUser(db, u.junior, (tx) => tx.query("select public.log_auth_event('document.approved')")),
      /Unsupported auth event/
    )
  })
})
