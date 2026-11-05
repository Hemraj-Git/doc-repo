import { before, describe, test } from "node:test"
import assert from "node:assert/strict"
import { asUser, createDb, createDept, createUser, expectError, expectErrorInTx, grantSystemRole, one } from "./harness.mjs"

/*
 *   ADMIN: admin (head, Super Admin — builds templates)
 *   ACAD:  hod (head) ─┬─ rao (teacher)
 *                      └─ das (teacher)
 *   HR:    hrHead (head)
 *
 * Templates:
 *   Subject:  Lesson Plan (weekly, AY→Semester, uploader = slot owner, review by HOD then owner's manager)
 *             Syllabus (once, chosen)
 *   Program:  Appointment Letter (once, chosen) · PEOs (per academic year, chosen, AY folder)
 *             Course/ ↻ Subjects (Subject template, owner "Subject teacher")
 */
let db
const u = {}
const d = {}
const n = {}
let tSubject, tProgram, docType, apg

const setHead = (deptId, userId) => db.query("update public.departments set head_user_id = $1 where id = $2", [userId, deptId])
const today = (tx) => one(tx, "select public.institute_today()::text as d").then((r) => r.d)

async function addNode(templateId, kind, name, extra = {}) {
  return asUser(db, u.admin, (t) =>
    one(
      t,
      `insert into public.template_nodes (template_id, parent_id, kind, name, document_type_id, recurrence, storage, uploader_rule,
                                          requires_review, due_mode, due_days, slot_template_id, slot_owner_label, sort_order)
       values ($1, $2, $3, $4, $5, $6::public.recurrence_kind, $7::public.period_storage, $8::public.uploader_rule,
               $9, $10::public.due_mode, $11, $12, $13, $14)
       returning id`,
      [
        templateId,
        extra.parent ?? null,
        kind,
        name,
        kind === "document" ? docType : null,
        extra.recurrence ?? "once",
        extra.storage ?? "here",
        extra.uploader ?? "chosen",
        extra.review ?? false,
        extra.due ?? "none",
        extra.dueDays ?? 3,
        extra.slot ?? null,
        extra.owner ?? null,
        extra.order ?? 0,
      ]
    )
  ).then((r) => r.id)
}

function payload(overrides = {}) {
  return {
    name: "Diploma In Nautical Science",
    uploaders: { [n.letter]: u.hod, [n.peos]: u.hod },
    slots: {
      [n.subjects]: [
        { name: "Navigation", owner_id: u.rao, uploaders: { [n.syllabus]: u.rao } },
        { name: "Seamanship", owner_id: u.das, uploaders: { [n.syllabus]: u.das } },
      ],
    },
    ...overrides,
  }
}

const instantiate = (tx, who, body, parent = apg, template = tProgram) =>
  asUser(tx, who, (t) =>
    one(t, "select public.instantiate_template($1, $2, $3::jsonb) as id", [parent, template, JSON.stringify(body)])
  ).then((r) => r.id)

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
  u.rao = await createUser(db, { name: "Rao", deptId: d.acad, reportsTo: u.hod })
  u.das = await createUser(db, { name: "Das", deptId: d.acad, reportsTo: u.hod })
  u.hrHead = await createUser(db, { name: "Hr Head", deptId: d.hr })
  await setHead(d.hr, u.hrHead)
  docType = (await one(db, "select id from public.document_types where code = 'DOC'")).id

  tSubject = (await asUser(db, u.admin, (t) => one(t, "insert into public.templates (name, instance_label) values ('Subject', 'Subject name') returning id"))).id
  n.lesson = await addNode(tSubject, "document", "Lesson Plan", {
    recurrence: "weekly",
    storage: "academic_year_semester",
    uploader: "slot_owner",
    review: true,
    due: "period_end",
  })
  await asUser(db, u.admin, (t) =>
    t.query("select public.set_template_node_reviewers($1, $2::jsonb)", [
      n.lesson,
      JSON.stringify([{ rule: "department_head" }, { rule: "slot_owner_manager" }]),
    ])
  )
  n.syllabus = await addNode(tSubject, "document", "Syllabus", { order: 20 })

  tProgram = (await asUser(db, u.admin, (t) => one(t, "insert into public.templates (name, instance_label) values ('Program', 'Program name') returning id"))).id
  n.letter = await addNode(tProgram, "document", "Course Incharge – Appointment Letter", { order: 10, due: "after_creation", dueDays: 7 })
  n.peos = await addNode(tProgram, "document", "PEOs", { order: 20, recurrence: "academic_year", storage: "academic_year" })
  n.course = await addNode(tProgram, "folder", "Course", { order: 30 })
  n.subjects = await addNode(tProgram, "slot", "Subjects", { parent: n.course, slot: tSubject, owner: "Subject teacher" })

  const root = (await one(db, "select id from public.folders where department_id = $1 and level = 'root'", [d.acad])).id
  apg = (
    await asUser(db, u.hod, (t) =>
      one(
        t,
        "insert into public.folders (parent_id, department_id, level, name, reference_id, allow_subfolders) values ($1, $2, 'child', 'Academic Programme Guide', 'SOMSQP-ADC-1-FL4', true) returning id",
        [root, d.acad]
      )
    )
  ).id
})

