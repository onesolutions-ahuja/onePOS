import pg from "pg";
import fs from "fs";
const raw = fs.readFileSync(".env", "utf8");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}
export const ENV = env;
export const BASE = "http://localhost:10000";
export const PW = "Admin12345";
export async function login() {
  const r = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: PW }) });
  const t = await r.text();
  console.log("LOGIN", r.status, t.slice(0, 300));
  return JSON.parse(t);
}
