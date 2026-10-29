const modes = new Set(['windows-native', 'windows-wsl', 'linux-cluster']);
const browserActions = new Set(['navigate', 'dom', 'screenshot']);
const admissionStrings = ['workspaceIdentity', 'workspaceHash', 'hostId', 'canonicalDirectory', 'serviceInstanceId'];
const admissionCounters = ['workspaceEpoch', 'projectRevision'];

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${name}`);
}

export function validateBinding(binding) {
  if (!binding || !modes.has(binding.kind)) throw new Error('Explicit execution environment required');
  for (const name of ['installationId', 'accountId', 'runtimeId']) requiredString(binding[name], name);
  if (!Object.hasOwn(binding, 'projectId') || (binding.projectId !== null && (typeof binding.projectId !== 'string' || !binding.projectId.trim()))) throw new Error('Explicit project identity or projectless null required');
  if (binding.kind === 'windows-wsl') for (const name of ['distro', 'user', 'workdir']) requiredString(binding[name], name);
  if (binding.kind === 'linux-cluster') for (const name of ['clusterId', 'namespace']) requiredString(binding[name], name);
  if (!binding.admission) throw new Error('Existing execution admission identity required');
  for (const key of admissionStrings) requiredString(binding.admission[key], key);
  for (const key of admissionCounters) if (!Number.isSafeInteger(binding.admission[key]) || binding.admission[key] < 0) throw new Error('Invalid execution admission revision');
  return Object.freeze({ ...binding, admission: Object.freeze({ ...binding.admission }) });
}

export function planBrowserOperation({ binding, target, action, grant, input }, now = Date.now()) {
  binding = validateBinding(binding);
  if (!browserActions.has(action)) throw new Error('Unsupported browser action');
  if (!target || !['native-tab', 'paired-tab', 'remote-tab'].includes(target.kind)) throw new Error('Explicit browser target required');
  requiredString(target.tabId, 'tabId');
  requiredString(target.sessionId, 'sessionId');
  if (binding.kind === 'linux-cluster' && target.kind !== 'remote-tab') throw new Error('Linux requires a remote browser target');
  if (binding.kind !== 'windows-native' && target.kind === 'native-tab') throw new Error('Native browser target requires native Windows binding');
  const scopeKeys = ['kind', 'installationId', 'accountId', 'projectId', 'runtimeId',
    ...(binding.kind === 'windows-wsl' ? ['distro', 'user', 'workdir'] : []),
    ...(binding.kind === 'linux-cluster' ? ['clusterId', 'namespace'] : [])];
  if (!grant || grant.action !== action || grant.tabId !== target.tabId || grant.sessionId !== target.sessionId
      || !Number.isFinite(grant.expiresAt) || !Number.isFinite(now) || grant.expiresAt <= now
      || scopeKeys.some(key => grant[key] !== binding[key])
      || [...admissionStrings, ...admissionCounters].some(key => grant.admission?.[key] !== binding.admission[key])) {
    throw new Error('Browser operation lacks a current exact-scope capability');
  }
  let operationInput = {};
  if (action === 'navigate') {
    requiredString(input?.url, 'navigation URL');
    const url = new URL(input.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || !Array.isArray(grant.allowedOrigins) || !grant.allowedOrigins.includes(url.origin)) throw new Error('Navigation origin is outside the capability');
    operationInput = { url: input.url };
  }
  if (action === 'dom') {
    requiredString(input?.selector, 'DOM selector');
    if (input.selector.length > 4096) throw new Error('DOM selector exceeds the supported bound');
    operationInput = { selector: input.selector };
  }
  return Object.freeze({ binding, target: Object.freeze({ ...target }), action, input: Object.freeze(operationInput),
    adapter: target.kind === 'native-tab' ? 'windows-browser' : target.kind === 'paired-tab' ? 'paired-browser' : 'remote-browser' });
}

export async function executeBrowserOperation(request, transport, signal) {
  const plan = planBrowserOperation(request);
  if (signal?.aborted) throw new Error('Browser operation cancelled before dispatch');
  if (typeof transport !== 'function') throw new Error('Qualified browser transport unavailable');
  // Never replay an operation whose external effect cannot be established.
  try {
    const result = await transport(plan, signal);
    if (signal?.aborted) return { status: 'unknown', retryAllowed: false, reason: 'cancelled-after-dispatch' };
    if (!result || !['completed', 'denied', 'failed', 'unknown'].includes(result.status)) {
      return { status: 'unknown', retryAllowed: false, reason: 'invalid-transport-outcome' };
    }
    return { status: result.status, retryAllowed: false, receipt: result.receipt ?? null };
  } catch {
    return { status: 'unknown', retryAllowed: false, reason: 'transport-interrupted' };
  }
}