describe("period engine", () => {
  const period = (kind, date) => one(db, "select * from public.period_for($1::public.recurrence_kind, $2::date)", [kind, date])

  test("weekly: Monday–Sunday, numbered within the academic year (July start)", async () => {
    const p = await period("weekly", "2026-07-15")
    assert.deepEqual(
      { key: p.period_key, label: p.label, sem: p.semester_no, ay: p.ay_label },
      { key: "2026–27/W03", label: "Week 3 (13–19 Jul 2026)", sem: 1, ay: "2026–27" }
    )
    const cross = await period("weekly", "2026-07-30")
    assert.equal(cross.label, "Week 5 (27 Jul – 2 Aug 2026)")
    const yearEnd = await period("weekly", "2026-12-31")
    assert.equal(yearEnd.label, "Week 27 (28 Dec 2026 – 3 Jan 2027)")
    assert.equal(yearEnd.semester_no, 1)
  })

  test("monthly, semester and academic year", async () => {
    const m = await period("monthly", "2027-02-10")
    assert.deepEqual([m.period_key, m.label, m.ay_label, m.semester_no], ["2027-02", "February 2027", "2026–27", 2])
    const s = await period("semester", "2027-02-10")
    assert.deepEqual([s.period_key, s.label, s.period_start.toISOString().slice(0, 10)], ["2026–27/S2", "Semester 2, 2026–27", "2027-01-01"])
    const y = await period("academic_year", "2026-06-30")
    assert.deepEqual([y.period_key, y.label], ["2025–26", "2025–26"])
  })

  test("the academic year start month comes from institute settings", async () => {
    await db.transaction(async (tx) => {
      await tx.query("update public.institute_settings set academic_year_start_month = 4")
      const y = await one(tx, "select * from public.period_for('academic_year', '2026-03-31')")
      assert.equal(y.label, "2025–26")
      const s = await one(tx, "select * from public.period_for('semester', '2026-10-01')")
      assert.equal(s.label, "Semester 2, 2026–27")
      await tx.rollback()
    })
  })
})

describe("creating from a template", () => {
  test("Program with two subjects: folders, one-time requirements, series and the current periods", async () => {
    await db.transaction(async (tx) => {
      const root = await instantiate(tx, u.hod, payload())
      const day = await today(tx)

      const { rows: folders } = await tx.query(
        `with recursive t as (select id, name, depth, reference_id from public.folders where id = $1
                              union all select f.id, f.name, f.depth, f.reference_id from public.folders f join t on f.parent_id = t.id)
         select name, depth, reference_id from t order by depth, name`,
        [root]
      )
      const names = folders.map((f) => `${f.depth}:${f.name}`)
      assert.equal(folders[0].reference_id, "SOMSQP-ADC-1-FL4 (Diploma In Nautical Science)")
      for (const expected of ["2:Diploma In Nautical Science", "3:Course", "4:Navigation", "4:Seamanship"]) {
        assert.ok(names.includes(expected), `missing folder ${expected}`)
      }
      // Lesson Plan files are under <AY>/<Semester N> in each subject; PEOs under <AY> in the program.
      const ay = (await one(tx, "select ay_label from public.period_for('weekly', $1::date)", [day])).ay_label
      assert.ok(names.includes(`3:${ay}`), "academic year folder for PEOs")
      assert.equal(names.filter((x) => x === `5:${ay}`).length, 2, "academic year folder in each subject")

      const { rows: docs } = await tx.query(
        `select d.name, d.status, d.due_date::text, p.full_name as uploader, d.series_id is not null as recurring,
                (select array_agg(pr.full_name order by r.step_order) from public.document_reviewers r join public.profiles pr on pr.id = r.reviewer_id where r.document_id = d.id) as reviewers
         from public.documents d join public.profiles p on p.id = d.assigned_uploader_id
         where d.template_instance_id in (select id from public.template_instances where root_folder_id = $1
                                          or parent_instance_id = (select id from public.template_instances where root_folder_id = $1))
         order by d.name`,
        [root]
      )
      const byName = Object.fromEntries(docs.map((x) => [x.name.replace(/ – Week.*/, " – Week"), x]))
      assert.equal(byName["Course Incharge – Appointment Letter"].uploader, "Hod")
      assert.ok(byName["Course Incharge – Appointment Letter"].due_date, "due 7 days after creation")
      assert.ok(docs.some((x) => x.name === `PEOs – ${ay}`), "the current academic year's PEOs")
      const lessons = docs.filter((x) => x.name.startsWith("Lesson Plan – Week"))
      assert.equal(lessons.length, 2, "one current-week lesson plan per subject")
      assert.deepEqual(lessons.map((x) => x.uploader).sort(), ["Das", "Rao"], "uploaded by the subject teacher")
      // Reviewers: HOD, then the teacher's manager — also the HOD, so the duplicate step is dropped.
      assert.deepEqual(lessons[0].reviewers, ["Hod"])
      assert.equal(docs.filter((x) => x.name === "Syllabus").length, 2)

      const { n: series } = await one(tx, "select count(*)::int as n from public.recurring_series")
      assert.equal(series, 3, "PEOs + a Lesson Plan series per subject")
      await tx.rollback()
    })
  })

  test("all or nothing: a missing uploader creates nothing", async () => {
    await db.transaction(async (tx) => {
      const before = (await one(tx, "select count(*)::int as n from public.folders")).n
      const body = payload()
      delete body.slots[n.subjects][1].uploaders[n.syllabus]
      await expectErrorInTx(tx, () => instantiate(tx, u.hod, body), /Choose who uploads "Syllabus" in "Seamanship"/)
      const after = (await one(tx, "select count(*)::int as n from public.folders")).n
      assert.equal(after, before)
      await tx.rollback()
    })
  })

  test("permissions and department availability", async () => {
    await expectError(instantiate(db, u.rao, payload()), /do not have permission/)
    await expectError(instantiate(db, u.hrHead, payload()), /Folder not found|do not have permission/)
    await db.transaction(async (tx) => {
      await tx.query("update public.templates set department_ids = $1 where id = $2", [[d.hr], tProgram])
      await expectErrorInTx(tx, () => instantiate(tx, u.hod, payload()), /not available to this department/)
      await tx.rollback()
    })
  })

  test("duplicate entry names in one slot are rejected", async () => {
    const body = payload()
    body.slots[n.subjects][1].name = "Navigation"
    await expectError(instantiate(db, u.hod, body), /folders_sibling_name_key|already exists/)
  })
})

