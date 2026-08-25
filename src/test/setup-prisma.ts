import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const testDatabasePath = resolve("prisma/test.db");
// Use an absolute URL so generated Prisma clients cannot resolve the relative
// path against node_modules/.prisma/client and open an empty shadow database.
const testDatabaseUrl = `file:${testDatabasePath}`;
const migrationsPath = resolve("prisma/migrations");

process.env.DATABASE_URL = testDatabaseUrl;

if (existsSync(testDatabasePath)) {
  rmSync(testDatabasePath);
}

const migrationSql = readdirSync(migrationsPath)
  .filter((name) => /^\d+_/.test(name))
  .sort()
  .map((name) => readFileSync(join(migrationsPath, name, "migration.sql"), "utf8"))
  .join("\n");

execFileSync("sqlite3", [testDatabasePath], {
  input: migrationSql,
  stdio: ["pipe", "pipe", "pipe"],
});
