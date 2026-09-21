const fs = require('fs');

// Read as buffer to handle \r\n correctly
const buf = fs.readFileSync('src/pages/settings/SettingsAdmin.jsx');
const content = buf.toString('utf16le');
const decoder = new TextDecoder('utf8');

// Find and remove the duplicate button block
// The block to remove starts after "                ])}\r\n" and ends before "              ))}\r\n"
// We need to find: "                ])}\r\n                <button ... </button>\r\n              ))}\r\n"
// And replace with: "                ])}\r\n              ))}\r\n"

// Use index-based approach
const str = buf.toString('utf8');

// The exact duplicate block to remove (between the spread's ])} and the closing ))}
const searchStart = '                ])}\r\n                <button';
const idx = str.indexOf(searchStart);
if (idx === -1) {
  console.log('START PATTERN NOT FOUND');
  // Show context
  const lines = str.split('\n');
  for (let i = 154; i <= 178; i++) {
    if (lines[i]) console.log((i+1) + ': ' + JSON.stringify(lines[i]));
  }
} else {
  // Find the end of the duplicate: the "</button>\r\n" followed by "              ))}\r\n"
  const endSearch = '</button>\r\n              ))}\r\n';
  const endIdx = str.indexOf(endSearch, idx);
  if (endIdx === -1) {
    console.log('END PATTERN NOT FOUND');
  } else {
    // The duplicate spans from after "                ])}\r\n" to "</button>\r\n"
    // We want to keep: "                ])}\r\n" and "              ))}\r\n"
    // Remove: "\r\n                <button...</button>\r\n" 
    const before = str.substring(0, idx + '                ])}\r\n'.length);
    const after = str.substring(endIdx + '</button>\r\n'.length);
    // After "</button>\r\n" comes "              ))}\r\n" which we want to keep
    // But we need to also remove the extra newline/indent before "              ))}\r\n"
    // Actually, let me think again...
    // Full text around the area:
    // "                ])}\r\n                <button...</button>\r\n              ))}\r\n"
    // We want:
    // "                ])}\r\n              ))}\r\n"
    // So we remove: "\r\n                <button...</button>" (everything between ])}\r\n and the \r\n before ))})
    
    // Find the position right after "                ])}\r\n"
    const startPos = idx + '                ])}\r\n'.length;
    // Find "</button>\r\n" 
    const buttonEnd = str.indexOf('</button>\r\n', idx);
    // Find "              ))}\r\n" after that
    const closingBrace = str.indexOf('              ))}\r\n', buttonEnd);
    
    if (closingBrace !== -1) {
      // Remove from startPos to closingBrace
      const result = str.substring(0, startPos) + str.substring(closingBrace);
      fs.writeFileSync('src/pages/settings/SettingsAdmin.jsx', result);
      console.log('FIXED');
    } else {
      console.log('CLOSING BRACE NOT FOUND');
    }
  }
}
