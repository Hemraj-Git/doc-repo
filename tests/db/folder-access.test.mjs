import { before, describe, test } from "node:test"
import assert from "node:assert/strict"
import { asUser, createDb, createDept, createUser, expectError, expectErrorInTx, grantSystemRole, one } from "./harness.mjs"

/*
 *   ADMIN: admin (Super Admin)
 *   ACAD:  hod (head) ── staff
 *   ENG:   engHead (head) ── engStaff, engOther
 *   HR:    hrStaff
 *
 *   ACAD root ─┬─ Lesson Plans ─── Semester 1
 *              ├─ Exams
 *              └─ KPI Records (private)
 */
let db
const u = {}
const d = {}
const f = {}
let docType

const grant = (tx, actor, folder, { user = null, dept = null, group = null }, access) =>
  asUser(tx, actor, (t) =>
    one(t, "select public.set_folder_permission($1, $2, $3, $4, $5) as id", [folder, user, dept, group, access]).then((r) => r.id)
  )

let fileNo = 0
/** The server's last upload step: runs without auth.uid(), as after verifying the file. */
async function directUpload(tx, actor, folder, { name = "Direct file", ref = null, reviewers = [] } = {}) {
  const { id } = await one(tx, "select gen_random_uuid() as id")
  const { department_id } = await one(tx, "select department_id from public.folders where id = $1", [folder])
  fileNo++
  await tx.query(
    `select public.create_direct_document($1, $2, $3, $4, $5, $6, null, $7, $8, 'file.pdf', 'pdf', 'application/pdf', 1024, $9)`,
    [actor, id, folder, name, docType, ref, reviewers, `${department_id}/${id}/file-${fileNo}.pdf`, "a".repeat(64)]
  )
  return id
}

const canSeeDoc = (tx, viewer, id) =>
  asUser(tx, viewer, (t) => t.query("select id from public.documents where id = $1", [id])).then((r) => r.rows.length === 1)
const canSeeFolder = (tx, viewer, id) =>
  asUser(tx, viewer, (t) => t.query("select id from public.folders where id = $1", [id])).then((r) => r.rows.length === 1)
const accessOf = (tx, viewer, folder) =>
  asUser(tx, viewer, (t) => one(t, "select public.my_folder_access($1) as a", [folder])).then((r) => r.a)

before(async () => {
  db = await createDb()
  d.admin = await createDept(db, "Administration", "ADMIN")
  d.acad = await createDept(db, "Academics", "ACAD")
  d.eng = await createDept(db, "Engineering", "ENG")
  d.hr = await createDept(db, "HR", "HR")

  u.admin = await createUser(db, { name: "Admin", deptId: d.admin })
  await grantSystemRole(db, u.admin, "super_admin")

  u.hod = await createUser(db, { name: "Hod", deptId: d.acad })
  await db.query("update public.departments set head_user_id = $1 where id = $2", [u.hod, d.acad])
  u.staff = await createUser(db, { name: "Staff", deptId: d.acad, reportsTo: u.hod })

  u.engHead = await createUser(db, { name: "Eng Head", deptId: d.eng })
  await db.query("update public.departments set head_user_id = $1 where id = $2", [u.engHead, d.eng])
  u.engStaff = await createUser(db, { name: "Eng Staff", deptId: d.eng, reportsTo: u.engHead })
  u.engOther = await createUser(db, { name: "Eng Other", deptId: d.eng, reportsTo: u.engHead })
  u.hrStaff = await createUser(db, { name: "Hr Staff", deptId: d.hr })

  const root = await one(db, "select id from public.folders where department_id = $1 and level = 'root'", [d.acad])
  f.root = root.id
  const mk = async (parent, name, ref, level, extra = "") =>
    (
      await one(
        db,
        `insert into public.folders (parent_id, department_id, level, name, reference_id, allow_subfolders${extra ? ", is_private" : ""})
         values ($1, $2, $3, $4, $5, true${extra ? ", true" : ""}) returning id`,
        [parent, d.acad, level, name, ref]
      )
    ).id
  f.lessons = await mk(f.root, "Lesson Plans", "ACD-LP", "child")
  f.sem1 = await mk(f.lessons, "Semester 1", null, "sub")
  f.exams = await mk(f.root, "Exams", "ACD-EX", "child")
  f.private = await mk(f.root, "KPI Records", "ACD-KPI", "child", "private")

  docType = (await one(db, "select id from public.document_types where code = 'DOC'")).id
})

