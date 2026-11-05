import { before, describe, test } from "node:test"
import assert from "node:assert/strict"
import { asUser, createDb, createDept, createUser, expectError, grantSystemRole, one } from "./harness.mjs"

let db
const u = {}
const d = {}
const roles = {}

before(async () => {
  db = await createDb()
  // Looked up once: querying `db` while a test holds a transaction on it would deadlock.
  const { rows } = await db.query("select system_key, id from public.roles where is_system")
  for (const r of rows) roles[r.system_key] = r.id

  d.admin = await createDept(db, "Administration", "ADMIN")
  d.acad = await createDept(db, "Academics", "ACAD")
  d.empty = await createDept(db, "Library", "LIB")

  u.admin = await createUser(db, { name: "Admin", deptId: d.admin })
  await grantSystemRole(db, u.admin, "super_admin")
  u.hod = await createUser(db, { name: "Hod", deptId: d.acad })
  u.staff = await createUser(db, { name: "Staff", deptId: d.acad, reportsTo: u.hod })
  await db.query("update public.departments set head_user_id = $1 where id = $2", [u.hod, d.acad])
})

describe("department membership", () => {
  test("a department with active members cannot be deactivated", async () => {
    await expectError(
      db.query("update public.departments set is_active = false where id = $1", [d.acad]),
      /still has 2 active user/
    )
  })

  test("an empty department can be deactivated, and then accepts no new users", async () => {
    await db.transaction(async (tx) => {
      await tx.query("update public.departments set is_active = false where id = $1", [d.empty])
      await expectError(createUser(tx, { name: "Late Joiner", deptId: d.empty }), /active department/)
      await tx.rollback()
    })
  })
})

describe("set_role_permissions", () => {
  test("replaces a custom role's permissions atomically", async () => {
    await db.transaction(async (tx) => {
      const role = await asUser(tx, u.admin, (t) =>
        one(t, "insert into public.roles (name) values ('Quality Auditor') returning id")
      )
      await asUser(tx, u.admin, (t) =>
        t.query("select public.set_role_permissions($1, $2)", [role.id, ["document.view.all", "audit.view.all"]])
      )
      await asUser(tx, u.admin, (t) =>
        t.query("select public.set_role_permissions($1, $2)", [role.id, ["document.view.all", "document.download"]])
      )
      const { keys } = await one(
        tx,
        "select array_agg(permission_key order by permission_key) as keys from public.role_permissions where role_id = $1",
        [role.id]
      )
      assert.deepEqual(keys, ["document.download", "document.view.all"])
      await tx.rollback()
    })
  })

  test("requires role.manage", async () => {
    const employee = roles.employee
    await expectError(
      asUser(db, u.hod, (t) => t.query("select public.set_role_permissions($1, $2)", [employee, []])),
      /permission to edit roles/
    )
  })

  test("cannot strip permissions from Super Admin", async () => {
    const superAdmin = roles.super_admin
    await expectError(
      asUser(db, u.admin, (t) => t.query("select public.set_role_permissions($1, $2)", [superAdmin, ["user.manage"]])),
      /cannot be removed from the Super Admin/
    )
  })
})

describe("set_user_roles", () => {
  test("assigns and removes roles but keeps Employee and Department Head", async () => {
    await db.transaction(async (tx) => {
      const viewer = roles.all_access_viewer
      await asUser(tx, u.admin, (t) => t.query("select public.set_user_roles($1, $2)", [u.hod, [viewer]]))
      await asUser(tx, u.admin, (t) => t.query("select public.set_user_roles($1, $2)", [u.hod, []]))
      const { keys } = await one(
        tx,
        `select array_agg(r.system_key order by r.system_key) as keys
         from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = $1`,
        [u.hod]
      )
      assert.deepEqual(keys, ["department_head", "employee"])
      await tx.rollback()
    })
  })

  test("ignores attempts to grant Department Head directly", async () => {
    await db.transaction(async (tx) => {
      const head = roles.department_head
      await asUser(tx, u.admin, (t) => t.query("select public.set_user_roles($1, $2)", [u.staff, [head]]))
      const { n } = await one(
        tx,
        "select count(*)::int as n from public.user_roles where user_id = $1 and role_id = $2",
        [u.staff, head]
      )
      assert.equal(n, 0)
      await tx.rollback()
    })
  })

  test("requires user.manage", async () => {
    await expectError(
      asUser(db, u.hod, (t) => t.query("select public.set_user_roles($1, $2)", [u.staff, []])),
      /permission to assign roles/
    )
  })
})

