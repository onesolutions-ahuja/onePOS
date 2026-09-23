import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import createSuperadminRouter from '../routes/superadmin.js';

test('company user directory requires platform access and scopes its query to the selected company', async () => {
  for (const allowed of [false, true]) {
    const queries = [];
    const app = express();
    app.use('/api', createSuperadminRouter({
      authenticate: (req, res, next) => { req.user = {id:'operator'}; next(); },
      db: async (sql, params) => {
        if (sql.startsWith('SELECT is_superadmin')) return {rows:[{is_superadmin:allowed}]};
        queries.push({sql, params});
        return {rows:[{id:'admin',email:'admin@example.com',role_name:'Administrator',active:true}]};
      },
    }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/superadmin/companies/selected-company/users`);
      assert.equal(response.status, allowed ? 200 : 403);
      const body = await response.json();
      if (allowed) {
        assert.equal(body.data[0].email, 'admin@example.com');
        assert.deepEqual(queries[0].params, ['selected-company']);
        assert.match(queries[0].sql, /u.company_id=\$1 AND u.is_superadmin=false/);
        assert.doesNotMatch(queries[0].sql, /password|SELECT\s+\*/i);
      } else assert.equal(queries.length, 0);
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
});
