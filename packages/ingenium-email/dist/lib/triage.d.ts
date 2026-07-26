/**
 * Email triage: categorize, score priority, and match against learned skills.
 *
 * Keyword-based classification (not ML) for speed and determinism.
 * Categories and priority scores are computed from subject + body text overlap
 * with known keyword lists.  Self-learning integration scores matched skills
 * by sender address and keyword overlap.
 */
import type { Skill } from "ingenium-core";
import type { TriageResult } from "./types.js";
/**
 * Load all skills tagged with "email", "response", or "triage" from the DB.
 * These skills are used for:
 *   - Matching incoming emails to known patterns (via tags and content keywords)
 *   - Extracting high-priority senders
 *   - Generating response templates in the responder module
 */
export declare function loadEmailSkills(projectId: string): Skill[];
/**
 * Extract high-priority sender addresses from email skills' tags.
 *
 * Supports two tag formats:
 *   - Direct email addresses: `alice@example.com`
 *   - Keyed patterns: `from:alice@example.com`, `sender:bob@example.com`
 *
 * Returns deduplicated senders.  Used to boost priority for known contacts.
 */
export declare function loadHighPrioritySenders(projectId: string): string[];
/**
 * Triage a batch of unread emails from INBOX.
 *
 * For each email:
 *   1. Classify into a category (budget, meeting, urgent, question, etc.)
 *   2. Score priority based on sender + urgency/meeting keywords
 *   3. Match against learned email skills (sender match + keyword overlap)
 *   4. Suggest an action (reply_now, draft, review_later, ignore)
 *   5. Compute a confidence score
 *
 * Results are sorted by priority descending (high → medium → low).
 */
export declare function triageEmails(projectId: string, accountId: string, limit?: number): Promise<TriageResult[]>;
//# sourceMappingURL=triage.d.ts.map