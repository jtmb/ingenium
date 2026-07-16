/**
 * Shared resource limit constants for the Ingenium platform.
 *
 * These limits guard against resource exhaustion attacks (DoS, zip bombs,
 * oversized payloads) while keeping reasonable headroom for legitimate
 * operations like file uploads, imports, and documentation pages.
 *
 * All sizes are in bytes unless otherwise noted.
 */

/** Maximum size for multipart/form-data uploads (e.g., file attachments). */
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10 MB

/** Maximum size for compressed import archives (tar, zip, etc.) accepted by the API. */
export const MAX_IMPORT_SIZE = 50 * 1024 * 1024; // 50 MB

/**
 * Maximum decompressed payload size for import processing.
 * Prevents zip-bomb attacks where a small compressed payload
 * expands to exhaust memory or disk.
 */
export const MAX_DECOMPRESSED_SIZE = 100 * 1024 * 1024; // 100 MB

/** Maximum content length for documentation / wiki pages. */
export const MAX_PAGE_CONTENT_LENGTH = 2 * 1024 * 1024; // 2 MB

/** Maximum length for a single comment or note body. */
export const MAX_COMMENT_LENGTH = 65536; // 64 KB