describe("who can give access", () => {
  test("Super Admin can; an ordinary person or Department Head can't by default", async () => {
    await db.transaction(async (tx) => {
      await grant(tx, u.admin, f.lessons, { user: u.engStaff }, "read")
      await expectErrorInTx(tx, () => grant(tx, u.staff, f.lessons, { user: u.engStaff }, "read"), /do not have permission/)
      await expectErrorInTx(tx, () => grant(tx, u.hod, f.lessons, { user: u.engStaff }, "read"), /do not have permission/)
      await tx.rollback()
    })
  })

  test("folder.share.own_dept reaches only the holder's own department", async () => {
    await db.transaction(async (tx) => {
      await tx.query(
        `insert into public.role_permissions (role_id, permission_key)
         select id, 'folder.share.own_dept' from public.roles where system_key = 'department_head'`
      )
      await grant(tx, u.hod, f.lessons, { user: u.engStaff }, "read")
      await expectErrorInTx(tx, () => grant(tx, u.engHead, f.lessons, { user: u.engOther }, "read"), /do not have permission/)
      await tx.rollback()
    })
  })

  test("private folders and inactive users are refused, and exactly one grantee is required", async () => {
    await db.transaction(async (tx) => {
      await expectErrorInTx(tx, () => grant(tx, u.admin, f.private, { user: u.engStaff }, "read"), /cannot be shared/)
      await expectErrorInTx(tx, () => grant(tx, u.admin, f.lessons, {}, "read"), /Choose a person/)
      await expectErrorInTx(tx, () => grant(tx, u.admin, f.lessons, { user: u.engStaff, dept: d.eng }, "read"), /Choose a person/)
      await tx.query("update public.profiles set is_active = false where id = $1", [u.engOther])
      await expectErrorInTx(tx, () => grant(tx, u.admin, f.lessons, { user: u.engOther }, "read"), /active user/)
      await tx.rollback()
    })
  })

  test("grants can't be written directly, only through the function", async () => {
    await expectError(
      asUser(db, u.admin, (t) => t.query("insert into public.folder_permissions (folder_id, user_id, access) values ($1, $2, 'write')", [f.lessons, u.staff])),
      /row-level security/
    )
  })
})

