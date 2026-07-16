/**
 * Response suggestion engine: pattern-match emails against learned skills.
 *
 * Skills with a ```template ... ``` code block are eligible for auto-response.
 * The template uses {{sender}}, {{subject}}, {{date}} placeholders filled from
 * the matched email.  Confidence scoring uses sender match + keyword overlap.
 */

import type { ResponseSuggestion, EmailMessage } from "./types.js";
import type { Skill } from "ingenium-core";
import { emailCache } from "ingenium-core";
import { loadEmailSkills } from "./triage.js";

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
export function extractTemplate(skillContent: string): string | null {
  const match = skillContent.match(/```template\s*\n([\s\S]*?)\n\s*```/i);
  if (!match?.[1]) return null;
  return match[1].trim();
}

/** Fill placeholders in a template with actual values.
 *  Supports {{sender}}, {{subject}}, {{date}} interpolation. */
export function fillTemplate(
  template: string,
  vars: { sender: string; subject: string; date: string },
): string {
  return template
    .replace(/\{\{sender\}\}/g, vars.sender)
    .replace(/\{\{subject\}\}/g, vars.subject)
    .replace(/\{\{date\}\}/g, vars.date);
}

/**
 * Calculate confidence score (0.0–1.0) for a skill against an email.
 *
 * Scoring model:
 *   - Sender match (skill tags contain sender address): +0.5
 *   - Keyword overlap (ratio of skill content words appearing in email): up to +0.5
 *   - Capped at 1.0
 *
 * Words shorter than 4 characters are excluded from overlap scoring to
 * avoid false positives from common words (the, and, for, etc.).
 */
function calculateConfidence(skill: Skill, email: EmailMessage): number {
  let confidence = 0;
  const senderAddr = email.from[0]?.address ?? "";
  const skillTags = (skill.tags ?? "").toLowerCase();

  // Sender match
  if (skillTags.includes(senderAddr.toLowerCase())) {
    confidence += 0.5;
  }

  // Keyword overlap with email content
  const combined = `${email.subject} ${email.body.text ?? ""} ${senderAddr}`.toLowerCase();
  const skillContent = (skill.content ?? "").toLowerCase();

  const skillWords = new Set(
    skillContent
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
  const emailWords = new Set(
    combined
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
  const overlap = [...skillWords].filter((w) => emailWords.has(w)).length;
  const keywordScore = Math.min(overlap / Math.max(skillWords.size, 1), 0.5);
  confidence += keywordScore;

  return Math.min(confidence, 1.0);
}

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
export async function suggestResponse(
  projectId: string,
  accountId: string,
  uid: string | number,
  folder: string,
): Promise<ResponseSuggestion | null> {
  // 🔴 L30: Gmail REST API accounts don't have IMAP connections —
  // getEmail() was calling getConnection() which throws "No active IMAP
  // connection".  Reconstruct the email from the DB cache instead.
  const cachedListing = emailCache.getCachedEmail(accountId, folder, String(uid));
  if (!cachedListing) return null;

  const cachedBody = emailCache.getCachedEmailBody(accountId, folder, String(uid));

  // Reconstruct enough of an EmailMessage for calculateConfidence() and
  // fillTemplate() — those only need from, subject, date, and body.text.
  const email: EmailMessage = {
    uid: String(uid),
    subject: cachedListing.subject ?? "(no subject)",
    from: [{ name: cachedListing.from_name ?? undefined, address: cachedListing.from_addr ?? "" }],
    to: [],
    cc: [],
    date: cachedListing.date ?? new Date().toISOString(),
    body: {
      text: cachedBody?.text ?? cachedListing.snippet ?? undefined,
      html: cachedBody?.html ?? undefined,
    },
    attachments: [],
    flags: [],
    folder,
  };

  const emailSkills = loadEmailSkills(projectId);

  let bestSkill: Skill | null = null;
  let bestConfidence = 0;
  let bestTemplate: string | null = null;

  for (const skill of emailSkills) {
    const confidence = calculateConfidence(skill, email);
    // Minimum confidence threshold of 0.3 to avoid low-quality suggestions
    if (confidence > 0.3 && confidence > bestConfidence) {
      const template = extractTemplate(skill.content);
      if (template) {
        bestConfidence = confidence;
        bestSkill = skill;
        bestTemplate = template;
      }
    }
  }

  if (!bestSkill || !bestTemplate) return null;

  const senderName = email.from[0]?.name ?? email.from[0]?.address ?? "there";
  const body = fillTemplate(bestTemplate, {
    sender: senderName,
    subject: email.subject,
    date: new Date(email.date).toLocaleDateString(),
  });

  // The first line of the template may be a Subject: header — extract it
  const subjectLine = body.split("\n")[0] ?? `Re: ${email.subject}`;
  const subject = subjectLine.startsWith("Subject: ")
    ? subjectLine.slice("Subject: ".length)
    : `Re: ${email.subject}`;

  // Remove the subject line from the body if present
  const bodyWithoutSubject = body.startsWith(subjectLine + "\n")
    ? body.slice((subjectLine + "\n").length)
    : body;

  return {
    emailUid: String(uid),
    originalSender: email.from[0]?.address ?? "",
    subject,
    body: bodyWithoutSubject,
    matchedSkill: bestSkill.name,
    confidence: bestConfidence,
  };
}
