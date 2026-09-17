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

  // First, get products to find one available for Uber
  console.log('\n=== Get products ===');
  const productsResp = await api('/api/online/products', token);
  console.log('Products load time:', productsResp.ms.toFixed(2), 'ms');
  
  const uberProduct = productsResp.data?.data?.find(p => p.availableOnUber);
  if (!uberProduct) {
    console.log('No Uber-enabled product found');
    return;
  }
  
  console.log('Using product:', uberProduct.name, 'ID:', uberProduct.id);
  
  // Create a test order
  console.log('\n=== Create test order ===');
  const createStart = process.hrtime.bigint();
  const createResp = await api('/api/online/orders', token, {
    method: 'POST',
    body: {
      platform: 'uber',
      externalOrderId: 'TEST-' + Date.now(),
      customer: { name: 'Test Customer', phone: '555-1234' },
      fulfilmentType: 'DELIVERY',
      items: [{ productId: uberProduct.id, quantity: 2, unitPrice: uberProduct.price }],
      otp: '1234'
    }
  });
  const createEnd = process.hrtime.bigint();
  console.log('Create order time:', Number(createEnd - createStart) / 1e6, 'ms');
  console.log('Status:', createResp.status);
  console.log('Response:', JSON.stringify(createResp.data));
  
  const order = createResp.data?.data?.order;
  if (!order) {
    console.log('Failed to create order');
    return;
  }
  
  console.log('Created order:', order.external_order_id, 'ID:', order.id, 'Status:', order.status);
  
  // Now test actions based on current status
  const orderId = order.id;
  
  // If status is RECEIVED, test accept
  if (order.status === 'RECEIVED') {
    console.log('\n=== Accept order ===');
    const acceptStart = process.hrtime.bigint();
    const acceptResp = await api(`/api/online/orders/${orderId}/accept`, token, {
      method: 'POST',
      body: {}
    });
    const acceptEnd = process.hrtime.bigint();
    console.log('Accept action time:', Number(acceptEnd - acceptStart) / 1e6, 'ms');
    console.log('Status:', acceptResp.status);
    console.log('Response:', JSON.stringify(acceptResp.data));
  }
  
  // Get updated order status
  const checkResp = await api(`/api/online/orders/${orderId}`, token);
  const currentOrder = checkResp.data?.data?.order;
  console.log('Current status:', currentOrder?.status);
  
  // If ACCEPTED, test preparing
  if (currentOrder?.status === 'ACCEPTED') {
    console.log('\n=== Preparing order ===');
    const prepStart = process.hrtime.bigint();
    const prepResp = await api(`/api/online/orders/${orderId}/preparing`, token, {
      method: 'POST',
      body: {}
    });
    const prepEnd = process.hrtime.bigint();
    console.log('Preparing action time:', Number(prepEnd - prepStart) / 1e6, 'ms');
    console.log('Status:', prepResp.status);
    console.log('Response:', JSON.stringify(prepResp.data));
  }
  
  // Check again
  const check2Resp = await api(`/api/online/orders/${orderId}`, token);
  const currentOrder2 = check2Resp.data?.data?.order;
  console.log('Current status:', currentOrder2?.status);
  
  // If PREPARING, test ready
  if (currentOrder2?.status === 'PREPARING') {
    console.log('\n=== Ready order ===');
    const readyStart = process.hrtime.bigint();
    const readyResp = await api(`/api/online/orders/${orderId}/ready`, token, {
      method: 'POST',
      body: {}
    });
    const readyEnd = process.hrtime.bigint();
    console.log('Ready action time:', Number(readyEnd - readyStart) / 1e6, 'ms');
    console.log('Status:', readyResp.status);
    console.log('Response:', JSON.stringify(readyResp.data));
  }
  
  // Check again
  const check3Resp = await api(`/api/online/orders/${orderId}`, token);
  const currentOrder3 = check3Resp.data?.data?.order;
  console.log('Current status:', currentOrder3?.status);
  
  // If READY, test complete with OTP
  if (currentOrder3?.status === 'READY') {
    console.log('\n=== Complete order (with OTP) ===');
    const completeStart = process.hrtime.bigint();
    const completeResp = await api(`/api/online/orders/${orderId}/complete`, token, {
      method: 'POST',
      body: { otp: '1234' }
    });
    const completeEnd = process.hrtime.bigint();
    console.log('Complete action time:', Number(completeEnd - completeStart) / 1e6, 'ms');
    console.log('Status:', completeResp.status);
    console.log('Response:', JSON.stringify(completeResp.data));
  }
  
  console.log('\n=== DONE ===');
}

main().catch(e => console.error('Error:', e.message));