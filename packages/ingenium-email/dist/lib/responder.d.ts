/**
 * Response suggestion engine: pattern-match emails against learned skills.
 *
 * Skills with a ```template ... ``` code block are eligible for auto-response.
 * The template uses {{sender}}, {{subject}}, {{date}} placeholders filled from
 * the matched email.  Confidence scoring uses sender match + keyword overlap.
 */
import type { ResponseSuggestion } from "./types.js";
/**
 * Extract a response template from skill content between ```template and ``` markers.
 *
 * Template format in skill content:
 *   ```template
 *   Subject: Re: {{subject}}
 *   Hi {{sender}},
 *
 *   Thanks for your email...
 *   ```
 *
 * Returns null if no template block is found.
 */
export declare function extractTemplate(skillContent: string): string | null;
/** Fill placeholders in a template with actual values.
 *  Supports {{sender}}, {{subject}}, {{date}} interpolation. */
export declare function fillTemplate(template: string, vars: {
    sender: string;
    subject: string;
    date: string;
}): string;
/**
 * Suggest an auto-response for an email based on matched skills.
 *
 * Reconstructs the email from the DB cache (email_cache + email_bodies) instead
 * of hitting IMAP directly, because Gmail REST API accounts don't have IMAP
 * connections (🔴 L30 fix).
 *
 * 🔴 HARD RULE #8: folder is REQUIRED — UIDs are only unique within a folder.
 * All callers must pass the exact folder the email lives in.
 *
 * Returns null when:
 *   - No cached email found
 *   - No skill has confidence > 0.3 AND a template
 *   - The best matching skill has no template
 */
export declare function suggestResponse(projectId: string, accountId: string, uid: string | number, folder: string): Promise<ResponseSuggestion | null>;
//# sourceMappingURL=responder.d.ts.map