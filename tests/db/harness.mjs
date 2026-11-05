// In-memory Postgres (PGlite) harness for testing migrations, triggers and RLS
// without Docker. It stubs the parts of Supabase the migrations depend on:
// the anon/authenticated roles, auth.users and auth.uid().
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
import { PGlite } from "@electric-sql/pglite"
import { ltree } from "@electric-sql/pglite/contrib/ltree"
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const migrationsDir = path.join(root, "supabase", "migrations")

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create schema extensions;
  create table auth.users (id uuid primary key, email text unique);
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean, file_size_limit bigint);
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  grant usage on schema public, auth, extensions to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`

/** The migrations in order. With `before`, stops short of that file, to test it against existing data. */
export async function createDb({ before } = {}) {
  const db = new PGlite({ extensions: { ltree, pg_trgm } })
  await db.exec(SUPABASE_STUBS)
  // Supabase's default search_path
  await db.exec(`set search_path = "$user", public, extensions`)
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql") && (!before || f < before)).sort()
  for (const file of files) {
    try {
      await db.exec(await readFile(path.join(migrationsDir, file), "utf8"))
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${err.message}`)
    }
  }
  return db
}

export async function applyMigration(db, file) {
  await db.exec(await readFile(path.join(migrationsDir, file), "utf8"))
}

/**
 * Run fn as an authenticated user (RLS applies). Opens its own transaction, or,
 * when given an open transaction, switches role inside it and switches back after.
 */
export async function asUser(db, userId, fn) {
  const run = async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId])
    await tx.exec("set local role authenticated")
    try {
      return await fn(tx)
    } finally {
      try {
        await tx.exec("reset role")
        await tx.query("select set_config('request.jwt.claim.sub', '', true)")
      } catch {
        // transaction already aborted; the original error is what matters
      }
    }
  }
  return typeof db.transaction === "function" ? db.transaction(run) : run(db)
}

export async function expectError(promise, pattern) {
  await assert.rejects(promise, (err) => {
    assert.match(err.message, pattern)
    return true
  })
}

/** expectError inside an open transaction, rolling back to a savepoint so the transaction stays usable. */
export async function expectErrorInTx(tx, run, pattern) {
  await tx.exec("savepoint expect_error")
  await expectError(run(), pattern)
  await tx.exec("rollback to savepoint expect_error")
}

export async function one(db, sql, params = []) {
  const { rows } = await db.query(sql, params)
  return rows[0]
}

/** Create an auth user + profile as the database owner (bypasses RLS). */
export async function createUser(db, { name, deptId, reportsTo = null }) {
  const { id } = await one(db, "select gen_random_uuid() as id")
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}@test.local`
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email])
  await db.query(
    `insert into public.profiles (id, full_name, email, department_id, reports_to_id)
     values ($1, $2, $3, $4, $5)`,
    [id, name, email, deptId, reportsTo]
  )
  return id
}

export async function createDept(db, name, code) {
  const row = await one(db, "insert into public.departments (name, code) values ($1, $2) returning id", [name, code])
  return row.id
}

export async function grantSystemRole(db, userId, systemKey) {
  await db.query(
    `insert into public.user_roles (user_id, role_id)
     select $1, id from public.roles where system_key = $2`,
    [userId, systemKey]
  )
}
