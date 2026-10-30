import { createHmac, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { CpuOwnershipError } from './cpu-ownership.mjs';

const domain = Buffer.from('VEYRA-CPU-PRIVATE-PIPE-V1\0');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) && value !== '00000000-0000-0000-0000-000000000000';
const fail = code => { throw new CpuOwnershipError(code); };
const methods = new Set(['enroll', 'validate', 'retain', 'ready', 'result']);

/** Bounded strict JSON, including duplicate nested fields. Authenticate original
 * UTF-8 bytes first; never normalize JSON before comparing its MAC. */
export function privateJson(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); let at = 0;
  const whitespace = () => { while (/[ \t\r\n]/u.test(text[at] ?? '') && at < text.length) at++; };
  function string() {
    const start = at++;
    while (at < text.length) {
      const value = text[at++];
      if (value === '"') return JSON.parse(text.slice(start, at));
      if (value === '\\') at++;
    }
    fail('CPU_PRIVATE_JSON_INVALID');
  }
  function value(depth) {
    if (depth > 64) fail('CPU_PRIVATE_JSON_LIMIT'); whitespace(); const character = text[at];
    if (character === '"') return string();
    if (character === '{') {
      at++; whitespace(); const result = Object.create(null);
      if (text[at] === '}') { at++; return result; }
      for (;;) {
        whitespace(); if (text[at] !== '"') fail('CPU_PRIVATE_JSON_INVALID'); const key = string();
        if (Object.hasOwn(result, key)) fail('CPU_PRIVATE_JSON_DUPLICATE');
        whitespace(); if (text[at++] !== ':') fail('CPU_PRIVATE_JSON_INVALID'); result[key] = value(depth + 1);
        whitespace(); const separator = text[at++]; if (separator === '}') return result; if (separator !== ',') fail('CPU_PRIVATE_JSON_INVALID');
      }
    }
    if (character === '[') {
      at++; whitespace(); const result = []; if (text[at] === ']') { at++; return result; }
      for (;;) { result.push(value(depth + 1)); whitespace(); const separator = text[at++]; if (separator === ']') return result; if (separator !== ',') fail('CPU_PRIVATE_JSON_INVALID'); }
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) if (text.startsWith(literal, at)) { at += literal.length; return result; }
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(at));
    if (!match) fail('CPU_PRIVATE_JSON_INVALID'); at += match[0].length; const result = Number(match[0]);
    if (!Number.isFinite(result)) fail('CPU_PRIVATE_JSON_INVALID'); return result;
  }
  const result = value(0); whitespace(); if (at !== text.length || !result || typeof result !== 'object' || Array.isArray(result)) fail('CPU_PRIVATE_JSON_INVALID');
  return result;
}

export function privateFrame(key, direction, sequence, value) {
  if (!(key instanceof Uint8Array) || key.length !== 32 || !['N', 'C'].includes(direction) || !Number.isSafeInteger(sequence) || sequence < 1) fail('CPU_PRIVATE_FRAME_INVALID');
  const payload = Buffer.from(JSON.stringify(value)), ordinal = Buffer.alloc(8);
  if (!payload.length || payload.length > 16384) fail('CPU_PRIVATE_FRAME_LIMIT');
  ordinal.writeBigUInt64BE(BigInt(sequence));
  const tag = createHmac('sha256', key).update(domain).update(direction).update(ordinal).update(payload).digest();
  const header = Buffer.alloc(4); header.writeUInt32BE(payload.length);
  return Buffer.concat([header, ordinal, tag, payload]);
}
export function decodePrivateFrame(key, direction, sequence, frame) {
  if (frame.length < 44 || frame.readUInt32BE(0) !== frame.length - 44 || frame.length > 16428 || frame.readBigUInt64BE(4) !== BigInt(sequence)) fail('CPU_PRIVATE_FRAME_INVALID');
  const tag = createHmac('sha256', key).update(domain).update(direction).update(frame.subarray(4, 12)).update(frame.subarray(44)).digest();
  if (!timingSafeEqual(tag, frame.subarray(12, 44))) fail('CPU_PRIVATE_FRAME_AUTHORITY');
  return privateJson(frame.subarray(44));
}

