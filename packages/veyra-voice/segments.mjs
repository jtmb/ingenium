import { VoiceError, validateTurn } from './session.mjs';
// Module-owned location for server-side verification of THESE exact bytes.
// This data value grants no source, filesystem, speech or dispatch authority.
export const ORIGINAL_SEGMENTER_MODULE_URL=import.meta.url;

const encoder = new TextEncoder();
const invalid = () => { throw new VoiceError('VOICE_SOURCE_INVALID'); };
export async function sourceDigest(bytes) {
  if (!(bytes instanceof Uint8Array)) invalid();
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map(value => value.toString(16).padStart(2, '0')).join('');
}
function scalar(character) {
  const value = character.charCodeAt(0);
  return character.length !== 1 || value < 0xd800 || value > 0xdfff;
}

/** Logical-source partition only. It creates no operation, scheduler, transcript,
 * audio effect or request ID. Offsets always refer to exact original UTF-8 bytes. */
export async function planTextSpeech(text, { maxChars = 160, maxBytes = 640 } = {}) {
  if (typeof text !== 'string' || !text.length || [...text].length > 32000
    || !Number.isInteger(maxChars) || maxChars < 1 || maxChars > 600
    || !Number.isInteger(maxBytes) || maxBytes < 4 || maxBytes > 2400) invalid();
  const characters = [...text];
  if (characters.some(character => !scalar(character) || (character.charCodeAt(0) < 32 && !['\n', '\r', '\t'].includes(character)))) invalid();
  const bytes = encoder.encode(text), digest = await sourceDigest(bytes), segments = [];
  let start = 0, byteStart = 0;
  while (start < characters.length) {
    let end = start, size = 0;
    while (end < characters.length && end - start < maxChars) {
      const next = encoder.encode(characters[end]).length;
      if (size + next > maxBytes) break;
      size += next; end++;
    }
    if (end === start) invalid();
    // Prefer a nearby natural boundary without inventing/removing whitespace.
    // Keep partitions large enough to bound child count, not a new VAD policy.
    if (end < characters.length) {
      for (let boundary = end; boundary > Math.max(start, end - 16); boundary--) {
        if (/\s|[.!?;:]/u.test(characters[boundary - 1])) { end = boundary; break; }
      }
    }
    const part = characters.slice(start, end).join(''), partBytes = encoder.encode(part);
    const sourceEnd = byteStart + partBytes.length;
    segments.push(Object.freeze({ index: segments.length, sourceStart: byteStart, sourceEnd,
      sourceDigest: digest, digest: await sourceDigest(partBytes), kind: part.trim() ? 'tts' : 'text-gap', text: part }));
    start = end; byteStart = sourceEnd;
  }
  return Object.freeze({ sourceDigest: digest, sourceBytes: bytes.length,
    segments: Object.freeze(segments.map(part => Object.freeze({ ...part, total: segments.length }))) });
}

/** A final short ASR tail is balanced with its predecessor, never padded, dropped
 * or replayed. The logical capture bound is separate from each15s worker call. */
export function pcmRanges(bytes, { maxBytes = 480000, minBytes = 8000, maxSourceBytes = 1920000 } = {}) {
  if (!Number.isInteger(bytes) || bytes < minBytes || bytes > maxSourceBytes || bytes % 2
    || !Number.isInteger(maxBytes) || maxBytes < minBytes * 2 || maxBytes > 480000 || maxBytes % 2
    || !Number.isInteger(minBytes) || minBytes < 8000 || minBytes % 2
    || !Number.isInteger(maxSourceBytes) || maxSourceBytes < minBytes || maxSourceBytes > 1920000) invalid();
  const ranges = []; let offset = 0;
  while (bytes - offset > maxBytes) { ranges.push({ sourceStart: offset, sourceEnd: offset + maxBytes }); offset += maxBytes; }
  if (bytes > offset) {
    if (bytes - offset < minBytes) {
      const previous = ranges.at(-1); if (!previous) invalid();
      previous.sourceEnd -= minBytes - (bytes - offset); offset = previous.sourceEnd;
    }
    ranges.push({ sourceStart: offset, sourceEnd: bytes });
  }
  return ranges.map((range, index) => Object.freeze({ ...range, index, total: ranges.length }));
}
export async function planPcmSpeech(pcm) {
  if (!(pcm instanceof Uint8Array)) invalid();
  const ranges = pcmRanges(pcm.length), digest = await sourceDigest(pcm);
  return Object.freeze({ sourceDigest: digest, sourceBytes: pcm.length,
    segments: Object.freeze(await Promise.all(ranges.map(async part => Object.freeze({ ...part, kind: 'asr',
      sourceDigest: digest, digest: await sourceDigest(pcm.subarray(part.sourceStart, part.sourceEnd)) })))) });
}
export async function speechChildKey(turn, segment) {
  validateTurn(turn);
  return sourceDigest(encoder.encode(JSON.stringify([turn.requestId, turn.generation, segment.kind,
    segment.index, segment.sourceStart, segment.sourceEnd, segment.sourceDigest, segment.digest])));
}
