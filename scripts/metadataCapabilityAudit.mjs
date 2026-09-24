import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORM_FUNCTIONS } from '../services/platformFunctionRegistry.js';
import { PLATFORM_ACTION_REGISTRY } from '../services/platformActionRegistry.js';
import { WORKFLOW_ACTION_REGISTRY } from '../services/platformWorkflow.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routeDir = path.join(root, 'routes');
const routeRe = /router\.(post|put|patch|delete)\s*\(\s*[`"']([^`"']+)/g;
const mutations = [];
for (const name of fs.readdirSync(routeDir).filter((n) => n.endsWith('.js')).sort()) {
  const source = fs.readFileSync(path.join(routeDir, name), 'utf8');
  for (const m of source.matchAll(routeRe)) mutations.push({ file: `routes/${name}`, method: m[1].toUpperCase(), path: m[2] });
}
const registered = {
  functions: PLATFORM_FUNCTIONS.map(({ key, category, description }) => ({ key, category, description })),
  actions: PLATFORM_ACTION_REGISTRY.map(({ key, displayName, description }) => ({ key, displayName, description })),
};
const duplicateKeys = (items) => items.map((item) => item.key).filter((key, index, all) => all.indexOf(key) !== index);
const functionDuplicates = [...new Set(duplicateKeys(PLATFORM_FUNCTIONS))];
const actionDuplicates = [...new Set(duplicateKeys(PLATFORM_ACTION_REGISTRY))];
const workflowActionDuplicates = [...new Set(duplicateKeys(WORKFLOW_ACTION_REGISTRY))];
const integrity = {
  duplicateRegisteredFunctions: functionDuplicates,
  duplicateRegisteredActions: actionDuplicates,
  duplicateWorkflowActions: workflowActionDuplicates,
  registryIntegrityOk: functionDuplicates.length === 0 && actionDuplicates.length === 0 && workflowActionDuplicates.length === 0,
};
const report = {
  generatedAt: new Date().toISOString(),
  mutationCount: mutations.length,
  registeredFunctionCount: registered.functions.length,
  registeredActionCount: registered.actions.length,
  workflowActionCount: WORKFLOW_ACTION_REGISTRY.length,
  integrity,
  mutations,
  registered,
};
const out = path.join(root, 'metadata-capability-audit.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`Capability audit: ${mutations.length} mutating HTTP entry points; ${registered.functions.length} registered functions; ${registered.actions.length} registered actions (${WORKFLOW_ACTION_REGISTRY.length} workflow actions + 2 record actions).`);
console.log(`Registry integrity: ${integrity.registryIntegrityOk ? 'OK' : 'FAILED'}; duplicate functions=${functionDuplicates.length}; duplicate actions=${actionDuplicates.length}; duplicate workflow actions=${workflowActionDuplicates.length}.`);
console.log(out);
