const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://onepos:PJ5E91lpTYN6je6PAXRaabDJxNJ4u5BL@dpg-dajvtrlg1s2s73ccsfmg-a.oregon-postgres.render.com/onepos',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function timeQuery(label, query, params) {
  const start = Date.now();
  try {
    const result = await pool.query(query, params);
    const ms = Date.now() - start;
    console.log(`${label}: ${ms}ms (rows: ${result.rowCount})`);
    return result;
  } catch (err) {
    const ms = Date.now() - start;
    console.log(`${label}: ${ms}ms ERROR: ${err.message}`);
    throw err;
  }
}

async function test() {
  console.log('=== Testing individual query performance ===\n');
  
  // Test 1: Simple select
  await timeQuery('Simple select 1', 'SELECT 1');
  
  // Test 2: Load platform config (similar to loadPlatformConfig)
  await timeQuery('Load platform config', `
    SELECT active, configuration FROM integrations WHERE company_id = $1 AND provider = $2 LIMIT 1
  `, ['b4a67538-0915-4dee-9ac4-0bf2ae3cf87f', 'uber']);
  
  // Test 3: Lock order row (FOR UPDATE NOWAIT)
  // First get an order ID
  const orderResult = await pool.query("SELECT id FROM online_orders WHERE company_id = $1 AND status IN ('ACCEPTED','PREPARING','READY') LIMIT 1", ['b4a67538-0915-4dee-9ac4-0bf2ae3cf87f']);
  if (orderResult.rows.length) {
    const orderId = orderResult.rows[0].id;
    console.log(`\nTesting with order: ${orderId}`);
    
    // Test 4: Lock order row
    await timeQuery('Lock order row (FOR UPDATE NOWAIT)', 
      'SELECT * FROM online_orders WHERE id = $1 AND company_id = $2 FOR UPDATE NOWAIT',
      [orderId, 'b4a67538-0915-4dee-9ac4-0bf2ae3cf87f']);
    
    // Test 5: Load order items
    await timeQuery('Load order items', 
      `SELECT i.*, p.track_stock FROM online_order_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.order_id = $1 ORDER BY i.created_at, i.id`,
      [orderId]);
    
    // Test 6: Update order status
    await timeQuery('Update order status', 
      'UPDATE online_orders SET status = $2, updated_at = NOW() WHERE id = $1 AND company_id = $3',
      [orderId, 'PREPARING', 'b4a67538-0915-4dee-9ac4-0bf2ae3cf87f']);
    
    // Test 7: Load order
    await timeQuery('Load order', 
      'SELECT * FROM online_orders WHERE id = $1 AND company_id = $2',
      [orderId, 'b4a67538-0915-4dee-9ac4-0bf2ae3cf87f']);
  }
  
  // Test 8: Insert into platform_api_logs (simulated logging)
  await timeQuery('Insert platform_api_logs', 
    `INSERT INTO platform_api_logs (company_id, platform, environment, action, endpoint, http_method, request_payload, response_body, success, error_message, order_id, product_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    ['b4a67538-0915-4dee-9ac4-0bf2ae3cf87f', 'uber', 'sandbox', 'MARK_PREPARING', 'stub://uber/MARK_PREPARING', 'STUB', '{}', '{"success":true}', true, null, 'test-order-id', null]);
  
  await pool.end();
  console.log('\n=== Done ===');
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});