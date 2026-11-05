import { before, describe, test } from "node:test"
import assert from "node:assert/strict"
import { asUser, createDb, createDept, createUser, expectError, expectErrorInTx, grantSystemRole, one } from "./harness.mjs"

let db
const u = {}
const d = {}
let docType

const setHead = (deptId, userId) => db.query("update public.departments set head_user_id = $1 where id = $2", [userId, deptId])

const tpl = (tx, name) => one(tx, "insert into public.templates (name, instance_label) values ($1, 'Name') returning id, version", [name]).then((r) => r.id)
const node = (tx, templateId, kind, name, extra = {}) =>
  one(
    tx,
    `insert into public.template_nodes (template_id, parent_id, kind, name, document_type_id, recurrence, storage, requires_review, slot_template_id, allow_subfolders)
     values ($1, $2, $3, $4, $5, coalesce($6, 'once')::public.recurrence_kind, coalesce($7, 'here')::public.period_storage, coalesce($8, false), $9, coalesce($10, false))
     returning *`,
    [
      templateId,
      extra.parent ?? null,
      kind,
      name,
      kind === "document" ? docType : null,
      extra.recurrence ?? null,
      extra.storage ?? null,
      extra.review ?? null,
      extra.slot ?? null,
      extra.allowSub ?? null,
    ]
  )

before(async () => {
  db = await createDb()
  d.admin = await createDept(db, "Administration", "ADMIN")
  d.acad = await createDept(db, "Academics", "ACAD")
  u.admin = await createUser(db, { name: "Admin", deptId: d.admin })
  await setHead(d.admin, u.admin)
  await grantSystemRole(db, u.admin, "super_admin")
  u.hod = await createUser(db, { name: "Hod", deptId: d.acad })
  await setHead(d.acad, u.hod)
  docType = (await one(db, "select id from public.document_types where code = 'DOC'")).id
})

describe("template builder", () => {
  test("Program template with a Course folder holding a Subjects slot", async () => {
    await db.transaction(async (tx) => {
      const subject = await asUser(tx, u.admin, (t) => tpl(t, "Subject"))
      const lesson = await asUser(tx, u.admin, (t) =>
        node(t, subject, "document", "Lesson Plan", { recurrence: "weekly", storage: "academic_year_semester", review: true })
      )
      assert.deepEqual([lesson.recurrence, lesson.storage], ["weekly", "academic_year_semester"])

      const program = await asUser(tx, u.admin, (t) => tpl(t, "Program"))
      await asUser(tx, u.admin, (t) => node(t, program, "document", "PEOs", { recurrence: "academic_year", storage: "academic_year" }))
      const course = await asUser(tx, u.admin, (t) => node(t, program, "folder", "Course"))
      const slot = await asUser(tx, u.admin, (t) => node(t, program, "slot", "Subjects", { parent: course.id, slot: subject }))
      assert.equal(slot.slot_template_id, subject)

      const { uses } = await one(tx, "select public.template_uses($1, $2) as uses", [program, subject])
      assert.equal(uses, true)
      await tx.rollback()
    })
  })

  test("a template cannot contain itself, directly or indirectly", async () => {
    await db.transaction(async (tx) => {
      const a = await asUser(tx, u.admin, (t) => tpl(t, "A"))
      const b = await asUser(tx, u.admin, (t) => tpl(t, "B"))
      await asUser(tx, u.admin, (t) => node(t, a, "slot", "Bs", { slot: b }))
      await expectErrorInTx(tx, () => asUser(tx, u.admin, (t) => node(t, a, "slot", "Self", { slot: a })), /cannot contain itself/)
      await expectErrorInTx(tx, () => asUser(tx, u.admin, (t) => node(t, b, "slot", "As", { slot: a })), /cannot contain itself/)
      await tx.rollback()
    })
  })

  test("items only go inside folders; once-off items are filed in place", async () => {
    await db.transaction(async (tx) => {
      const t1 = await asUser(tx, u.admin, (t) => tpl(t, "T1"))
      const doc = await asUser(tx, u.admin, (t) => node(t, t1, "document", "Checklist", { storage: "academic_year" }))
      assert.equal(doc.storage, "here", "a once-off item is never filed by period")
      await expectErrorInTx(tx, () => asUser(tx, u.admin, (t) => node(t, t1, "folder", "Inside a doc", { parent: doc.id })), /only be placed inside folders/)
      await tx.rollback()
    })
  })

  test("reviewer chains: only on items that need review; fixed reviewers must be active", async () => {
    await db.transaction(async (tx) => {
      const t1 = await asUser(tx, u.admin, (t) => tpl(t, "T2"))
      const plain = await asUser(tx, u.admin, (t) => node(t, t1, "document", "No review"))
      const reviewed = await asUser(tx, u.admin, (t) => node(t, t1, "document", "Reviewed", { review: true }))
      await expectErrorInTx(
        tx,
        () => asUser(tx, u.admin, (t) => t.query("select public.set_template_node_reviewers($1, '[{\"rule\":\"department_head\"}]')", [plain.id])),
        /need review/
      )
      await asUser(tx, u.admin, (t) =>
        t.query("select public.set_template_node_reviewers($1, $2::jsonb)", [
          reviewed.id,
          JSON.stringify([{ rule: "department_head" }, { rule: "fixed", user_id: u.hod }]),
        ])
      )
      const { rows } = await tx.query("select step_order, rule, user_id from public.template_node_reviewers where node_id = $1 order by step_order", [reviewed.id])
      assert.deepEqual(rows, [
        { step_order: 1, rule: "department_head", user_id: null },
        { step_order: 2, rule: "fixed", user_id: u.hod },
      ])
      await tx.rollback()
    })
  })

  test("structure changes bump the version", async () => {
    await db.transaction(async (tx) => {
      const t1 = await asUser(tx, u.admin, (t) => tpl(t, "T3"))
      await asUser(tx, u.admin, (t) => node(t, t1, "folder", "F"))
      await asUser(tx, u.admin, (t) => node(t, t1, "folder", "G"))
      const { version } = await one(tx, "select version from public.templates where id = $1", [t1])
      assert.equal(version, 3)
      await tx.rollback()
    })
  })

  test("only template.manage can build; everyone can read", async () => {
    await expectError(asUser(db, u.hod, (t) => tpl(t, "Sneaky")), /row-level security/)
    await db.transaction(async (tx) => {
      const t1 = await asUser(tx, u.admin, (t) => tpl(t, "Readable"))
      const { rows } = await asUser(tx, u.hod, (t) => t.query("select id from public.templates where id = $1", [t1]))
      assert.equal(rows.length, 1)
      await tx.rollback()
    })
  })

  test("a template used by another cannot be deleted", async () => {
    await db.transaction(async (tx) => {
      const child = await asUser(tx, u.admin, (t) => tpl(t, "Child"))
      const parent = await asUser(tx, u.admin, (t) => tpl(t, "Parent"))
      await asUser(tx, u.admin, (t) => node(t, parent, "slot", "Kids", { slot: child }))
      await expectErrorInTx(tx, () => asUser(tx, u.admin, (t) => t.query("delete from public.templates where id = $1", [child])), /used inside another template/)
      await tx.rollback()
    })
  })
})
