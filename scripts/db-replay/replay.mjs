// Practice run: builds a brand-new database from supabase/migrations (each file
// in its own transaction, as `supabase db push` does), then loads the demo seed
// files, on a throwaway local Postgres 17. Stops at the first failure.
//
// Proves the repo alone can build the live project, and catches duplicate
// version numbers or a file that can't run on an empty database.
//
//   cd scripts/db-replay && npm install && node replay.mjs ../.. [--no-seed]
//
// Must run as a normal user (Postgres refuses to start as root).
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(process.argv[2] ?? "../..");
const withSeed = !process.argv.includes("--no-seed");
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, ".data-" + Date.now());
const port = 54329;

// Supabase runs pg_cron; plain Postgres doesn't have it. Install a stand-in
// whose cron.schedule just records the job.
const extDir = path.join(here, "node_modules/@embedded-postgres/linux-x64/native/share/postgresql/extension");
if (fs.existsSync(extDir) && !fs.existsSync(path.join(extDir, "pg_cron.control"))) {
  fs.writeFileSync(path.join(extDir, "pg_cron.control"), "default_version = '1.0'\nrelocatable = false\nschema = pg_catalog\n");
  fs.writeFileSync(
    path.join(extDir, "pg_cron--1.0.sql"),
    `create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as
 $$ insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create function cron.unschedule(job_name text) returns boolean language sql as
 $$ with d as (delete from cron.job where jobname = job_name returning 1) select exists(select 1 from d) $$;
`,
  );
}

const db = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "replay", port, persistent: false, onLog: () => {} });
await db.initialise();
await db.start();
const client = new pg.Client({ host: "localhost", port, user: "postgres", password: "replay", database: "postgres" });
await client.connect();
let failed = false;

async function runFile(label, sql) {
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
    console.log("ok   " + label);
  } catch (e) {
    await client.query("rollback").catch(() => {});
    console.log(`FAIL ${label}: ${e.message}${e.where ? " | " + e.where.split("\n")[0] : ""}`);
    failed = true;
  }
}

try {
  await client.query(fs.readFileSync(path.join(here, "supabase-stubs.sql"), "utf8"));

  const migDir = path.join(repo, "supabase/migrations");
  const files = fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
  const seen = new Map();
  for (const f of files) {
    const v = f.split("_")[0];
    if (seen.has(v)) {
      console.log(`FAIL duplicate version ${v}: ${seen.get(v)} and ${f}`);
      failed = true;
    }
    seen.set(v, f);
  }
  for (const f of files) {
    if (failed) break;
    await runFile(f, fs.readFileSync(path.join(migDir, f), "utf8"));
  }

  if (!failed && withSeed) {
    const seedDir = path.join(repo, "supabase/seed");
    // Same order as CLAUDE.md.
    for (const f of ["demo_data.sql", "demo_media.sql", "demo_photo_requests.sql", "demo_round3.sql", "demo_mls.sql", "demo_plans.sql", "demo_incentives.sql", "demo_tasks.sql", "demo_billing.sql", "demo_more_builders.sql", "demo_sales_mls.sql"]) {
      if (failed) break;
      const sql = fs.readFileSync(path.join(seedDir, f), "utf8").replaceAll("__DEMO_PASSWORD__", "replay-only");
      await runFile("seed " + f, sql);
    }
  }

  if (!failed) {
    const { rows } = await client.query(`select
      (select count(*) from pg_tables where schemaname = 'public')::int as tables,
      (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity)::int as tables_without_rls,
      (select count(*) from public.homes)::int as homes`);
    console.log("SUMMARY " + JSON.stringify(rows[0]));
    if (rows[0].tables_without_rls > 0) {
      console.log("FAIL some public tables have no row-level security");
      failed = true;
    }
  }
} finally {
  await client.end();
  await db.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
