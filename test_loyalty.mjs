import http from 'http';

async function api(path, token, options = {}) {
  const body = options.body ? JSON.stringify(options.body) : null;
  const headers = { 'Content-Type': 'application/json' };
  if (body) headers['Content-Length'] = Buffer.byteLength(body);
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return new Promise((resolve, reject) => {
    const req = http.request('http://localhost:10008' + path, {
      method: options.method || 'GET',
      headers
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data || '{}') }); }
        catch(e) { resolve({ status: res.statusCode, data: {} }); }
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
    const req = http.request('http://localhost:10008/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { const json = JSON.parse(data); resolve({ token: json.token, status: res.statusCode }); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('=== Login ===');
  const { token, status } = await login('admin', 'Admin12345');
  console.log('Login:', status);

  console.log('\n=== 1. GET /api/settings (initial state) ===');
  const initial = await api('/api/settings', token);
  console.log('Status:', initial.status);
  console.log('Loyalty:', JSON.stringify(initial.data?.data?.loyalty));

  console.log('\n=== 2. PUT /api/settings (enable loyalty, 1%) ===');
  const current = initial.data?.data;
  const update1 = await api('/api/settings', token, {
    method: 'PUT',
    body: {
      companyName: current.company.name,
      legalName: current.company.legalName,
      companyEmail: current.company.email,
      companyPhone: current.company.phone,
      currency: current.company.currency,
      timezone: current.company.timezone,
      dateFormat: current.general.dateFormat,
      vatEnabled: current.tax.vatEnabled,
      defaultVatRate: current.tax.defaultVatRate,
      loyaltyEnabled: true,
      loyaltyEarningRate: 0.01,
      logoUrl: current.company.logoUrl
    }
  });
  console.log('Status:', update1.status);
  console.log('Message:', update1.data?.message);

  console.log('\n=== 3. GET /api/settings (verify enabled + 1%) ===');
  const verify1 = await api('/api/settings', token);
  console.log('Status:', verify1.status);
  console.log('Loyalty:', JSON.stringify(verify1.data?.data?.loyalty));

  console.log('\n=== 4. PUT /api/settings (disable loyalty) ===');
  const current2 = verify1.data?.data;
  const update2 = await api('/api/settings', token, {
    method: 'PUT',
    body: {
      companyName: current2.company.name,
      legalName: current2.company.legalName,
      companyEmail: current2.company.email,
      companyPhone: current2.company.phone,
      currency: current2.company.currency,
      timezone: current2.company.timezone,
      dateFormat: current2.general.dateFormat,
      vatEnabled: current2.tax.vatEnabled,
      defaultVatRate: current2.tax.defaultVatRate,
      loyaltyEnabled: false,
      loyaltyEarningRate: 0.01,
      logoUrl: current2.company.logoUrl
    }
  });
  console.log('Status:', update2.status);
  console.log('Message:', update2.data?.message);

  console.log('\n=== 5. GET /api/settings (verify disabled) ===');
  const verify2 = await api('/api/settings', token);
  console.log('Status:', verify2.status);
  console.log('Loyalty:', JSON.stringify(verify2.data?.data?.loyalty));

  console.log('\n=== 6. Test validation (rate > 100%) ===');
  const current3 = verify2.data?.data;
  const invalid = await api('/api/settings', token, {
    method: 'PUT',
    body: {
      companyName: current3.company.name,
      legalName: current3.company.legalName,
      companyEmail: current3.company.email,
      companyPhone: current3.company.phone,
      currency: current3.company.currency,
      timezone: current3.company.timezone,
      dateFormat: current3.general.dateFormat,
      vatEnabled: current3.tax.vatEnabled,
      defaultVatRate: current3.tax.defaultVatRate,
      loyaltyEnabled: true,
      loyaltyEarningRate: 1.5, // 150% - should fail
      logoUrl: current3.company.logoUrl
    }
  });
  console.log('Status:', invalid.status);
  console.log('Message:', invalid.data?.message);

  console.log('\n=== 7. Test unauthorized (no token) ===');
  const noAuth = await api('/api/settings');
  console.log('Status:', noAuth.status);

  console.log('\n=== ALL TESTS PASSED ===');
}

main().catch(e => console.error('Error:', e.message));