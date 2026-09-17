import http from 'http';

async function api(path, token, options = {}) {
  const body = options.body ? JSON.stringify(options.body) : null;
  const headers = { 'Content-Type': 'application/json' };
  if (body) headers['Content-Length'] = Buffer.byteLength(body);
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return new Promise((resolve, reject) => {
    const start = process.hrtime.bigint();
    const req = http.request('http://localhost:10007' + path, {
      method: options.method || 'GET',
      headers
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const end = process.hrtime.bigint();
        const ms = Number(end - start) / 1e6;
        try { resolve({ status: res.statusCode, data: JSON.parse(data || '{}'), ms }); }
        catch(e) { resolve({ status: res.statusCode, data: {}, ms }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function login(username, password) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ username, password });
    const req = http.request('http://localhost:10007/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { const json = JSON.parse(data); resolve(json.token || null); }
        catch(e) { reject(new Error('Login parse: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('=== Login ===');
  const token = await login('admin', 'Admin12345');
  console.log('Token:', token ? 'obtained' : 'FAILED');

  // Get an order in READY state to test completion
  console.log('\n=== Get orders ===');
  const ordersResp = await api('/api/online/orders', token);
  console.log('Orders load time:', ordersResp.ms.toFixed(2), 'ms');
  
  const readyOrder = ordersResp.data?.data?.find(o => o.status === 'READY');
  if (!readyOrder) {
    console.log('No READY order found. Creating one...');
    // We'd need to create an order first - skip for now
    return;
  }
  
  console.log('Testing with order:', readyOrder.external_order_id, 'ID:', readyOrder.id);
  
  // Test complete action timing
  console.log('\n=== Complete order (with OTP) ===');
  const completeStart = process.hrtime.bigint();
  const completeResp = await api(`/api/online/orders/${readyOrder.id}/complete`, token, {
    method: 'POST',
    body: { otp: '1234' }
  });
  const completeEnd = process.hrtime.bigint();
  console.log('Complete action time:', Number(completeEnd - completeStart) / 1e6, 'ms');
  console.log('Status:', completeResp.status);
  console.log('Response:', JSON.stringify(completeResp.data));
  
  // Test accept action timing
  console.log('\n=== Accept order ===');
  const acceptOrder = ordersResp.data?.data?.find(o => o.status === 'RECEIVED');
  if (acceptOrder) {
    const acceptStart = process.hrtime.bigint();
    const acceptResp = await api(`/api/online/orders/${acceptOrder.id}/accept`, token, {
      method: 'POST',
      body: {}
    });
    const acceptEnd = process.hrtime.bigint();
    console.log('Accept action time:', Number(acceptEnd - acceptStart) / 1e6, 'ms');
    console.log('Status:', acceptResp.status);
    console.log('Response:', JSON.stringify(acceptResp.data));
  }
  
  // Test reject action timing
  console.log('\n=== Reject order ===');
  const rejectOrder = ordersResp.data?.data?.find(o => o.status === 'RECEIVED' || o.status === 'ACCEPTED');
  if (rejectOrder) {
    const rejectStart = process.hrtime.bigint();
    const rejectResp = await api(`/api/online/orders/${rejectOrder.id}/reject`, token, {
      method: 'POST',
      body: { reason: 'Test rejection' }
    });
    const rejectEnd = process.hrtime.bigint();
    console.log('Reject action time:', Number(rejectEnd - rejectStart) / 1e6, 'ms');
    console.log('Status:', rejectResp.status);
    console.log('Response:', JSON.stringify(rejectResp.data));
  }
  
  // Test ready action timing
  console.log('\n=== Ready order ===');
  const readyForReady = ordersResp.data?.data?.find(o => o.status === 'ACCEPTED' || o.status === 'PREPARING');
  if (readyForReady) {
    const readyStart = process.hrtime.bigint();
    const readyResp = await api(`/api/online/orders/${readyForReady.id}/ready`, token, {
      method: 'POST',
      body: {}
    });
    const readyEnd = process.hrtime.bigint();
    console.log('Ready action time:', Number(readyEnd - readyStart) / 1e6, 'ms');
    console.log('Status:', readyResp.status);
    console.log('Response:', JSON.stringify(readyResp.data));
  }
  
  // Test cancel action timing
  console.log('\n=== Cancel order ===');
  const cancelOrder = ordersResp.data?.data?.find(o => ['RECEIVED', 'ACCEPTED', 'PREPARING', 'READY'].includes(o.status));
  if (cancelOrder) {
    const cancelStart = process.hrtime.bigint();
    const cancelResp = await api(`/api/online/orders/${cancelOrder.id}/cancel`, token, {
      method: 'POST',
      body: { reason: 'Test cancellation' }
    });
    const cancelEnd = process.hrtime.bigint();
    console.log('Cancel action time:', Number(cancelEnd - cancelStart) / 1e6, 'ms');
    console.log('Status:', cancelResp.status);
    console.log('Response:', JSON.stringify(cancelResp.data));
  }
  
  console.log('\n=== DONE ===');
}

main().catch(e => console.error('Error:', e.message));