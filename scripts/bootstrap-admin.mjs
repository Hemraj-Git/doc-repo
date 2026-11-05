// Creates the first Super Admin and the "Administration" department they belong to.
// Run once, after applying the migrations:
//
//   npm run bootstrap:admin -- --email admin@institute.edu --name "Jane Doe" [--password "…"]
//
// Without --password a temporary one is generated and must be changed at first sign-in.
import { randomBytes } from "node:crypto"
import { parseArgs } from "node:util"
import { createClient } from "@supabase/supabase-js"

const { values: args } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    password: { type: "string" },
    "dept-name": { type: "string", default: "Administration" },
    "dept-code": { type: "string", default: "ADMIN" },
  },
})

function fail(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secret = process.env.SUPABASE_SECRET_KEY
if (!url || !secret) fail("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local")
if (!args.email || !args.name) fail('Usage: npm run bootstrap:admin -- --email <email> --name "<full name>" [--password <pw>]')

const email = args.email.trim().toLowerCase()
const generated = !args.password
const password = args.password ?? `${randomBytes(9).toString("base64url")}aA1`
// Same rule as src/lib/validation/auth.ts. A weaker supplied password is accepted
// but treated as temporary, so it must be replaced at first sign-in.
const meetsPolicy = password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password)
const mustChange = generated || !meetsPolicy

// supabase-js refuses to start without a global WebSocket (Node < 22). This script never uses
// realtime, so on older Node hand it a stand-in that fails loudly if it is ever opened.
class NoRealtime {
  constructor() {
    throw new Error("Realtime is not available in this script")
  }
}

const db = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: globalThis.WebSocket ?? NoRealtime },
})

async function must(promise, what) {
  const { data, error } = await promise
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

async function main() {
  const superAdminRole = await must(
    db.from("roles").select("id").eq("system_key", "super_admin").single(),
    "Loading the Super Admin role (have the migrations been applied?)"
  )

  const existing = await must(
    db.from("user_roles").select("user_id").eq("role_id", superAdminRole.id).limit(1),
    "Checking for existing Super Admins"
  )
  if (existing.length > 0) fail("A Super Admin already exists. Add further admins from the Users screen.")

  let dept = await must(
    db.from("departments").select("id, name").eq("code", args["dept-code"]).maybeSingle(),
    "Looking up the department"
  )
  if (!dept) {
    dept = await must(
      db.from("departments").insert({ name: args["dept-name"], code: args["dept-code"] }).select("id, name").single(),
      "Creating the department"
    )
  }

  const created = await must(
    db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: args.name } }),
    "Creating the auth user"
  )
  const userId = created.user.id

  try {
    await must(
      db.from("profiles").insert({
        id: userId,
        full_name: args.name,
        email,
        department_id: dept.id,
        must_change_password: mustChange,
      }),
      "Creating the profile"
    )
    await must(db.from("user_roles").insert({ user_id: userId, role_id: superAdminRole.id }), "Granting Super Admin")
    await must(db.from("departments").update({ head_user_id: userId }).eq("id", dept.id), "Setting the department head")
  } catch (err) {
    // Profile is restricted from cascading, so remove it first if it was created.
    await db.from("profiles").delete().eq("id", userId)
    await db.auth.admin.deleteUser(userId)
    fail(`${err.message}\n  The partially created account was removed.`)
  }

  console.log(`
✔ Super Admin created

  Name        ${args.name}
  Email       ${email}
  Department  ${dept.name} (head)
  Password    ${
    generated
      ? `${password}   ← temporary, must be changed at first sign-in`
      : mustChange
        ? "(as provided) — below the password policy, so it must be changed at first sign-in"
        : "(as provided)"
  }
`)
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