describe("recurring generation", () => {
  test("each period is created once; later days add the next periods; nothing is back-filled", async () => {
    await db.transaction(async (tx) => {
      const root = await instantiate(tx, u.hod, payload())
      const series = await one(
        tx,
        `select s.id from public.recurring_series s join public.template_instances i on i.id = s.instance_id
         where s.name = 'Lesson Plan' and i.name = 'Navigation' and i.parent_instance_id = (select id from public.template_instances where root_folder_id = $1)`,
        [root]
      )
      const count = () => one(tx, "select count(*)::int as n from public.documents where series_id = $1", [series.id]).then((r) => r.n)
      assert.equal(await count(), 1)

      // Running again today changes nothing.
      const again = await one(tx, "select public.generate_series_due($1, public.institute_today()) as n", [series.id])
      assert.equal(again.n, 0)

      // Three weeks later: three more weekly lesson plans.
      const later = await one(tx, "select public.generate_series_due($1, public.institute_today() + 21) as n", [series.id])
      assert.equal(later.n, 3)
      assert.equal(await count(), 4)

      const { rows } = await tx.query("select period_key from public.documents where series_id = $1 order by period_start", [series.id])
      assert.equal(new Set(rows.map((r) => r.period_key)).size, 4, "distinct periods")
      await tx.rollback()
    })
  })

  test("add a subject later, and reassign a series", async () => {
    await db.transaction(async (tx) => {
      const root = await instantiate(tx, u.hod, payload())
      const inst = await one(tx, "select id from public.template_instances where root_folder_id = $1", [root])
      const added = await asUser(tx, u.hod, (t) =>
        one(t, "select public.add_slot_entry($1, $2, $3::jsonb) as id", [
          inst.id,
          n.subjects,
          JSON.stringify({ name: "Meteorology", owner_id: u.das, uploaders: { [n.syllabus]: u.das } }),
        ])
      )
      const parent = await one(tx, "select p.name from public.folders f join public.folders p on p.id = f.parent_id where f.id = $1", [added.id])
      assert.equal(parent.name, "Course")

      const s = await one(
        tx,
        "select s.id from public.recurring_series s join public.template_instances i on i.id = s.instance_id where i.name = 'Meteorology' and s.name = 'Lesson Plan'"
      )
      await asUser(tx, u.hod, (t) => t.query("select public.reassign_series($1, $2, true)", [s.id, u.rao]))
      const doc = await one(tx, "select p.full_name from public.documents d join public.profiles p on p.id = d.assigned_uploader_id where d.series_id = $1", [s.id])
      assert.equal(doc.full_name, "Rao")
      await expectErrorInTx(tx, () => asUser(tx, u.rao, (t) => t.query("select public.reassign_series($1, $2, false)", [s.id, u.das])), /permission/)
      await tx.rollback()
    })
  })
})

