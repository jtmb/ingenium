/**
 * Browser DTOs may expose scalar values directly as IDs, labels, or object
 * keys. Treat those fields as untrusted just like nested upstream objects:
 * accept only compact display/identifier alphabets and reject credential-shaped
 * values rather than attempting to redact an opaque scalar in place.
 */

const SAFE_BROWSER_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;
const SAFE_BROWSER_LABEL = /^[A-Za-z0-9][A-Za-z0-9 .,:/_+&()'-]{0,127}$/;
const SENSITIVE_SCALAR_WORD = /(?:api[_. -]?key|secret|token|password|authorization|bearer|credential|private|endpoint|headers?|cookies?|session|oauth|npm|\benv\b)/i;
const KEY_LIKE_PREFIX = /(?:^|[-_.])(sk|rk|pk|xox[a-z]?|gh[pousr]|AIza|AKIA)[-_A-Za-z0-9]{8,}$/i;
const JWT_LIKE = /^eyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+){1,2}$/;

/** Returns true for scalar strings that resemble a credential or secret-bearing field. */
export function isSecretShapedBrowserScalar(value: string): boolean {
  return SENSITIVE_SCALAR_WORD.test(value) || KEY_LIKE_PREFIX.test(value) || JWT_LIKE.test(value);
}

/** Safe compact identifiers for provider/model IDs and browser-visible keys. */
export function isSafeBrowserIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && SAFE_BROWSER_IDENTIFIER.test(value)
    && !isSecretShapedBrowserScalar(value);
}

/** Safe non-secret display labels; callers must fall back to an already-safe ID. */
export function isSafeBrowserLabel(value: unknown): value is string {
  return typeof value === "string"
    && SAFE_BROWSER_LABEL.test(value)
    && !isSecretShapedBrowserScalar(value);
}

/** MCP server map keys do not need provider/model namespace separators. */
export function isSafeMcpServerName(value: unknown): value is string {
  return typeof value === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)
    && !isSecretShapedBrowserScalar(value);
}
