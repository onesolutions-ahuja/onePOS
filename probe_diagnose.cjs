require('dotenv').config();
const { pool } = require('./src/db');
(async () => {
  try {
    const r = await pool.query("SELECT id, provider, status, external_id, created_at FROM online_orders ORDER BY created_at DESC LIMIT 12");
    console.log(JSON.stringify(r.rows, null, 1));
    const cols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='online_orders'");
    console.log('COLS:', cols.rows.map(c=>c.column_name+':'+c.data_type).join(', '));
  } catch (e) { console.error('ERR', e.message); }
  await pool.end();
})();
