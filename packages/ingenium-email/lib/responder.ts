/** Response suggestion engine: pattern-match emails against learned skills. */

import type { ResponseSuggestion, EmailMessage } from "./types.js";
import type { Skill } from "ingenium-core";
import { getEmail } from "./imap.js";
import { loadEmailSkills } from "./triage.js";

/** Extract a response template from skill content between ```template and ``` markers. */
export function extractTemplate(skillContent: string): string | null {
  const match = skillContent.match(/```template\s*\n([\s\S]*?)\n\s*```/i);
  if (!match?.[1]) return null;
  return match[1].trim();
}

/** Fill placeholders in a template with actual values. */
export function fillTemplate(
  template: string,
  vars: { sender: string; subject: string; date: string },
): string {
  return template
    .replace(/\{\{sender\}\}/g, vars.sender)
    .replace(/\{\{subject\}\}/g, vars.subject)
    .replace(/\{\{date\}\}/g, vars.date);
}

/** Calculate confidence score for a skill against an email. */
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

/** Suggest an auto-response for an email based on matched skills. */
export async function suggestResponse(
  projectId: string,
  accountId: string,
  uid: number,
  folder: string = "INBOX",
): Promise<ResponseSuggestion | null> {
  const email = await getEmail(accountId, folder, uid);
  if (!email) return null;

  const emailSkills = loadEmailSkills(projectId);

  let bestSkill: Skill | null = null;
  let bestConfidence = 0;
  let bestTemplate: string | null = null;

  for (const skill of emailSkills) {
    const confidence = calculateConfidence(skill, email);
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

  const subjectLine = body.split("\n")[0] ?? `Re: ${email.subject}`;
  const subject = subjectLine.startsWith("Subject: ")
    ? subjectLine.slice("Subject: ".length)
    : `Re: ${email.subject}`;

  // Remove the subject line from the body
  const bodyWithoutSubject = body.startsWith(subjectLine + "\n")
    ? body.slice((subjectLine + "\n").length)
    : body;

  return {
    emailUid: uid,
    originalSender: email.from[0]?.address ?? "",
    subject,
    body: bodyWithoutSubject,
    matchedSkill: bestSkill.name,
    confidence: bestConfidence,
  };
}
