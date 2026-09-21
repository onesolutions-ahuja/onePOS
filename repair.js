const fs = require('fs');

// Fix adminRoutes.js - remove duplicate Server/API Configuration entries
let routes = fs.readFileSync('src/utils/adminRoutes.js', 'utf8');
const lines = routes.split('\n');
const result = [];
let seenServerApi = false;
for (const line of lines) {
  if (line.includes('"Server / API Configuration"')) {
    if (!seenServerApi) {
      seenServerApi = true;
      result.push(line);
    }
    // Skip duplicates
  } else {
    result.push(line);
  }
}
fs.writeFileSync('src/utils/adminRoutes.js', result.join('\n'));
console.log('adminRoutes.js fixed');

// Fix Login.jsx - add submit button and fix sessionMessage
let login = fs.readFileSync('src/pages/auth/Login.jsx', 'utf8');

// Fix the sessionMessage variable - change 'sessionMessage' to 'sessionMsg'  
login = login.replace(/sessionMessage\s*=\s*["']/g, 'sessionMsg = "');
login = login.replace(/sessionMessage\s*\?/g, 'sessionMsg ?');

// Add the submit button after the password input  
login = login.replace(
  /<input\s+type="password"[^>]*\/>\s*\n\s*<\/form>/s,
  `<input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                className="w-full h-12 px-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                className="w-full h-12 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold"
              >
                Sign in
              </button>
            </form`
);

fs.writeFileSync('src/pages/auth/Login.jsx', login);
console.log('Login.jsx fixed');