describe("View and Upload", () => {
  test("no grant: neither sees the documents nor uploads", async () => {
    await db.transaction(async (tx) => {
      const doc = await directUpload(tx, u.hod, f.lessons)
      assert.equal(await canSeeDoc(tx, u.engStaff, doc), false)
      assert.equal(await canSeeFolder(tx, u.engStaff, f.lessons), false)
      assert.equal(await accessOf(tx, u.engStaff, f.lessons), "none")
      await expectErrorInTx(tx, () => directUpload(tx, u.engStaff, f.lessons), /permission to upload/)
      await tx.rollback()
    })
  })

  test("an ordinary department member has no upload right in their own department", async () => {
    await db.transaction(async (tx) => {
      assert.equal(await accessOf(tx, u.staff, f.lessons), "none")
      await expectErrorInTx(tx, () => directUpload(tx, u.staff, f.lessons), /permission to upload/)
      await tx.rollback()
    })
  })

  test("the Department Head can upload in their own department without a grant, not elsewhere", async () => {
    await db.transaction(async (tx) => {
      assert.equal(await accessOf(tx, u.hod, f.lessons), "write")
      assert.equal(await accessOf(tx, u.engHead, f.lessons), "none")
      await tx.rollback()
    })
  })

  test("View sees documents but can't upload", async () => {
    await db.transaction(async (tx) => {
      const doc = await directUpload(tx, u.hod, f.lessons)
      await grant(tx, u.admin, f.lessons, { user: u.engStaff }, "read")
      assert.equal(await canSeeDoc(tx, u.engStaff, doc), true)
      assert.equal(await accessOf(tx, u.engStaff, f.lessons), "read")
      await expectErrorInTx(tx, () => directUpload(tx, u.engStaff, f.lessons), /permission to upload/)
      const versions = await asUser(tx, u.engStaff, (t) => t.query("select id from public.document_versions where document_id = $1", [doc]))
      assert.equal(versions.rows.length, 1, "and can open its file versions")
      await tx.rollback()
    })
  })

  test("Upload can upload and also view", async () => {
    await db.transaction(async (tx) => {
      const before = await directUpload(tx, u.hod, f.lessons)
      await grant(tx, u.admin, f.lessons, { user: u.engStaff }, "write")
      assert.equal(await accessOf(tx, u.engStaff, f.lessons), "write")
      assert.equal(await canSeeDoc(tx, u.engStaff, before), true)
      const mine = await directUpload(tx, u.engStaff, f.lessons)
      assert.equal(await canSeeDoc(tx, u.engStaff, mine), true)
      await tx.rollback()
    })
  })

  test("a department grant reaches its members, including someone who joins later", async () => {
    await db.transaction(async (tx) => {
      const doc = await directUpload(tx, u.hod, f.lessons)
      await grant(tx, u.admin, f.lessons, { dept: d.eng }, "read")
      assert.equal(await canSeeDoc(tx, u.engOther, doc), true)
      assert.equal(await canSeeDoc(tx, u.hrStaff, doc), false)
      await tx.query("update public.profiles set department_id = $1, reports_to_id = null where id = $2", [d.eng, u.hrStaff])
      assert.equal(await canSeeDoc(tx, u.hrStaff, doc), true)
      await tx.rollback()
    })
  })

  test("the grant can be for the folder's own department", async () => {
    await db.transaction(async (tx) => {
      await grant(tx, u.admin, f.root, { dept: d.acad }, "write")
      assert.equal(await accessOf(tx, u.staff, f.lessons), "write")
      await tx.rollback()
    })
  })

  test("a group grant reaches its members only, and follows membership", async () => {
    await db.transaction(async (tx) => {
      const doc = await directUpload(tx, u.hod, f.lessons)
      const group = await asUser(tx, u.admin, (t) => one(t, "insert into public.user_groups (name) values ('Exam Committee') returning id"))
      await asUser(tx, u.admin, (t) => t.query("insert into public.user_group_members (group_id, user_id) values ($1, $2)", [group.id, u.hrStaff]))
      await grant(tx, u.admin, f.lessons, { group: group.id }, "write")
      assert.equal(await accessOf(tx, u.hrStaff, f.lessons), "write")
      assert.equal(await canSeeDoc(tx, u.hrStaff, doc), true)
      assert.equal(await canSeeDoc(tx, u.engOther, doc), false)

      await asUser(tx, u.admin, (t) => t.query("delete from public.user_group_members where group_id = $1 and user_id = $2", [group.id, u.hrStaff]))
      assert.equal(await accessOf(tx, u.hrStaff, f.lessons), "none")
      await tx.rollback()
    })
  })

  test("the highest of several grants wins", async () => {
    await db.transaction(async (tx) => {
      await grant(tx, u.admin, f.lessons, { dept: d.eng }, "read")
      await grant(tx, u.admin, f.lessons, { user: u.engStaff }, "write")
      assert.equal(await accessOf(tx, u.engStaff, f.lessons), "write")
      assert.equal(await accessOf(tx, u.engOther, f.lessons), "read")
      await tx.rollback()
    })
  })

  test("changing a level updates the one grant; removing it ends access at once", async () => {
    await db.transaction(async (tx) => {
      const doc = await directUpload(tx, u.hod, f.lessons)
      const first = await grant(tx, u.admin, f.lessons, { user: u.engStaff }, "read")
      const second = await grant(tx, u.admin, f.lessons, { user: u.engStaff }, "write")
      assert.equal(first, second)
      assert.equal(await accessOf(tx, u.engStaff, f.lessons), "write")

      const removed = await asUser(tx, u.admin, (t) => t.query("delete from public.folder_permissions where id = $1", [first]))
      assert.equal(removed.affectedRows, 1)
      assert.equal(await canSeeDoc(tx, u.engStaff, doc), false)
      assert.equal(await accessOf(tx, u.engStaff, f.lessons), "none")
      await tx.rollback()
    })
  })

  test("only someone who manages access can remove a grant", async () => {
    await db.transaction(async (tx) => {
      const id = await grant(tx, u.admin, f.lessons, { user: u.engStaff }, "read")
      await asUser(tx, u.engStaff, (t) => t.query("delete from public.folder_permissions where id = $1", [id]))
      assert.equal(await accessOf(tx, u.engStaff, f.lessons), "read", "their own delete changed nothing")
      await tx.rollback()
    })
  })

  test("a deactivated person loses grant access", async () => {
    await db.transaction(async (tx) => {
      await grant(tx, u.admin, f.lessons, { user: u.engStaff }, "write")
      await tx.query("update public.profiles set is_active = false where id = $1", [u.engStaff])
      assert.equal(await accessOf(tx, u.engStaff, f.lessons), "none")
      await tx.rollback()
    })
  })

  test("after losing access, the uploader still sees their own document but can't add more", async () => {
    await db.transaction(async (tx) => {
      const id = await grant(tx, u.admin, f.lessons, { user: u.engStaff }, "write")
      const mine = await directUpload(tx, u.engStaff, f.lessons)
      await asUser(tx, u.admin, (t) => t.query("delete from public.folder_permissions where id = $1", [id]))
      assert.equal(await canSeeDoc(tx, u.engStaff, mine), true)
      await expectErrorInTx(tx, () => directUpload(tx, u.engStaff, f.lessons), /permission to upload/)
      await tx.rollback()
    })
  })
})

