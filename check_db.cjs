const { Client } = require('pg');
const c = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
c.connect().then(async () => {
  const col = await c.query('SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2', ['companies', 'logo_url']);
  console.log('logo_url column exists:', col.rows.length > 0);
  
  const companies = await c.query('SELECT id, name, logo_url FROM companies');
  console.log('Companies:', JSON.stringify(companies.rows, null, 2));
  await c.end();
}).catch(e => console.error(e.message));
