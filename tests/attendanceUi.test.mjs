/*
 * Staff attendance — frontend contract (clock in/out UI).
 *
 * Static contract test over the JSX source (the established convention:
 * reportsSidebar.test.mjs / jarvisUi.test.mjs); JSX syntax is verified by
 * `npm run build`. This file pins the wiring and the time-handling rules:
 *
 *   - the Employees page renders AttendanceAdmin (placeholder replaced),
 *   - clock in/out POST NO client timestamps/durations,
 *   - the official worked duration after clock-out comes from the server
 *     response (never React arithmetic),
 *   - the live elapsed timer ticks LOCALLY (no backend polling loop),
 *   - the management view is gated on the EXISTING attendance.view
 *     permission (admin/owner bypass), reported by /api/auth/me/permissions,
 *   - offline failures state that nothing was recorded (no fake success),
 *   - the permission matrix exposes attendance.view for role assignment.
 *
 *   node --test tests/attendanceUi.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

const PAGE = read("../src/pages/employees/AttendanceAdmin.jsx");
const LAYOUT = read("../src/pages/admin/AdminLayout.jsx");
const CATALOGUE = read("../src/utils/navCatalogue.js");
const SETTINGS = read("../src/pages/settings/SettingsAdmin.jsx");

test("Employees page exists and is wired into the AdminLayout", () => {
  assert.match(PAGE, /export default function AttendanceAdmin/);
  assert.match(LAYOUT, /const AttendanceAdmin = lazy\(\(\) => import\("\.\.\/employees\/AttendanceAdmin\.jsx"\)\);/);
  assert.match(LAYOUT, /page ===\s*\n?\s*"Employees" \? \(|page === "Employees" \? \(/);
  assert.match(LAYOUT, /"Employees" \? \(?\s*<AttendanceAdmin \/>\s*\)/);
  /* The ONE page catalogue owns the nav entry — exactly one, so there is no
     duplicated top-level module (the render branch in AdminLayout stays). */
  assert.equal((CATALOGUE.match(/\["Employees", Users\]/g) || []).length, 1);
});

test("clock in/out call the real endpoints without client timestamps (1-4)", () => {
  assert.match(PAGE, /apiRequest\("\/api\/attendance\/clock-in", \{ method: "POST", body: JSON\.stringify\(\{\}\) \}\)/);
  assert.match(PAGE, /apiRequest\("\/api\/attendance\/clock-out", \{ method: "POST", body: JSON\.stringify\(\{\}\) \}\)/);
  assert.match(PAGE, /apiRequest\("\/api\/attendance\/me"\)/);
  assert.match(PAGE, /apiRequest\("\/api\/attendance\/me\/records"\)/);
  /* No client-generated clock/duration anywhere in the page. */
  assert.doesNotMatch(PAGE, /clockInAt|clockIn:|clockOut:|workedMinutes:/);
});

test("official worked duration comes from the server response, not React (4)", () => {
  assert.match(PAGE, /data\.data\?\.workedMinutes/);
  assert.match(PAGE, /Clocked out — worked \$\{formatWorked\(worked\)\}/);
});

test("live elapsed timer ticks locally without polling the backend (9)", () => {
  const tick = PAGE.match(/const timer = setInterval\([\s\S]*?\);/);
  assert.ok(tick, "a local interval timer exists");
  assert.doesNotMatch(tick[0], /apiRequest/, "the tick must not call the API");
  /* Status endpoint is fetched in load() (refresh/actions), never on an interval. */
  const loadFns = PAGE.match(/const load = useCallback[\s\S]*?\}, \[[^\]]*\]\);/g) || [];
  assert.ok(loadFns.some((fn) => fn.includes("/api/attendance/me")), "status loads on demand");
  for (const fn of loadFns) {
    assert.doesNotMatch(fn, /setInterval/, "no polling loop inside load functions");
  }
  assert.match(PAGE, /30_000/);
});

test("required UI states render (1, 2, 5-7)", () => {
  assert.match(PAGE, /Not clocked in/);
  assert.match(PAGE, /Clocked in/);
  assert.match(PAGE, /Clock In/);
  assert.match(PAGE, /Clock Out/);
  assert.match(PAGE, /Loading attendance\.\.\./);
  assert.match(PAGE, /Attendance History/);
  assert.match(PAGE, /Clocked in: <span className="font-semibold text-slate-800">\{formatClockTime\(status\.clockIn\)\}<\/span>/);
  assert.match(PAGE, /Worked: <span className="font-semibold text-slate-800 text-lg">\{formatWorked\(elapsedMinutes\)\}<\/span>/);
});

test("offline/network errors state the action was NOT recorded (10)", () => {
  assert.match(PAGE, /isNetworkError/);
  assert.match(PAGE, /could NOT be recorded\. Nothing was saved locally/);
  assert.match(PAGE, /attendance records could not be loaded/);
});

test("management view gated by the existing attendance.view permission (6-9)", () => {
  assert.match(PAGE, /apiRequest\("\/api\/attendance"\)/);
  assert.match(PAGE, /codes\.includes\("attendance\.view"\)/);
  assert.match(PAGE, /isAdmin \|\| codes\.includes\("attendance\.view"\)/);
  assert.match(PAGE, /Attendance Management/);
  assert.match(PAGE, /Employee/, "management table shows the staff member");
  assert.match(PAGE, /storeName/, "management table shows the store");
  /* 403 from the authority renders access-denied even if the tab were shown. */
  assert.match(PAGE, /err\?\.status === 403/);
  assert.match(PAGE, /You do not have permission to view attendance records\./);
  /* The permission matrix lets roles be granted attendance.view. */
  assert.match(SETTINGS, /"attendance\.view"/);
});
