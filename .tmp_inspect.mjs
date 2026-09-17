import fs from 'node:fs';
const s = fs.readFileSync('src/pages/online/OnlineOrdersAdmin.jsx', 'utf8');
const lines = s.split(/\r?\n/);
console.log('=== 78-130 ===');
for (let i = 77; i < 130 && i < lines.length; i++) console.log((i+1) + ': ' + lines[i]);





