# onePOS Android app (Capacitor)

The Android build wraps the existing `vite build` output with Capacitor. It is
the **same React code** as the web app — there is no second implementation.

## Project layout

| Path | Purpose |
| --- | --- |
| `capacitor.config.json` | Capacitor project config (`appId`, `appName`, `webDir`) |
| `android/` | Generated native Gradle project (safe to commit; build outputs are git-ignored) |
| `android/app/src/main/assets/public/` | Copy of `dist/` produced by `cap sync` — generated, git-ignored |
| `dist/app/index.html` | The **till / admin** shell (`/app`, `/login`, `/customer-display`) |
| `dist/index.html` | The **marketing** site (`/`) |

## Build

```bash
npm run android:sync     # vite build + cap sync android
npm run android:open     # opens the project in Android Studio, then Run ▶
```

Or from the CLI (needs a JDK + Android SDK; `android/local.properties` points at
the SDK and is machine-specific, so it is not committed). `java` is not
necessarily on `PATH` — point Gradle at Android Studio's bundled JDK:

```powershell
cd android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug    # Windows
```

```bash
cd android
./gradlew assembleDebug        # macOS / Linux
```

The APK lands in `android/app/build/outputs/apk/debug/`.

## Open decision: how the app reaches the onePOS server

The bundled web app is an SPA that talks to the Express + PostgreSQL backend
through **relative** URLs (`/api/...`) issued from the single client in
`src/services/api.js`. Inside a Capacitor WebView the origin is
`https://localhost`, which serves the bundled files only — a `fetch("/api/login")`
therefore hits the WebView's own asset server and fails. Two ways to resolve it:

### Option A — point the shell at the deployed server (no app code changes)

Add `server.url` to `capacitor.config.json` and re-sync:

```json
{
  "appId": "com.onesolutions.onepos",
  "appName": "onePOS",
  "webDir": "dist",
  "server": {
    "url": "https://<your-onepos-host>/app",
    "androidScheme": "https"
  }
}
```

Relative API calls and `/app/offline-sw.js` then resolve **same-origin** and every
existing feature (offline queue, service worker, secure invoices) works
unmodified. The trade-off is that the app requires the server to be reachable on
first load, and the URL is per-deployment.

### Option B — keep the bundle offline and add a configurable API origin

Keep the bundled assets and teach `src/services/api.js` to prefix relative `/api`
URLs with a server address stored on the device (typed once at first run, e.g. a
"Server address" field on the login screen). This keeps the app usable with a
store-local server on the LAN, but it is a real feature: it needs the storage
key, the first-run UI and its own contract tests.

Until one of these is chosen the APK is a marketing/standalone shell — it boots,
but sign-in cannot reach a backend.
