const fs = require('fs');
const p = 'src/pages/settings/SettingsAdmin.jsx';
let src = fs.readFileSync(p, 'utf8');
const oldSig = 'function SettingsAdmin({ initialTab = "General" })';
const newSig = 'function SettingsAdmin({ initialTab = "General", isAdmin = false })';
if (src.includes(oldSig)) {
  src = src.replace(oldSig, newSig);
  fs.writeFileSync(p, src);
  console.log('Fixed: added isAdmin = false to SettingsAdmin destructuring');
} else if (src.includes(newSig)) {
  console.log('Already fixed: isAdmin = false present in SettingsAdmin destructuring');
} else {
  console.log('ERROR: neither old nor new signature found');
  process.exit(1);
}