describe("scheduler", () => {
  const lessonSeries = (tx, root, subject = "Navigation") =>
    one(
      tx,
      `select s.id from public.recurring_series s join public.template_instances i on i.id = s.instance_id
       where s.name = 'Lesson Plan' and i.name = $2 and i.parent_instance_id = (select id from public.template_instances where root_folder_id = $1)`,
      [root, subject]
    ).then((r) => r.id)
  const countDocs = (tx, series) =>
    one(tx, "select count(*)::int as n from public.documents where series_id = $1", [series]).then((r) => r.n)

  test("generate_due_requirements runs every active series, logs the run and is idempotent", async () => {
    await db.transaction(async (tx) => {
      await instantiate(tx, u.hod, payload())
      const run = await one(tx, "select * from public.generate_due_requirements(public.institute_today() + 14)")
      assert.equal(run.trigger, "schedule")
      assert.equal(run.series_checked, 3)
      assert.equal(run.created_count, 4, "two more weeks of lesson plans in each of two subjects")
      assert.equal(run.error_count, 0)
      assert.ok(run.finished_at)
      const again = await one(tx, "select * from public.generate_due_requirements(public.institute_today() + 14)")
      assert.equal(again.created_count, 0)
      await tx.rollback()
    })
  })

  test("one failing series is logged and the others still run", async () => {
    await db.transaction(async (tx) => {
      const root = await instantiate(tx, u.hod, payload())
      const broken = await lessonSeries(tx, root, "Seamanship")
      // A document type that no longer exists makes this series fail.
      await tx.query("alter table public.documents disable trigger user")
      await tx.query("alter table public.recurring_series drop constraint recurring_series_document_type_id_fkey")
      await tx.query("update public.recurring_series set document_type_id = gen_random_uuid() where id = $1", [broken])
      await tx.query("alter table public.documents enable trigger user")
      const run = await one(tx, "select * from public.generate_due_requirements(public.institute_today() + 7)")
      assert.equal(run.error_count, 1)
      assert.equal(run.errors[0].instance, "Seamanship")
      assert.equal(run.created_count, 1, "Navigation still got its next week")
      await tx.rollback()
    })
  })

  test("run_scheduler_now needs template.manage", async () => {
    await expectError(asUser(db, u.hod, (t) => t.query("select public.run_scheduler_now()")), /permission to run the scheduler/)
    const run = await asUser(db, u.admin, (t) => one(t, "select * from public.run_scheduler_now()"))
    assert.equal(run.trigger, "manual")
    assert.equal(run.triggered_by, u.admin)
    const seen = await asUser(db, u.admin, (t) => one(t, "select count(*)::int as n from public.scheduler_runs"))
    assert.ok(seen.n >= 1)
    const hidden = await asUser(db, u.hod, (t) => one(t, "select count(*)::int as n from public.scheduler_runs"))
    assert.equal(hidden.n, 0, "only template managers see the run log")
  })

  test("paused series are skipped; resuming does not back-fill", async () => {
    await db.transaction(async (tx) => {
      const root = await instantiate(tx, u.hod, payload())
      const s = await lessonSeries(tx, root)
      await asUser(tx, u.hod, (t) => t.query("select public.set_series_paused($1, true)", [s]))
      await tx.query("select public.generate_due_requirements(public.institute_today() + 21)")
      assert.equal(await countDocs(tx, s), 1, "nothing created while paused")

      // Pretend three weeks passed while paused: the cursor sits three weeks back.
      await tx.query("update public.recurring_series set last_period_end = last_period_end - 21 where id = $1", [s])
      const created = await asUser(tx, u.hod, (t) => one(t, "select public.set_series_paused($1, false) as n", [s]))
      assert.equal(created.n, 0, "the three missed weeks are skipped")
      assert.equal(await countDocs(tx, s), 1)
      await expectErrorInTx(tx, () => asUser(tx, u.rao, (t) => t.query("select public.set_series_paused($1, true)", [s])), /permission/)
      await tx.rollback()
    })
  })

  test("ending a series stops later periods", async () => {
    await db.transaction(async (tx) => {
      const root = await instantiate(tx, u.hod, payload())
      const s = await lessonSeries(tx, root)
      await asUser(tx, u.hod, (t) => t.query("select public.set_series_end($1, public.institute_today())", [s]))
      await tx.query("select public.generate_due_requirements(public.institute_today() + 28)")
      assert.equal(await countDocs(tx, s), 1)
      await expectErrorInTx(
        tx,
        () => asUser(tx, u.hod, (t) => t.query("select public.set_series_end($1, public.institute_today() - 400)", [s])),
        /on or after/
      )
      await tx.rollback()
    })
  })

  test("closing a program stops its subjects; reopening resumes from the current period", async () => {
    await db.transaction(async (tx) => {
      const root = await instantiate(tx, u.hod, payload())
      const inst = (await one(tx, "select id from public.template_instances where root_folder_id = $1", [root])).id
      const s = await lessonSeries(tx, root)
      await asUser(tx, u.hod, (t) => t.query("select public.set_instance_status($1, false)", [inst]))
      const { rows } = await tx.query("select status from public.template_instances where id = $1 or parent_instance_id = $1", [inst])
      assert.deepEqual([...new Set(rows.map((r) => r.status))], ["closed"])
      const run = await one(tx, "select * from public.generate_due_requirements(public.institute_today() + 21)")
      assert.equal(run.series_checked, 0)

      const child = (await one(tx, "select id from public.template_instances where parent_instance_id = $1 and name = 'Navigation'", [inst])).id
      await expectErrorInTx(tx, () => asUser(tx, u.hod, (t) => t.query("select public.set_instance_status($1, true)", [child])), /Reopen the folder it belongs to first/)
      await expectErrorInTx(tx, () => asUser(tx, u.rao, (t) => t.query("select public.set_instance_status($1, true)", [inst])), /permission/)

      await asUser(tx, u.hod, (t) => t.query("select public.set_instance_status($1, true)", [inst]))
      assert.equal(await countDocs(tx, s), 1, "no back-fill on reopen")
      await tx.rollback()
    })
  })

  test("overdue appears in task counts", async () => {
    await db.transaction(async (tx) => {
      await instantiate(tx, u.hod, payload())
      await tx.query("update public.documents set due_date = public.institute_today() - 1 where assigned_uploader_id = $1 and series_id is not null", [u.rao])
      const c = await asUser(tx, u.rao, (t) => one(t, "select public.my_task_counts() as c"))
      assert.equal(c.c.overdue, 1)
      await tx.rollback()
    })
  })
})

