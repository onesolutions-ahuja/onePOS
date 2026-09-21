const fs = require('fs');
let src = fs.readFileSync('src/pages/settings/SettingsAdmin.jsx', 'utf8');

// Find the aside block and replace it
const asideStart = src.indexOf('<aside className="w-52 shrink-0');
if (asideStart < 0) {
  console.error('ERROR: aside block not found');
  process.exit(1);
}

// Find the closing </aside> after the aside start
const asideEnd = src.indexOf('</aside>', asideStart);
if (asideEnd < 0) {
  console.error('ERROR: closing </aside> not found');
  process.exit(1);
}

const newAside = `      <aside className="w-52 shrink-0 bg-white border border-slate-200 rounded-xl p-3 space-y-4">
        {SETTING_GROUPS.map((group) => {
          const sections = group.sections.filter(
            (item) => item !== "Server / API Configuration" || isAdmin
          );
          return (
            <div key={group.label}>
              <p className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{group.label}</p>
              <div className="space-y-0.5">
                {sections.map((item) => (
                  <button
                    key={item}
                    onClick={() => { setTab(item); setMessage(""); setError(""); }}
                    className={\`w-full text-left px-2 h-8 rounded-md text-sm transition-colors \${tab === item ? "bg-blue-600 text-white font-medium" : "text-slate-600 hover:bg-slate-100"}\`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </aside>`;

src = src.substring(0, asideStart) + newAside + src.substring(asideEnd + '</aside>'.length);

fs.writeFileSync('src/pages/settings/SettingsAdmin.jsx', src);
console.log('Successfully replaced aside block');
