const fs = require('fs');
const dir = require('path').dirname(__filename || require('path').resolve('.'));
const testPath = require('path').join(dir, 'tests', 'deviceServerConfig.test.mjs');

let src = fs.readFileSync(testPath, 'utf8');

// Fix 1: AdminLayout regex - use [^>]* instead of [^}]* to handle key={settingsTab}
src = src.replace(
  /assert\.match\(adminLayout, \/<SettingsAdmin\[\^\}\]\*isAdmin=/,
  'assert.match(adminLayout, /<SettingsAdmin[^>]*isAdmin='
);

// Fix 2: ServerApiSettings slice - find runHealthCheck AFTER handleSave
// Replace the slice logic to search from handleSave position onwards
const oldSlice = "const saveBlock = serverApiSettings.slice(serverApiSettings.indexOf('const handleSave = async () => {'), serverApiSettings.indexOf('const runHealthCheck'));";
const newSlice = "const handleSavePos = serverApiSettings.indexOf('const handleSave = async () => {');\n    const runHealthCheckPos = serverApiSettings.indexOf('const runHealthCheck', handleSavePos);\n    const saveBlock = serverApiSettings.slice(handleSavePos, runHealthCheckPos);";
src = src.replace(oldSlice, newSlice);

fs.writeFileSync(testPath, src);
console.log('Fixed 2 test issues in deviceServerConfig.test.mjs');