describe("sub-folders", () => {
  test("a grant covers current and later sub-folders", async () => {
    await db.transaction(async (tx) => {
      await grant(tx, u.admin, f.lessons, { user: u.engStaff }, "write")
      assert.equal(await accessOf(tx, u.engStaff, f.sem1), "write")
      const later = await one(
        tx,
        "insert into public.folders (parent_id, department_id, level, name) values ($1, $2, 'sub', 'Semester 2') returning id",
        [f.lessons, d.acad]
      )
      assert.equal(await accessOf(tx, u.engStaff, later.id), "write")
      assert.equal(await canSeeFolder(tx, u.engStaff, later.id), true)
      await tx.rollback()
    })
  })

  test("a top-level grant never reaches private folders or their documents", async () => {
    await db.transaction(async (tx) => {
      await grant(tx, u.admin, f.root, { user: u.engStaff }, "write")
      assert.equal(await accessOf(tx, u.engStaff, f.exams), "write")
      assert.equal(await accessOf(tx, u.engStaff, f.private), "none")
      assert.equal(await canSeeFolder(tx, u.engStaff, f.private), false)
      await expectErrorInTx(tx, () => directUpload(tx, u.engStaff, f.private), /permission to upload/)
      await tx.rollback()
    })
  })

  test("nobody uploads directly to a private folder, even an admin", async () => {
    await db.transaction(async (tx) => {
      await expectErrorInTx(tx, () => directUpload(tx, u.admin, f.private), /permission to upload/)
      await tx.rollback()
    })
  })

  test("a grant shows parents for navigation, but not siblings or the parent's documents", async () => {
    await db.transaction(async (tx) => {
      const parentDoc = await directUpload(tx, u.hod, f.lessons)
      const sem1Doc = await directUpload(tx, u.hod, f.sem1)
      await grant(tx, u.admin, f.sem1, { user: u.engStaff }, "read")

      assert.equal(await canSeeFolder(tx, u.engStaff, f.sem1), true)
      assert.equal(await canSeeFolder(tx, u.engStaff, f.lessons), true, "parent, to navigate")
      assert.equal(await canSeeFolder(tx, u.engStaff, f.root), true, "department, to navigate")
      assert.equal(await canSeeFolder(tx, u.engStaff, f.exams), false, "sibling stays hidden")
      assert.equal(await canSeeDoc(tx, u.engStaff, sem1Doc), true)
      assert.equal(await canSeeDoc(tx, u.engStaff, parentDoc), false, "parent's documents stay hidden")
      assert.equal(await accessOf(tx, u.engStaff, f.lessons), "none")
      await tx.rollback()
    })
  })
})

