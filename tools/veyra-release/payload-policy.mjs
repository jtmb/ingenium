import { portablePath } from './source-manifest.mjs';

const forbidden = new Set(['node_modules', '.git', '.next', 'target', '.cache', 'models', 'weights', 'credentials']);
const engineNames = ['llama', 'ggml', 'gguf', 'safetensors', 'veyra-inference', 'model-manager'];

export function validatePayload({ platform, files, requiredPaths, approvedPaths }) {
  if (!['windows', 'linux'].includes(platform)) throw new Error('Unknown package platform');
  if (!Array.isArray(approvedPaths) || !approvedPaths.length) throw new Error('Reviewed exact payload allowlist required');
  for (const name of approvedPaths) portablePath(name);
  if (!Array.isArray(files) || !files.length || !Array.isArray(requiredPaths) || !requiredPaths.length) {
    throw new Error('Explicit payload inventory and required paths are mandatory');
  }
  const seen = new Set();
  let bytes = 0;
  for (const file of files) {
    const name = portablePath(file.path);
    const lower = name.toLowerCase();
    if (!approvedPaths.includes(name)) throw new Error('Unreviewed payload: ' + name);
    if (seen.has(lower)) throw new Error(`Case-colliding or duplicate payload: ${name}`);
    seen.add(lower);
    if (file.kind !== 'file' || !Number.isSafeInteger(file.bytes) || file.bytes <= 0
        || typeof file.sha256 !== 'string' || file.sha256.length !== 64
        || [...file.sha256].some(c => !'0123456789abcdef'.includes(c))) throw new Error(`Invalid payload metadata: ${name}`);
    if (lower.split('/').some(part => forbidden.has(part) || part === '.env' || part.startsWith('.env.'))) {
      throw new Error(`Private or disposable payload: ${name}`);
    }
    if (platform === 'linux' && engineNames.some(part => lower.includes(part))) throw new Error(`Windows engine/model input excluded from Linux: ${name}`);
    bytes += file.bytes;
    if (!Number.isSafeInteger(bytes)) throw new Error('Payload byte count overflow');
  }
  for (const required of requiredPaths) {
    portablePath(required);
    if (!files.some(file => file.path === required)) throw new Error(`Required payload missing: ${required}`);
  }
  return { platform, fileCount: files.length, unpackedBytes: bytes, inferenceEngineInspection: 'path-inventory-only' };
}
