import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const testDatabaseUrl = "file:./test.db";
const testDatabasePath = resolve("prisma/test.db");
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