describe("direct upload", () => {
  test("no reviewers: live at once with version 1, flagged as direct", async () => {
    await db.transaction(async (tx) => {
      const id = await directUpload(tx, u.hod, f.lessons, { name: "  Syllabus  " })
      const doc = await one(tx, "select * from public.documents where id = $1", [id])
      assert.equal(doc.status, "approved")
      assert.equal(doc.is_direct, true)
      assert.equal(doc.requires_review, false)
      assert.equal(doc.name, "Syllabus")
      assert.equal(doc.assigned_uploader_id, u.hod)
      assert.equal(doc.created_by, u.hod)
      assert.ok(doc.current_version_id)
      const v = await one(tx, "select version_no, uploaded_by from public.document_versions where document_id = $1", [id])
      assert.deepEqual(v, { version_no: 1, uploaded_by: u.hod })
      await tx.rollback()
    })
  })

  test("with reviewers: starts the review and notifies the first reviewer, who can see it", async () => {
    await db.transaction(async (tx) => {
      await grant(tx, u.admin, f.lessons, { user: u.engStaff }, "write")
      const id = await directUpload(tx, u.engStaff, f.lessons, { reviewers: [u.hrStaff, u.engHead] })
      const doc = await one(tx, "select status, requires_review from public.documents where id = $1", [id])
      assert.deepEqual(doc, { status: "in_review", requires_review: true })
      const step = await one(tx, "select reviewer_id from public.document_review_steps where document_id = $1 and state = 'active'", [id])
      assert.equal(step.reviewer_id, u.hrStaff)
      const note = await one(tx, "select count(*)::int as n from public.notifications where user_id = $1 and type = 'review_requested'", [u.hrStaff])
      assert.equal(note.n, 1)
      assert.equal(await canSeeDoc(tx, u.hrStaff, id), true)
      await tx.rollback()
    })
  })

  test("the uploader can't review their own upload", async () => {
    await db.transaction(async (tx) => {
      await expectErrorInTx(tx, () => directUpload(tx, u.hod, f.lessons, { reviewers: [u.hod] }), /uploader cannot also review/)
      await tx.rollback()
    })
  })

  test("a refused upload leaves nothing behind", async () => {
    await db.transaction(async (tx) => {
      const count = () => one(tx, "select count(*)::int as n from public.documents").then((r) => r.n)
      const start = await count()
      await expectErrorInTx(tx, () => directUpload(tx, u.engStaff, f.lessons), /permission to upload/)
      await expectErrorInTx(tx, () => directUpload(tx, u.hod, f.lessons, { reviewers: [u.hod] }), /uploader cannot also review/)
      assert.equal(await count(), start)
      await tx.rollback()
    })
  })

  test("a signed-in person can't call the server-only step", async () => {
    await expectError(
      asUser(db, u.admin, (t) =>
        t.query(
          `select public.create_direct_document($1, gen_random_uuid(), $2, 'x', $3, null, null, '{}', 'p', 'f.pdf', 'pdf', 'application/pdf', 1, $4)`,
          [u.admin, f.lessons, docType, "a".repeat(64)]
        )
      ),
      /permission denied/
    )
  })

  test("the department's top-level folder needs a Reference ID", async () => {
    await db.transaction(async (tx) => {
      await expectErrorInTx(tx, () => directUpload(tx, u.hod, f.root), /Reference ID/)
      const id = await directUpload(tx, u.hod, f.root, { ref: "ACD-DIRECT-1" })
      assert.equal((await one(tx, "select reference_id from public.documents where id = $1", [id])).reference_id, "ACD-DIRECT-1")
      await tx.rollback()
    })
  })

  test("a mistaken upload can be marked not applicable, and reopening makes it live again", async () => {
    await db.transaction(async (tx) => {
      const id = await directUpload(tx, u.hod, f.lessons)
      await asUser(tx, u.hod, (t) => t.query("select public.mark_not_applicable($1, 'Wrong file')", [id]))
      assert.equal((await one(tx, "select status from public.documents where id = $1", [id])).status, "not_applicable")
      await asUser(tx, u.hod, (t) => t.query("select public.reopen_document($1)", [id]))
      assert.equal((await one(tx, "select status from public.documents where id = $1", [id])).status, "approved")
      await tx.rollback()
    })
  })

  test("an approved requirement still can't be marked not applicable", async () => {
    await db.transaction(async (tx) => {
      const { id } = await asUser(tx, u.hod, (t) =>
        one(t, "select public.create_document($1, 'Req', $2, null, null, $3, false, '{}', null) as id", [f.lessons, docType, u.staff])
      )
      await tx.query(
        `select public.record_document_version($1, $2, $3, 'a.pdf', 'pdf', 'application/pdf', 1, $4, null)`,
        [u.staff, id, `${d.acad}/${id}/v1.pdf`, "b".repeat(64)]
      )
      await expectErrorInTx(tx, () => asUser(tx, u.staff, (t) => t.query("select public.mark_not_applicable($1, 'x')", [id])), /waiting for an upload/)
      await tx.rollback()
    })
  })

  test("the KPI repository picker follows folder access", async () => {
    await db.transaction(async (tx) => {
      const doc = await directUpload(tx, u.hod, f.lessons)
      const can = () => asUser(tx, u.engStaff, (t) => one(t, "select public.can_view_document($1) as ok", [doc])).then((r) => r.ok)
      assert.equal(await can(), false)
      await grant(tx, u.admin, f.lessons, { user: u.engStaff }, "read")
      assert.equal(await can(), true)
      await tx.rollback()
    })
  })
})

