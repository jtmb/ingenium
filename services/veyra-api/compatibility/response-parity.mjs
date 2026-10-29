/**
 * Compare synthetic or explicitly authorized compatibility responses without
 * reflecting credentials, private bodies, or upstream diagnostics in results.
 */
export function compareResponses(expected, actual) {
  const supportedHeaders = [
    'content-type', 'content-encoding', 'vary', 'www-authenticate', 'retry-after',
    'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
  ];
  const normalize = (response) => {
    if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
      throw new TypeError('Invalid HTTP status');
    }
    if (!(response.body instanceof Uint8Array)) {
      throw new TypeError('Response body must contain original bytes');
    }
    const headers = new Headers(response.headers);
    return { ...response, headers };
  };
  const before = normalize(expected);
  const after = normalize(actual);
  const mismatches = [];
  if (before.status !== after.status) mismatches.push('status');
  for (const name of supportedHeaders) {
    if (before.headers.get(name) !== after.headers.get(name)) mismatches.push('header:' + name);
  }
  if (before.body.byteLength !== after.body.byteLength
      || !before.body.every((value, index) => value === after.body[index])) {
    mismatches.push('body');
  }
  if (after.headers.get('cache-control') !== 'no-store') mismatches.push('cache-control');
  return Object.freeze({ compatible: mismatches.length === 0, mismatches: Object.freeze(mismatches) });
}
