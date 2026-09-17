import pg from "pg";
import fs from "fs";
import bcrypt from "bcryptjs";
const raw = fs.readFileSync(".env", "utf8");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const r = await pool.query("SELECT id,username,password_hash,active FROM users");
for (const u of r.rows) console.log(u.id, u.username, u.active, (u.password_hash||"").slice(0,12));
// reset admin to known pw for live testing
const hash = await bcrypt.hash("Admin12345", 10);
await pool.query("UPDATE users SET password_hash=$1, active=TRUE WHERE username='admin'", [hash]);
console.log("admin reset done");
await pool.end();
