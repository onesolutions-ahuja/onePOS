const fs = require('fs');
const c = fs.readFileSync('src/pages/auth/Login.jsx', 'utf8');
const lines = c.split('\n');
const start = lines.findIndex(l => l.includes('{/* Server'));
const end = lines.findIndex(l => l.includes('{/* Customer-facing'));
console.log('Server section starts at line:', start+1);
console.log('Customer-facing starts at line:', end+1);
console.log('--- Server section ---');
for (let i = start; i < end; i++) console.log((i+1) + ': ' + lines[i]);