describe("groups", () => {
  test("only group.manage can create groups or change members; names are unique ignoring case", async () => {
    await db.transaction(async (tx) => {
      await expectErrorInTx(tx, () => asUser(tx, u.hod, (t) => t.query("insert into public.user_groups (name) values ('Nope')")), /row-level security/)
      const g = await asUser(tx, u.admin, (t) => one(t, "insert into public.user_groups (name) values ('Exam Committee') returning id"))
      await expectErrorInTx(tx, () => asUser(tx, u.admin, (t) => t.query("insert into public.user_groups (name) values ('exam committee')")), /duplicate key|unique/)
      await expectErrorInTx(tx, () => asUser(tx, u.hod, (t) => t.query("insert into public.user_group_members (group_id, user_id) values ($1, $2)", [g.id, u.hod])), /row-level security/)
      await tx.rollback()
    })
  })

  test("a member sees their own group, others don't", async () => {
    await db.transaction(async (tx) => {
      const g = await asUser(tx, u.admin, (t) => one(t, "insert into public.user_groups (name) values ('Exam Committee') returning id"))
      await asUser(tx, u.admin, (t) => t.query("insert into public.user_group_members (group_id, user_id) values ($1, $2)", [g.id, u.staff]))
      const seen = (who) => asUser(tx, who, (t) => t.query("select id from public.user_groups")).then((r) => r.rows.length)
      assert.equal(await seen(u.staff), 1)
      assert.equal(await seen(u.hrStaff), 0)
      await tx.rollback()
    })
  })

  test("deleting a group removes its grants and members", async () => {
    await db.transaction(async (tx) => {
      const g = await asUser(tx, u.admin, (t) => one(t, "insert into public.user_groups (name) values ('Exam Committee') returning id"))
      await asUser(tx, u.admin, (t) => t.query("insert into public.user_group_members (group_id, user_id) values ($1, $2)", [g.id, u.staff]))
      await grant(tx, u.admin, f.lessons, { group: g.id }, "read")
      await asUser(tx, u.admin, (t) => t.query("delete from public.user_groups where id = $1", [g.id]))
      const left = await one(tx, "select count(*)::int as n from public.folder_permissions where group_id = $1", [g.id])
      assert.equal(left.n, 0)
      assert.equal(await accessOf(tx, u.staff, f.lessons), "none")
      await tx.rollback()
    })
  })
})