describe("no privilege escalation", () => {
  // A custom "User Manager" role that can manage users and roles, but nothing else.
  async function withUserManager(tx) {
    const role = await one(tx, "insert into public.roles (name) values ('User Manager') returning id")
    await tx.query(
      "insert into public.role_permissions (role_id, permission_key) values ($1, 'user.manage'), ($1, 'role.manage')",
      [role.id]
    )
    await tx.query("insert into public.user_roles (user_id, role_id) values ($1, $2)", [u.staff, role.id])
    return role.id
  }

  test("cannot assign a role holding permissions they lack", async () => {
    await db.transaction(async (tx) => {
      await withUserManager(tx)
      await expectError(
        asUser(tx, u.staff, (t) => t.query("select public.set_user_roles($1, $2)", [u.staff, [roles.super_admin]])),
        /roles whose permissions you hold/
      )
      await tx.rollback()
    })
  })

  test("cannot bypass the check with a direct insert", async () => {
    await db.transaction(async (tx) => {
      await withUserManager(tx)
      await expectError(
        asUser(tx, u.staff, (t) =>
          t.query("insert into public.user_roles (user_id, role_id) values ($1, $2)", [u.staff, roles.all_access_viewer])
        ),
        /row-level security/
      )
      await tx.rollback()
    })
  })

  test("cannot add permissions they lack to a role", async () => {
    await db.transaction(async (tx) => {
      const roleId = await withUserManager(tx)
      await expectError(
        asUser(tx, u.staff, (t) =>
          t.query("select public.set_role_permissions($1, $2)", [roleId, ["user.manage", "role.manage", "document.view.all"]])
        ),
        /permissions that you hold/
      )
      await tx.rollback()
    })
  })

  test("can re-save a role that already has permissions they lack", async () => {
    await db.transaction(async (tx) => {
      const roleId = await withUserManager(tx)
      const audit = await one(tx, "insert into public.roles (name) values ('Auditor') returning id")
      await tx.query("insert into public.role_permissions (role_id, permission_key) values ($1, 'audit.view.all')", [audit.id])
      await asUser(tx, u.staff, (t) =>
        t.query("select public.set_role_permissions($1, $2)", [audit.id, ["audit.view.all", "user.manage"]])
      )
      const { keys } = await one(
        tx,
        "select array_agg(permission_key order by permission_key) as keys from public.role_permissions where role_id = $1",
        [audit.id]
      )
      assert.deepEqual(keys, ["audit.view.all", "user.manage"])
      assert.ok(roleId)
      await tx.rollback()
    })
  })

  test("can still grant what they hold", async () => {
    await db.transaction(async (tx) => {
      const roleId = await withUserManager(tx)
      await asUser(tx, u.staff, (t) => t.query("select public.set_user_roles($1, $2)", [u.hod, [roleId]]))
      const { n } = await one(tx, "select count(*)::int as n from public.user_roles where user_id = $1 and role_id = $2", [
        u.hod,
        roleId,
      ])
      assert.equal(n, 1)
      await tx.rollback()
    })
  })
})

describe("log_user_admin_event", () => {
  test("records the admin as actor, in the target user's department", async () => {
    await db.transaction(async (tx) => {
      await asUser(tx, u.admin, (t) => t.query("select public.log_user_admin_event('password_reset', $1)", [u.staff]))
      const row = await one(tx, "select actor_id, entity_id, department_id from public.audit_logs order by id desc limit 1")
      assert.deepEqual(row, { actor_id: u.admin, entity_id: u.staff, department_id: d.acad })
      await tx.rollback()
    })
  })

  test("is restricted to user managers and known actions", async () => {
    await expectError(
      asUser(db, u.hod, (t) => t.query("select public.log_user_admin_event('password_reset', $1)", [u.staff])),
      /permission to manage users/
    )
    await expectError(
      asUser(db, u.admin, (t) => t.query("select public.log_user_admin_event('anything', $1)", [u.staff])),
      /Unsupported user admin event/
    )
  })
})
