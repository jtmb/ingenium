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
export declare const MAX_ATTACHMENT_SIZE: number;
/** Maximum size for compressed import archives (tar, zip, etc.) accepted by the API. */
export declare const MAX_IMPORT_SIZE: number;
/**
 * Maximum decompressed payload size for import processing.
 * Prevents zip-bomb attacks where a small compressed payload
 * expands to exhaust memory or disk.
 */
export declare const MAX_DECOMPRESSED_SIZE: number;
/** Maximum content length for documentation / wiki pages. */
export declare const MAX_PAGE_CONTENT_LENGTH: number;
/** Maximum length for a single comment or note body. */
export declare const MAX_COMMENT_LENGTH = 65536;
//# sourceMappingURL=constants.d.ts.map