describe("template updates and compliance", () => {
  const insertNode = (tx, values) =>
    asUser(tx, u.admin, (t) =>
      one(
        t,
        `insert into public.template_nodes (template_id, parent_id, kind, name, document_type_id, recurrence, storage, uploader_rule, due_mode, due_days, sort_order)
         values ($1, $2, $3, $4, $5, $6::public.recurrence_kind, 'here', $7::public.uploader_rule, 'none', 3, 90) returning id`,
        [values.template, values.parent ?? null, values.kind, values.name, values.kind === "document" ? docType : null, values.recurrence ?? "once", values.uploader ?? "chosen"]
      )
    ).then((r) => r.id)

  test("push adds new folders and items to existing instances, never twice", async () => {
    await db.transaction(async (tx) => {
      const root = await instantiate(tx, u.hod, payload())
      const program = (await one(tx, "select id from public.template_instances where root_folder_id = $1", [root])).id
      const navigation = (await one(tx, "select id from public.template_instances where parent_instance_id = $1 and name = 'Navigation'", [program])).id

      const folder = await insertNode(tx, { template: tProgram, kind: "folder", name: "Assessments" })
      await insertNode(tx, { template: tProgram, parent: folder, kind: "document", name: "Question Bank", uploader: "department_head" })
      await insertNode(tx, { template: tSubject, kind: "document", name: "Course Plan" })

      await expectErrorInTx(tx, () => asUser(tx, u.hod, (t) => t.query("select public.push_template_updates($1)", [program])), /permission/)
      const added = await asUser(tx, u.admin, (t) => one(t, "select public.push_template_updates($1) as n", [program]))
      assert.equal(added.n, 2, "the Assessments folder and its Question Bank")
      const qb = await one(tx, "select f.name as folder, p.full_name as uploader from public.documents d join public.folders f on f.id = d.folder_id join public.profiles p on p.id = d.assigned_uploader_id where d.name = 'Question Bank' and d.template_instance_id = $1", [program])
      assert.deepEqual(qb, { folder: "Assessments", uploader: "Hod" })

      const subj = await asUser(tx, u.admin, (t) => one(t, "select public.push_template_updates($1) as n", [navigation]))
      assert.equal(subj.n, 1)
      const cp = await one(tx, "select p.full_name from public.documents d join public.profiles p on p.id = d.assigned_uploader_id where d.name = 'Course Plan' and d.template_instance_id = $1", [navigation])
      assert.equal(cp.full_name, "Rao", "a chosen uploader falls back to the subject's owner")

      const again = await asUser(tx, u.admin, (t) => one(t, "select public.push_template_updates($1) as n", [program]))
      assert.equal(again.n, 0)
      const v = await one(tx, "select i.template_version = t.version as current from public.template_instances i join public.templates t on t.id = i.template_id where i.id = $1", [program])
      assert.equal(v.current, true)
      await tx.rollback()
    })
  })

  test("department compliance counts this week's and month's recurring files", async () => {
    await db.transaction(async (tx) => {
      await instantiate(tx, u.hod, payload())
      await tx.query("update public.documents set status = 'not_applicable', not_applicable_reason = 'Holiday' where assigned_uploader_id = $1 and series_id is not null", [u.rao])
      const c = await asUser(tx, u.hod, (t) => one(t, "select public.department_compliance($1) as c", [d.acad]))
      assert.deepEqual(c.c.week, { total: 2, done: 1, in_review: 0 })
      assert.equal(c.c.month.total, 0)
      const hidden = await asUser(tx, u.hrHead, (t) => one(t, "select public.department_compliance($1) as c", [d.acad]))
      assert.equal(hidden.c.week.total, 0, "other departments see nothing")
      await tx.rollback()
    })
  })
})

