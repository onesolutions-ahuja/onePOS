import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testsDirectory, "..");
const testEnvPath = path.join(projectRoot, ".env.test");

/*
 * Integration tests must never inherit the application's DATABASE_URL.
 * Loading with override=true also makes an explicitly configured .env.test
 * value authoritative when a developer's shell has another value set.
 */
delete process.env.DATABASE_URL;
const loaded = fs.existsSync(testEnvPath)
  ? dotenv.config({ path: testEnvPath, override: true })
  : { parsed: null, error: new Error("missing .env.test") };

export function requireTestDatabaseUrl(key = "DATABASE_URL") {
  if (loaded.error || !loaded.parsed?.[key] || !process.env[key]) {
    throw new Error(
      `PostgreSQL integration tests require ${key} in the separate .env.test file. ` +
      "Create .env.test with a disposable test database URL; the application .env is not used."
    );
  }
  return process.env[key];
}
