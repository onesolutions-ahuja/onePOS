const http = require('http');

async function api(path, options = {}) {
  const body = options.body ? JSON.stringify(options.body) : null;
  const token = options.token;
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const req = http.request('http://localhost:10003' + path, {
      method: options.method || 'GET',
      headers
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data || '{}') }); }
        catch(e) { reject(new Error('Parse: ' + data)); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  // Login
  console.log('=== 1. Login ===');
  const loginBody = JSON.stringify({ username: 'admin', password: 'Admin12345' });
  const token = await new Promise((resolve, reject) => {
    const req = http.request('http://localhost:10003/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginBody) }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data).token));
    });
    req.on('error', reject);
    req.write(loginBody);
    req.end();
  });
  console.log('Token:', token ? 'obtained' : 'FAILED');

  // 2. GET categories (active only - for product selector)
  console.log('\n=== 2. GET /api/categories (active only) ===');
  const active = await api('/api/categories', { token });
  console.log('Status:', active.status, 'success:', active.data.success, 'count:', active.data.data?.length);

  // 3. GET categories?all=true (all categories with product count)
  console.log('\n=== 3. GET /api/categories?all=true (all) ===');
  const all = await api('/api/categories?all=true', { token });
  console.log('Status:', all.status, 'success:', all.data.success, 'count:', all.data.data?.length);

  // 4. POST - Create new category
  console.log('\n=== 4. POST /api/categories (create) ===');
  const testName = 'TestCategory_' + Date.now();
  const created = await api('/api/categories', { method: 'POST', token, body: { name: testName, displayOrder: 99 } });
  console.log('Status:', created.status, 'success:', created.data.success);
  const categoryId = created.data?.data?.id;

  // 5. PUT - Update category (rename)
  console.log('\n=== 5. PUT /api/categories/:id (rename) ===');
  const updated = await api(`/api/categories/${categoryId}`, { method: 'PUT', token, body: { name: 'Renamed Category', displayOrder: 50, active: true } });
  console.log('Status:', updated.status, 'success:', updated.data.success, 'name:', updated.data?.data?.name);

  // 6. PUT - Deactivate category
  console.log('\n=== 6. PUT /api/categories/:id (deactivate) ===');
  const deactivated = await api(`/api/categories/${categoryId}`, { method: 'PUT', token, body: { name: 'Renamed Category', displayOrder: 50, active: false } });
  console.log('Status:', deactivated.status, 'success:', deactivated.data.success, 'active:', deactivated.data?.data?.active);

  // 7. DELETE - Soft delete
  console.log('\n=== 7. DELETE /api/categories/:id (soft delete) ===');
  const deleted = await api(`/api/categories/${categoryId}`, { method: 'DELETE', token });
  console.log('Status:', deleted.status, 'success:', deleted.data.success);

  // 8. Verify inactive category no longer appears in active list
  console.log('\n=== 8. GET /api/categories (active only - verify removed) ===');
  const afterDelete = await api('/api/categories', { token });
  const found = afterDelete.data?.data?.find(c => c.name === 'Renamed Category');
  console.log('Status:', afterDelete.status, 'deleted category in active list:', !!found);

  // 9. Verify inactive category still appears with ?all=true
  console.log('\n=== 9. GET /api/categories?all=true (verify inactive present) ===');
  const allAfter = await api('/api/categories?all=true', { token });
  const foundInactive = allAfter.data?.data?.find(c => c.name === 'Renamed Category');
  console.log('Status:', allAfter.status, 'inactive category present:', !!foundInactive, 'active:', foundInactive?.active);

  console.log('\n=== ALL TESTS COMPLETE ===');
}

main().catch(e => console.error('Error:', e.message));