describe("slot entries with their own dates (semesters)", () => {
  const node = (tx, values) =>
    asUser(tx, u.admin, (t) =>
      one(
        t,
        `insert into public.template_nodes (template_id, parent_id, kind, name, slot_template_id, slot_entry_dates, sort_order)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [values.template, values.parent ?? null, values.kind, values.name, values.slot ?? null, values.dates ?? false, values.order ?? 0]
      )
    ).then((r) => r.id)

  // Batch ─ Semesters (own dates) ─ Semester ─ Subjects ─ Subject (weekly Lesson Plan)
  async function setup(tx, { subjectDates = false } = {}) {
    const tSemester = (await asUser(tx, u.admin, (t) => one(t, "insert into public.templates (name, instance_label) values ('Semester', 'Semester') returning id"))).id
    const subjects = await node(tx, { template: tSemester, kind: "slot", name: "Subjects", slot: tSubject, dates: subjectDates })
    const tBatch = (await asUser(tx, u.admin, (t) => one(t, "insert into public.templates (name, instance_label) values ('Batch', 'Batch') returning id"))).id
    const academic = await node(tx, { template: tBatch, kind: "folder", name: "Academic Files" })
    const semesters = await node(tx, { template: tBatch, parent: academic, kind: "slot", name: "Semesters", slot: tSemester, dates: true })
    return { tBatch, semesters, subjects }
  }
  const day = (tx, offset) => one(tx, "select (public.institute_today() + $1::int)::text as d", [offset]).then((r) => r.d)
  const subject = (name, owner) => ({ name, owner_id: owner, uploaders: { [n.syllabus]: owner } })

  test("an entry's own dates bound the recurring files of everything inside it", async () => {
    await db.transaction(async (tx) => {
      const { tBatch, semesters, subjects } = await setup(tx)
      const body = (sem) => ({ name: "2020–2023 Batch", uploaders: {}, slots: { [semesters]: [sem] } })
      const sem1 = { name: "1st Semester", uploaders: {}, slots: { [subjects]: [subject("Navigation", u.rao)] } }

      await expectErrorInTx(tx, () => instantiate(tx, u.hod, body(sem1), apg, tBatch), /Enter the start and end date of "1st Semester"/)
      const [start, end] = [await day(tx, -14), await day(tx, 30)]
      await expectErrorInTx(tx, () => instantiate(tx, u.hod, body({ ...sem1, start_date: end, end_date: start }), apg, tBatch), /must be after its start date/)

      await instantiate(tx, u.hod, body({ ...sem1, start_date: start, end_date: end }), apg, tBatch)
      const nav = await one(tx, "select id, start_date::text as s, end_date::text as e from public.template_instances where name = 'Navigation'")
      assert.deepEqual([nav.s, nav.e], [start, end], "subjects inherit the semester dates")
      const series = await one(tx, "select id, start_date::text as s, end_date::text as e from public.recurring_series where instance_id = $1", [nav.id])
      assert.deepEqual([series.s, series.e], [start, end])
      assert.equal((await one(tx, "select count(*)::int as n from public.documents where series_id = $1", [series.id])).n, 3, "weeks from the semester start to today")

      await tx.query("select public.generate_due_requirements(public.institute_today() + 90)")
      const last = await one(tx, "select max(period_start)::text as m, count(*)::int as n from public.documents where series_id = $1", [series.id])
      assert.ok(last.m <= end, "nothing after the semester ends")
      assert.ok(last.n >= 7 && last.n <= 8)
      await tx.rollback()
    })
  })

  test("editing a semester's dates carries through to its subjects", async () => {
    await db.transaction(async (tx) => {
      const { tBatch, semesters, subjects } = await setup(tx)
      const [start, end] = [await day(tx, 0), await day(tx, 60)]
      const sem = { name: "1st Semester", start_date: start, end_date: end, uploaders: {}, slots: { [subjects]: [subject("Navigation", u.rao)] } }
      await instantiate(tx, u.hod, { name: "2020–2023 Batch", uploaders: {}, slots: { [semesters]: [sem] } }, apg, tBatch)
      const semId = (await one(tx, "select id from public.template_instances where name = '1st Semester'")).id
      const [newStart, newEnd] = [await day(tx, -14), await day(tx, 45)]
      await expectErrorInTx(tx, () => asUser(tx, u.rao, (t) => t.query("select public.set_instance_dates($1, $2, $3)", [semId, newStart, newEnd])), /permission/)
      const created = await asUser(tx, u.hod, (t) => one(t, "select public.set_instance_dates($1, $2::date, $3::date) as n", [semId, newStart, newEnd]))
      assert.equal(created.n, 2, "the two earlier weeks now inside the semester")
      const s = await one(
        tx,
        "select s.start_date::text as s, s.end_date::text as e, i.end_date::text as ie from public.recurring_series s join public.template_instances i on i.id = s.instance_id where i.name = 'Navigation'"
      )
      assert.deepEqual([s.s, s.e, s.ie], [newStart, newEnd, newEnd])
      const batch = await one(tx, "select end_date from public.template_instances where name = '2020–2023 Batch'")
      assert.equal(batch.end_date, null, "the batch keeps its own dates")
      await tx.rollback()
    })
  })

  test("adding a semester later asks for its dates", async () => {
    await db.transaction(async (tx) => {
      const { tBatch, semesters, subjects } = await setup(tx)
      await instantiate(tx, u.hod, { name: "2020–2023 Batch", uploaders: {}, slots: {} }, apg, tBatch)
      const batch = (await one(tx, "select id from public.template_instances where name = '2020–2023 Batch'")).id
      const add = (entry) => asUser(tx, u.hod, (t) => t.query("select public.add_slot_entry($1, $2, $3::jsonb)", [batch, semesters, JSON.stringify(entry)]))
      const sem2 = { name: "2nd Semester", uploaders: {}, slots: { [subjects]: [subject("Seamanship", u.das)] } }
      await expectErrorInTx(tx, () => add(sem2), /Enter the start and end date/)
      await add({ ...sem2, start_date: await day(tx, 7), end_date: await day(tx, 120) })
      const docs = await one(
        tx,
        "select count(*)::int as n from public.documents d join public.recurring_series s on s.id = d.series_id join public.template_instances i on i.id = s.instance_id where i.name = 'Seamanship'"
      )
      assert.equal(docs.n, 0, "a semester that starts next week has no lesson plans yet")
      await tx.rollback()
    })
  })

  const datesOf = (tx, name) => one(tx, "select start_date::text as s, end_date::text as e from public.template_instances where name = $1", [name]).then((r) => [r.s, r.e])

  test("entries inside a semester can leave dates blank and take the semester's, field by field", async () => {
    await db.transaction(async (tx) => {
      const { tBatch, semesters, subjects } = await setup(tx, { subjectDates: true })
      const [start, end, ownStart, ownEnd] = [await day(tx, -14), await day(tx, 30), await day(tx, -7), await day(tx, 10)]
      const body = (...courses) => ({
        name: "2020–2023 Batch",
        uploaders: {},
        slots: { [semesters]: [{ name: "1st Semester", start_date: start, end_date: end, uploaders: {}, slots: { [subjects]: courses } }] },
      })

      // A date typed after the semester ends can't work with the end date it would inherit.
      const afterEnd = await day(tx, 40)
      await expectErrorInTx(tx, () => instantiate(tx, u.hod, body({ ...subject("Late", u.rao), start_date: afterEnd }), apg, tBatch), /end date of "Late" must be after its start date/)

      await instantiate(
        tx,
        u.hod,
        body(
          subject("Navigation", u.rao),
          { ...subject("Seamanship", u.das), end_date: ownEnd },
          { ...subject("Meteorology", u.rao), start_date: ownStart },
          { ...subject("Cargo Work", u.das), start_date: ownStart, end_date: ownEnd }
        ),
        apg,
        tBatch
      )
      assert.deepEqual(await datesOf(tx, "Navigation"), [start, end], "both blank: the semester's dates")
      assert.deepEqual(await datesOf(tx, "Seamanship"), [start, ownEnd], "blank start: the semester's start")
      assert.deepEqual(await datesOf(tx, "Meteorology"), [ownStart, end], "blank end: the semester's end")
      assert.deepEqual(await datesOf(tx, "Cargo Work"), [ownStart, ownEnd], "typed dates are kept")

      const series = await one(tx, "select s.start_date::text as s, s.end_date::text as e from public.recurring_series s join public.template_instances i on i.id = s.instance_id where i.name = 'Navigation'")
      assert.deepEqual([series.s, series.e], [start, end], "recurring files follow the inherited dates")
      await tx.rollback()
    })
  })

  test("a course added later with blank dates takes the semester's actual dates and follows later edits", async () => {
    await db.transaction(async (tx) => {
      const { tBatch, semesters, subjects } = await setup(tx, { subjectDates: true })
      const [start, end, ownEnd] = [await day(tx, -14), await day(tx, 30), await day(tx, 10)]
      const sem = { name: "1st Semester", start_date: start, end_date: end, uploaders: {}, slots: {} }
      await instantiate(tx, u.hod, { name: "2020–2023 Batch", uploaders: {}, slots: { [semesters]: [sem] } }, apg, tBatch)
      const semId = (await one(tx, "select id from public.template_instances where name = '1st Semester'")).id
      const add = (entry) => asUser(tx, u.hod, (t) => t.query("select public.add_slot_entry($1, $2, $3::jsonb)", [semId, subjects, JSON.stringify(entry)]))

      await add(subject("Navigation", u.rao))
      await add({ ...subject("Seamanship", u.das), end_date: ownEnd })
      assert.deepEqual(await datesOf(tx, "Navigation"), [start, end], "the semester's start, not today")
      assert.deepEqual(await datesOf(tx, "Seamanship"), [start, ownEnd])
      const docs = await one(
        tx,
        "select count(*)::int as n from public.documents d join public.recurring_series s on s.id = d.series_id join public.template_instances i on i.id = s.instance_id where i.name = 'Navigation'"
      )
      assert.equal(docs.n, 3, "weeks from the semester start to today")

      const [newStart, newEnd] = [await day(tx, -21), await day(tx, 45)]
      await asUser(tx, u.hod, (t) => t.query("select public.set_instance_dates($1, $2::date, $3::date)", [semId, newStart, newEnd]))
      assert.deepEqual(await datesOf(tx, "Navigation"), [newStart, newEnd], "inherited dates follow the semester")
      assert.deepEqual(await datesOf(tx, "Seamanship"), [start, ownEnd], "a course with a date of its own keeps its dates")
      await tx.rollback()
    })
  })

  describe("generating requirements from today when the start date has passed", () => {
    const lessonPlans = (tx, name) =>
      one(
        tx,
        `select count(*)::int as n, min(d.period_start)::text as first, min(d.period_end)::text as first_end
         from public.documents d join public.recurring_series s on s.id = d.series_id join public.template_instances i on i.id = s.instance_id
         where i.name = $1`,
        [name]
      )
    const syllabi = (tx, name) =>
      one(
        tx,
        "select count(*)::int as n from public.documents d join public.template_instances i on i.id = d.template_instance_id where i.name = $1 and d.series_id is null",
        [name]
      ).then((r) => r.n)
    const seriesOf = (tx, name) =>
      one(
        tx,
        "select s.start_date::text as s, s.requirements_from::text as r from public.recurring_series s join public.template_instances i on i.id = s.instance_id where i.name = $1",
        [name]
      )
    const batchWith = (semesters, subjects, start, end, requirementsFrom) => ({
      name: "2026–2029 Batch",
      ...(requirementsFrom ? { requirements_from: requirementsFrom } : {}),
      uploaders: {},
      slots: { [semesters]: [{ name: "1st Semester", start_date: start, end_date: end, uploaders: {}, slots: { [subjects]: [subject("Navigation", u.rao)] } }] },
    })

    test("today keeps the dates, starts with the current period and only adds later ones", async () => {
      await db.transaction(async (tx) => {
        const { tBatch, semesters, subjects } = await setup(tx, { subjectDates: true })
        const [start, end, today] = [await day(tx, -60), await day(tx, 60), await day(tx, 0)]
        await instantiate(tx, u.hod, batchWith(semesters, subjects, start, end, "today"), apg, tBatch)

        assert.deepEqual(await datesOf(tx, "1st Semester"), [start, end], "the semester's dates don't change")
        assert.deepEqual(await datesOf(tx, "Navigation"), [start, end])
        assert.deepEqual(await seriesOf(tx, "Navigation"), { s: start, r: today })

        const now = await lessonPlans(tx, "Navigation")
        assert.equal(now.n, 1, "only the current week")
        assert.ok(now.first <= today && today <= now.first_end, "the first requirement covers today")
        assert.equal(await syllabi(tx, "Navigation"), 1, "one-time items are still created")

        await tx.query("select public.generate_due_requirements(public.institute_today() + 21)")
        const later = await lessonPlans(tx, "Navigation")
        assert.equal(later.n, 4, "the scheduler adds the following weeks")
        assert.equal(later.first, now.first, "nothing earlier appears")
        await tx.rollback()
      })
    })

    test("start_date backfills every past period, the same as giving no choice", async () => {
      await db.transaction(async (tx) => {
        const { tBatch, semesters, subjects } = await setup(tx, { subjectDates: true })
        const [start, end] = [await day(tx, -14), await day(tx, 30)]
        await instantiate(tx, u.hod, batchWith(semesters, subjects, start, end, "start_date"), apg, tBatch)
        assert.equal((await lessonPlans(tx, "Navigation")).n, 3)
        assert.equal((await seriesOf(tx, "Navigation")).r, null)
        await tx.rollback()
      })
    })

    test("today on an entry that has already ended creates no recurring requirements, now or later", async () => {
      await db.transaction(async (tx) => {
        const { tBatch, semesters, subjects } = await setup(tx, { subjectDates: true })
        const [start, end] = [await day(tx, -60), await day(tx, -10)]
        await instantiate(tx, u.hod, batchWith(semesters, subjects, start, end, "today"), apg, tBatch)
        assert.equal((await lessonPlans(tx, "Navigation")).n, 0)
        assert.equal(await syllabi(tx, "Navigation"), 1, "one-time items are still created")
        await tx.query("select public.generate_due_requirements(public.institute_today() + 30)")
        assert.equal((await lessonPlans(tx, "Navigation")).n, 0)
        await tx.rollback()
      })
    })

    test("a start date that hasn't passed isn't limited by the choice", async () => {
      await db.transaction(async (tx) => {
        const { tBatch, semesters, subjects } = await setup(tx, { subjectDates: true })
        const [start, end] = [await day(tx, 7), await day(tx, 60)]
        await instantiate(tx, u.hod, batchWith(semesters, subjects, start, end, "today"), apg, tBatch)
        assert.deepEqual(await seriesOf(tx, "Navigation"), { s: start, r: null })
        await tx.rollback()
      })
    })

    test("adding a course later honours the choice, including with inherited dates", async () => {
      await db.transaction(async (tx) => {
        const { tBatch, semesters, subjects } = await setup(tx, { subjectDates: true })
        const [start, end, today] = [await day(tx, -60), await day(tx, 60), await day(tx, 0)]
        const sem = { name: "1st Semester", start_date: start, end_date: end, uploaders: {}, slots: {} }
        await instantiate(tx, u.hod, { name: "2026–2029 Batch", uploaders: {}, slots: { [semesters]: [sem] } }, apg, tBatch)
        const semId = (await one(tx, "select id from public.template_instances where name = '1st Semester'")).id
        const add = (entry) => asUser(tx, u.hod, (t) => t.query("select public.add_slot_entry($1, $2, $3::jsonb)", [semId, subjects, JSON.stringify(entry)]))

        await expectErrorInTx(tx, () => add({ ...subject("Bad", u.rao), requirements_from: "yesterday" }), /Choose where to generate requirements from/)
        await add({ ...subject("Navigation", u.rao), requirements_from: "today" })
        assert.deepEqual(await datesOf(tx, "Navigation"), [start, end], "still takes the semester's dates")
        assert.deepEqual(await seriesOf(tx, "Navigation"), { s: start, r: today })
        assert.equal((await lessonPlans(tx, "Navigation")).n, 1)
        await tx.rollback()
      })
    })

    test("moving the start earlier doesn't bring back periods skipped by today", async () => {
      await db.transaction(async (tx) => {
        const { tBatch, semesters, subjects } = await setup(tx, { subjectDates: true })
        const [start, end, today, earlier] = [await day(tx, -60), await day(tx, 60), await day(tx, 0), await day(tx, -90)]
        await instantiate(tx, u.hod, batchWith(semesters, subjects, start, end, "today"), apg, tBatch)
        const semId = (await one(tx, "select id from public.template_instances where name = '1st Semester'")).id

        const created = await asUser(tx, u.hod, (t) => one(t, "select public.set_instance_dates($1, $2::date, $3::date) as n", [semId, earlier, end]))
        assert.equal(created.n, 0)
        assert.equal((await lessonPlans(tx, "Navigation")).n, 1)
        assert.deepEqual(await seriesOf(tx, "Navigation"), { s: earlier, r: today }, "the dates follow; the floor stays")
        await tx.rollback()
      })
    })
  })

  test("duplicating a template node copies everything inside it, with one version bump", async () => {
    await db.transaction(async (tx) => {
      const before = (await one(tx, "select version from public.templates where id = $1", [tProgram])).version
      const copy = await asUser(tx, u.admin, (t) => one(t, "select public.duplicate_template_node($1) as id", [n.course])).then((r) => r.id)
      const row = await one(tx, "select name, (select count(*)::int from public.template_nodes where parent_id = $1) as children from public.template_nodes where id = $1", [copy])
      assert.deepEqual(row, { name: "Course (copy)", children: 1 })
      const after = (await one(tx, "select version from public.templates where id = $1", [tProgram])).version
      assert.equal(after, before + 1)
      await expectErrorInTx(tx, () => asUser(tx, u.hod, (t) => t.query("select public.duplicate_template_node($1)", [n.course])), /row-level security|permission/)
      await tx.rollback()
    })
  })
})
