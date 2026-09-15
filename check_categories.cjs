const { Client } = require('pg');
const c = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
c.connect().then(async () => {
  const r = await c.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'categories'
    ORDER BY ordinal_position
  `);
  console.log('Categories table columns:', JSON.stringify(r.rows, null, 2));
  await c.end();
}).catch(e => console.error(e.message));
