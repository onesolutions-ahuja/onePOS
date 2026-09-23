import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import bcrypt from 'bcryptjs';
import {createAuthenticate, createSessionToken, signSessionPayload} from '../services/session.js';
import {createAuthenticatedDatabaseMiddleware, getRequestPool} from '../services/tenantDatabase.js';
import {createChangePasswordHandler} from '../services/changePassword.js';

test('existing forced-change sessions can continue; identity password changes use central accounts, business calls retain tenant routing', async () => {
  let hash=await bcrypt.hash('fixture-current',4);
  let tenantResolutions=0;
  const control={query:async(sql,params)=>{
    if(sql.includes('SELECT')) return {rows:params[0]==='fixture-user'?[{id:'fixture-user',password_hash:hash}]:[]};
    assert.equal(params[1],'fixture-user'); hash=params[0]; return {rows:[]};
  }};
  const tenant={query:async()=>{throw new Error('Identity lookup incorrectly reached tenant database');}};
  const auth=createAuthenticate({onAuthenticated:createAuthenticatedDatabaseMiddleware({pool:control,router:{resolveForCompany:async()=>{
    tenantResolutions++;return {pool:tenant,companyId:'fixture-company'};
  }}})});
  const app=express();app.use(express.json());
  app.post('/api/auth/change-password',auth,createChangePasswordHandler({bcrypt,db:(...args)=>getRequestPool(control).query(...args)}));
  app.get('/api/products',auth,(req,res)=>res.json({tenant:getRequestPool(control)===tenant}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const token=signSessionPayload({id:'fixture-user',companyId:'fixture-company',mustChangePassword:true});
  const url=`http://127.0.0.1:${server.address().port}`;
  const change=async(currentPassword,newPassword,authorization=token)=>fetch(url+'/api/auth/change-password',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${authorization}`},body:JSON.stringify({currentPassword,newPassword})});
  try {
    assert.equal((await change('wrong','fixture-next')).status,401);
    assert.equal((await change('fixture-current','short')).status,400);
    assert.equal((await change('fixture-current','fixture-next','invalid-token')).status,401);
    const saved=await change('fixture-current','fixture-next');
    assert.equal(saved.status,200);assert.equal((await saved.json()).success,true);
    assert.ok(await bcrypt.compare('fixture-next',hash));
    assert.equal(tenantResolutions,0);
    const business=await fetch(url+'/api/products',{headers:{Authorization:`Bearer ${token}`}});
    assert.equal(business.status,200);assert.equal((await business.json()).tenant,true);assert.equal(tenantResolutions,1);
    const fresh=createSessionToken({id:'fixture-user',must_change_password:true});
    const payload=JSON.parse(Buffer.from(fresh.split('.')[1],'base64url'));
    assert.equal(payload.mustChangePassword,false);
  } finally {await new Promise(r=>server.close(r));}
});
