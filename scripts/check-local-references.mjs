import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
const walk = (dir) => fs.readdirSync(dir, {withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):/\.(jsx?|mjs)$/.test(e.name)?[path.join(dir,e.name)]:[]);
const files = ['server.js', ...['src','routes','services','database'].flatMap(walk)];
const broken=[]; const calls=[]; const routeFiles=new Map();
function visit(n,fn){if(!n||typeof n!=='object')return; if(n.type)fn(n); for(const [k,v] of Object.entries(n)) if(k!=='loc'&&k!=='tokens') { if(Array.isArray(v))v.forEach(x=>visit(x,fn));else if(v&&typeof v==='object')visit(v,fn);}}
const value=n=>n?.type==='BinaryExpression'&&n.operator==='+'?String(value(n.left))+String(value(n.right)):n?.type==='StringLiteral'?n.value:n?.type==='TemplateLiteral'?n.quasis.map(q=>q.value.cooked).join(':dynamic'):null;
for(const file of files){
  const ast=parse(fs.readFileSync(file,'utf8'),{sourceType:'module',plugins:['jsx']});
  const imports=new Map(),routes=[],mounts=[];
  visit(ast,n=>{
    if(n.type==='ImportDeclaration'){
      const ref=n.source.value;
      if(ref.startsWith('.')){
        const target=path.resolve(path.dirname(file),ref);
        if(!fs.existsSync(target)&&!['.js','.jsx','/index.js'].some(ext=>fs.existsSync(target+ext)))broken.push({file,ref,line:n.loc.start.line});
        n.specifiers.forEach(s=>imports.set(s.local.name,target));
      }
    }
    if(n.type!=='CallExpression')return;
    const values=n.arguments[0]?.type==='ArrayExpression'?n.arguments[0].elements.map(value):[value(n.arguments[0])];
    const first=values[0];
    if(!first)return;
    if(n.callee.type==='MemberExpression'){
      const method=n.callee.property.name;
      if(['get','post','put','patch','delete','head','all'].includes(method)&&first.startsWith('/'))values.forEach(route=>routes.push({method,path:route}));
      if(method==='use'&&first.startsWith('/')) n.arguments.slice(1).forEach(arg=>mounts.push({path:first,name:arg.type==='CallExpression'?arg.callee.name:arg.name}));
    }
    if(n.callee.type==='Identifier'&&['apiRequest','fetch'].includes(n.callee.name)&&first.startsWith('/api/')){
      const method=n.arguments[1]?.properties?.find(p=>p.key?.name==='method');
      calls.push({file,line:n.loc.start.line,path:first.split('?')[0].replace(/([^/]):dynamic$/, '$1'),method:(value(method?.value)||'GET').toLowerCase()});
    }
  });
  routeFiles.set(path.resolve(file),{imports,routes,mounts});
}
const known=[];
function mount(file,prefix='',seen=new Set()){
  if(seen.has(file))return;
  const data=routeFiles.get(file);if(!data)return;
  for(const r of data.routes)known.push({...r,path:(prefix+r.path).replace(/\/$/,'')});
  for(const m of data.mounts){const target=data.imports.get(m.name);if(target)mount(target,prefix+m.path,new Set([...seen,file]));}
}
mount(path.resolve('server.js'));
const matches=(route,url)=>new RegExp('^'+route.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/:[\w]+/g,'[^/]+')+'/?$').test(url);
const unresolved=calls.filter(c=>!known.some(r=>(r.method===c.method||r.method==='all')&&(matches(r.path,c.path)||matches(c.path,r.path))));
const result={relativeImportsChecked:files.length,brokenImports:broken,apiReferences:calls.length,registeredRoutes:known.length,unresolvedApiReferences:unresolved};
fs.writeFileSync('local-reference-audit.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
