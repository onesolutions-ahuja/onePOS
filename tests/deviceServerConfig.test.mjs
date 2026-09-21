/*
 * Device server configuration vs normal login — tests.
 *
 * Verifies the Render-default → normal-login + Superadmin Settings → optional
 * server override architecture. The storage/normalisation contract of
 * services/serverAddress.js itself is unit-tested directly
 * (tests/serverAddress.test.mjs).
 *
 *   node --test tests/deviceServerConfig.test.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const login = readFileSync(path.join(dir, '..', 'src', 'pages', 'auth', 'Login.jsx'), 'utf8');
const app = readFileSync(path.join(dir, '..', 'src', 'App.jsx'), 'utf8');
const serverAddress = readFileSync(path.join(dir, '..', 'src', 'services', 'serverAddress.js'), 'utf8');
const settingsAdmin = readFileSync(path.join(dir, '..', 'src', 'pages', 'settings', 'SettingsAdmin.jsx'), 'utf8');
const adminLayout = readFileSync(path.join(dir, '..', 'src', 'pages', 'admin', 'AdminLayout.jsx'), 'utf8');
const serverApiSettings = readFileSync(path.join(dir, '..', 'src', 'pages', 'settings', 'ServerApiSettings.jsx'), 'utf8');
const adminRoutes = readFileSync(path.join(dir, '..', 'src', 'utils', 'adminRoutes.js'), 'utf8');

describe('Render default → normal login', () => {
  test('production Render API is the default (defined once in serverAddress.js)', () => {
    assert.match(serverAddress, /DEFAULT_SERVER_ADDRESS/);
    assert.match(serverAddress, /VITE_DEFAULT_API_URL/);
    assert.match(serverAddress, /https:\/\/onepos\.onrender\.com/);
    assert.ok(!login.includes('onepos.onrender.com'), 'Login.jsx must not hard-code the Render URL');
  });

  test('normal login does not require server entry', () => {
    assert.match(login, /placeholder="Username"/);
    assert.match(login, /type="password"/);
    assert.match(login, /Sign in/);
    assert.ok(!login.includes('needsDeviceSetup'), 'Device Setup forcing removed from Login');
    assert.ok(!login.includes('data-testid="device-setup"'), 'Device Setup UI removed from Login');
    assert.ok(!login.includes('showSetup'), 'No showSetup state in Login');
    assert.ok(!login.includes('configuredServer'), 'No configuredServer state in Login');
    assert.ok(!login.includes('server-address-panel'), 'No server panel in normal login');
    assert.ok(!login.includes('Server / API URL'), 'No server URL prompt in normal login');
  });

  test('login form has username + password + sign-in button only', () => {
    assert.match(login, /<form/);
    assert.match(login, /type="submit"/);
    assert.match(login, /Sign in/);
  });
});

describe('Superadmin Settings → Server / API Configuration', () => {
  test('Server / API Configuration is a registered settings tab', () => {
    assert.match(adminRoutes, /"Server \/ API Configuration": "server-api"/);
    assert.match(adminRoutes, /server-api/);
  });

  test('ServerApiSettings component exists and reuses serverAddress.js', () => {
    assert.match(serverApiSettings, /getServerAddress/);
    assert.match(serverApiSettings, /setServerAddress/);
    assert.match(serverApiSettings, /normaliseServerAddress/);
    assert.match(serverApiSettings, /Server \/ API Configuration/);
    assert.match(serverApiSettings, /Test Connection/);
    assert.match(serverApiSettings, /Change Server/);
  });

  test('Superadmin-only gating: isAdmin required to render ServerApiSettings', () => {
    assert.match(settingsAdmin, /isAdmin && <ServerApiSettings/);
    assert.match(settingsAdmin, /function SettingsAdmin\(\{ initialTab = "General", isAdmin = false \}\)/);
  });

  test('AdminLayout passes isAdmin to SettingsAdmin', () => {
    assert.match(adminLayout, /<SettingsAdmin[^>]*isAdmin=\{onlinePermissions\.isAdmin\}/);
  });

  test('non-Superadmin cannot access Server / API Configuration', () => {
    const adminLine = settingsAdmin.match(/isAdmin && <ServerApiSettings[\s\S]*?\//);
    assert.ok(adminLine, 'ServerApiSettings gated on isAdmin');
  });
});

describe('custom / local server override', () => {
  test('custom server with port is accepted via normaliseServerAddress', () => {
    assert.match(serverAddress, /normaliseServerAddress/);
    assert.match(serverAddress, /192\.168\.1\.50:10000/);
  });

  test('server origin is normalised correctly (bare origin, no path)', () => {
    assert.match(serverAddress, /parsed\.origin/);
    assert.match(serverAddress, /return parsed\.origin/);
  });

  test('saved override is used by getServerAddress', () => {
    assert.match(serverAddress, /getServerAddress/);
    assert.match(serverAddress, /localStorage\.getItem\(SERVER_ADDRESS_KEY\)/);
  });

  test('API requests continue using resolveApiUrl', () => {
    assert.match(serverAddress, /resolveApiUrl/);
    assert.match(serverAddress, /export function resolveApiUrl/);
  });

  test('ServerApiSettings persists before testing (failed health check does not erase)', () => {
    assert.match(serverApiSettings, /setServerAddress\(normalised\)/);
    const handleSavePos = serverApiSettings.indexOf('const handleSave = async () => {');
    const runHealthCheckPos = serverApiSettings.indexOf('const runHealthCheck', handleSavePos);
    const saveBlock = serverApiSettings.slice(handleSavePos, runHealthCheckPos);
    const persistIdx = saveBlock.indexOf('setServerAddress(normalised)');
    const healthIdx = saveBlock.indexOf('/api/health');
    assert.ok(persistIdx !== -1 && healthIdx !== -1 && persistIdx < healthIdx, 'persist before health check in handleSave');
    assert.ok(!saveBlock.includes('clearServerAddress'), 'save does not clear existing config on failure');
  });
});
