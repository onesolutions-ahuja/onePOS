// Read-only probe: forge a token for the admin user and hit the report
// endpoints on the running local server. No data is written.
import pg from "pg";
import jwt from "jsonwebtoken";
import fs from "fs";

const env = fs.readFileSync(".env", "utf8");
const get = (key) => (env.match(new RegExp("^" + key + "=(.*)$", "m")) || [])[1];

const pool = new pg.Pool({
  connectionString: get("DATABASE_URL"),
  ssl: { rejectUnauthorized: false },
});

const q = await pool.query(
  `SELECT u.id, u.company_id, u.store_id, u.role_id, u.username, COALESCE(r.name,'') AS role_name
   FROM users u LEFT JOIN roles r ON r.id = u.role_id
   ORDER BY (LOWER(COALESCE(r.name,'')) IN ('administrator','admin','owner')) DESC, u.username
   LIMIT 1`
);

const user = q.rows[0];
const token = jwt.sign(
  { id: user.id, companyId: user.company_id, storeId: user.store_id, roleId: user.role_id, username: user.username },
  get("JWT_SECRET"),
  { expiresIn: "1h" }
);
fs.writeFileSync(".repcheck-token", token);
console.log("TOKEN READY for:", user.username, "/", user.role_name, "storeId:", user.store_id);
await pool.end();