describe("notifications and audit", () => {
  const notes = (tx, who) =>
    tx.query("select link, body from public.notifications where user_id = $1 and type = 'folder_shared'", [who]).then((r) => r.rows)

  test("a person is notified with a link; the admin who granted isn't", async () => {
    await db.transaction(async (tx) => {
      await grant(tx, u.admin, f.lessons, { user: u.engStaff }, "write")
      const rows = await notes(tx, u.engStaff)
      assert.equal(rows.length, 1)
      assert.equal(rows[0].link, `/repository/ACAD/${f.lessons}`)
      assert.match(rows[0].body, /upload/)
      assert.equal((await notes(tx, u.admin)).length, 0)
      await tx.rollback()
    })
  })

  test("everyone in a department is notified; repeating the same grant doesn't notify again", async () => {
    await db.transaction(async (tx) => {
      await grant(tx, u.admin, f.lessons, { dept: d.eng }, "read")
      await grant(tx, u.admin, f.lessons, { dept: d.eng }, "read")
      for (const who of [u.engHead, u.engStaff, u.engOther]) assert.equal((await notes(tx, who)).length, 1)
      assert.equal((await notes(tx, u.hrStaff)).length, 0)
      await tx.rollback()
    })
  })

  test("grants and removals are audited under the folder's department, with names", async () => {
    await db.transaction(async (tx) => {
      const id = await grant(tx, u.admin, f.lessons, { user: u.engStaff }, "read")
      await asUser(tx, u.admin, (t) => t.query("delete from public.folder_permissions where id = $1", [id]))
      const { rows } = await tx.query(
        "select action, department_id, meta from public.audit_logs where entity_type = 'folder_permission' and entity_id = $1 order by id",
        [f.lessons]
      )
      assert.deepEqual(rows.map((r) => r.action), ["insert", "delete"])
      assert.equal(rows[0].department_id, d.acad)
      assert.equal(rows[0].meta.folder, "Lesson Plans")
      assert.equal(rows[0].meta.grantee, "Eng Staff")
      await tx.rollback()
    })
  })

  test("template audit rows still get their department", async () => {
    const { prosrc } = await one(db, "select prosrc from pg_proc where proname = 'audit_fill_document_department'")
    assert.match(prosrc, /template_instance/)
  })

  test("my_shared_folders lists the folder the grant names, with the effective level", async () => {
    await db.transaction(async (tx) => {
      await grant(tx, u.admin, f.lessons, { dept: d.eng }, "read")
      await grant(tx, u.admin, f.sem1, { user: u.engStaff }, "read")
      await grant(tx, u.admin, f.lessons, { user: u.engStaff }, "write")
      const { rows } = await asUser(tx, u.engStaff, (t) => t.query("select name, department_code, can_write from public.my_shared_folders() order by name"))
      assert.deepEqual(rows, [
        { name: "Lesson Plans", department_code: "ACAD", can_write: true },
        { name: "Semester 1", department_code: "ACAD", can_write: true },
      ])
      await tx.rollback()
    })
  })
})