/** Actual original inherited streams. Constructor starts nothing. The managed
 * process owner enrolls this object before start and retains BOTH pump promises
 * and their errors until actual process/tree retirement; EOF never proves that.
 */
export class SupervisorChannel {
  constructor({ reader, writer, key, dispatch, onFault }) {
    if (!reader?.[Symbol.asyncIterator] || typeof writer?.write !== 'function' || !(key instanceof Uint8Array) || key.length !== 32
      || typeof dispatch !== 'function' || typeof onFault !== 'function') fail('CPU_PRIVATE_CHANNEL_CONFIG');
    Object.assign(this, { reader, writer, key: Buffer.from(key), dispatch, onFault });
    this.sent = this.received = 0; this.started = false; this.failure = null; this.spent = new Map();
    this.readerOriginal = this.writerOriginal = null; this.pending = [];
  }
  #fault(error) { if (this.failure) return; this.failure = error; this.onFault(error); }
  start() {
    if (this.started) fail('CPU_PRIVATE_CHANNEL_SPENT'); this.started = true;
    this.readerOriginal = this.#read();
    this.readerOriginal.then(() => undefined, error => this.#fault(error));
  }
  async #read() {
    let bytes = Buffer.alloc(0);
    for await (const chunk of this.reader) {
      if (!(chunk instanceof Uint8Array) || chunk.length > 65536 || bytes.length + chunk.length > 81920) fail('CPU_PRIVATE_FRAME_LIMIT');
      bytes = Buffer.concat([bytes, chunk]);
      while (bytes.length >= 4) {
        const size = bytes.readUInt32BE(0); if (!size || size > 16384) fail('CPU_PRIVATE_FRAME_LIMIT');
        if (bytes.length < 44 + size) break;
        const request = decodePrivateFrame(this.key, 'C', ++this.received, bytes.subarray(0, 44 + size)); bytes = bytes.subarray(44 + size);
        if (Object.keys(request).sort().join() !== 'id,method,params' || !uuid(request.id) || !methods.has(request.method) || !request.params || typeof request.params !== 'object' || Array.isArray(request.params)) fail('CPU_PRIVATE_REQUEST_INVALID');
        const snapshot = JSON.stringify([request.method, request.params]);
        const prior = this.spent.get(request.id);
        if (prior && prior.snapshot !== snapshot) fail('CPU_PRIVATE_TRANSACTION_CONFLICT');
        if (!prior && this.spent.size >= 8192) fail('CPU_PRIVATE_CAPACITY');
        let reply = prior?.reply;
        if (!reply) {
          // Retain a spent request before invoking the durable original owner;
          // an exception cannot permit a later inference/metadata transaction.
          const entry = prior ?? { snapshot, reply: null }; this.spent.set(request.id, entry);
          try { reply = { id: request.id, ok: true, result: await this.dispatch(request.method, request.params, request.id) }; }
          catch { reply = { id: request.id, ok: false, result: { code: 'CORE_ORIGINAL_REFUSED' } }; }
          entry.reply = reply;
        }
        await this.send(reply);
      }
    }
    if (bytes.length) fail('CPU_PRIVATE_FRAME_TRUNCATED');
    fail('CPU_PRIVATE_ORIGINAL_EOF');
  }
  send(value) {
    if (!this.started || this.failure || this.pending.length >= 64) return Promise.reject(new CpuOwnershipError('CPU_PRIVATE_CHANNEL_CLOSED'));
    const previous = this.writerOriginal;
    const original = (async () => {
      if (previous) await previous;
      const frame = privateFrame(this.key, 'N', ++this.sent, value);
      if (!this.writer.write(frame)) await once(this.writer, 'drain');
    })();
    this.writerOriginal = original; this.pending.push(original);
    original.then(() => { this.pending.splice(this.pending.indexOf(original), 1); }, error => this.#fault(error));
    return original;
  }
  closeInput() { this.writer.destroy(); }
  async joinOriginals() {
    return Promise.allSettled([this.readerOriginal, this.writerOriginal, ...this.pending].filter(Boolean));
  }
}
