/** Email triage: categorize, score priority, and match against learned skills. */

import { skills as skillsModule } from "ingenium-core";
import type { Skill } from "ingenium-core";
import type { TriageResult } from "./types.js";
import { listEmails } from "./imap.js";

// ── Keyword categories ────────────────────────────────────────────────────

const CATEGORIES: Record<string, string[]> = {
  budget: ["budget", "invoice", "payment", "cost", "price", "quote", "estimate", "expense", "receipt"],
  meeting: ["meeting", "calendar", "schedule", "appointment", "call", "zoom", "teams", "conference", "agenda"],
  urgent: ["urgent", "asap", "immediately", "critical", "emergency", "deadline", "overdue", "priority"],
  question: ["question", "how to", "what is", "can you", "could you", "help with", "wondering", "clarify"],
  update: ["update", "status", "progress", "report", "summary", "weekly", "monthly", "review"],
  personal: ["personal", "family", "friend", "hey", "catch up", "dinner", "lunch", "coffee"],
  newsletter: ["newsletter", "digest", "weekly roundup", "unsubscribe", "subscription", "promotion", "offer", "sale"],
  automated: ["no-reply", "noreply", "automated", "do not reply", "notification", "alert", "confirmation", "receipt", "reset your password"],
};

// ── Priority keywords ─────────────────────────────────────────────────────

const URGENCY_KEYWORDS = [
  "urgent", "asap", "immediately", "critical", "emergency", "deadline", "overdue",
  "time sensitive", "action required", "requires attention", "priority",
];

const MEETING_KEYWORDS = [
  "meeting", "calendar", "schedule", "appointment", "call", "zoom", "teams",
];

// ── Helpers ───────────────────────────────────────────────────────────────

function scoreText(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  const hits = keywords.filter((kw) => lower.includes(kw)).length;
  return Math.min(hits / Math.max(keywords.length, 1), 1);
}

function categorizeEmail(subject: string, bodyText: string): string {
  const combined = `${subject} ${bodyText}`.toLowerCase();
  let bestCategory = "general";
  let bestScore = 0;

  for (const [cat, keywords] of Object.entries(CATEGORIES)) {
    const score = scoreText(combined, keywords);
    if (score > bestScore) {
      bestScore = score;
      bestCategory = cat;
    }
  }

  return bestCategory;
}

function scorePriority(subject: string, bodyText: string, senderAddress: string, highPrioritySenders: string[]): "high" | "medium" | "low" {
  const combined = `${subject} ${bodyText}`.toLowerCase();

  // Check high-priority senders
  if (highPrioritySenders.some((s) => senderAddress.toLowerCase().includes(s.toLowerCase()))) {
    return "high";
  }

  // Check urgency keywords
  const urgencyScore = scoreText(combined, URGENCY_KEYWORDS);
  if (urgencyScore > 0) return "high";

  // Meeting keywords
  const meetingScore = scoreText(combined, MEETING_KEYWORDS);
  if (meetingScore > 0) return "medium";

  return "low";
}

function suggestAction(priority: "high" | "medium" | "low", category: string, matchedSkills: string[]): TriageResult["suggestedAction"] {
  if (category === "automated" || category === "newsletter") return "ignore";
  if (priority === "high" && matchedSkills.length > 0) return "reply_now";
  if (priority === "medium" && matchedSkills.length > 0) return "draft";
  if (priority === "high") return "reply_now";
  if (matchedSkills.length > 0) return "draft";
  return "review_later";
}

// ── Self-learning integration ─────────────────────────────────────────────

/** Load all skills tagged with "email" or "response" from the DB. */
export function loadEmailSkills(projectId: string): Skill[] {
  const allSkills = skillsModule.listSkills(projectId);
  return allSkills.filter((s) => {
    const tags = (s.tags ?? "").toLowerCase();
    const cat = (s.category ?? "").toLowerCase();
    return (
      cat === "email" ||
      tags.includes("email") ||
      tags.includes("response") ||
      tags.includes("triage")
    );
  });
}

/** Extract high-priority sender addresses from email skills' tags. */
export function loadHighPrioritySenders(projectId: string): string[] {
  const emailSkills = loadEmailSkills(projectId);
  const senders: string[] = [];
  for (const skill of emailSkills) {
    const tags = (skill.tags ?? "").split(",").map((t) => t.trim());
    for (const tag of tags) {
      // Tags that look like email addresses typically have @
      if (tag.includes("@")) {
        senders.push(tag);
      }
      // Also match "from:<address>", "sender:<address>" patterns
      const fromMatch = tag.match(/^(?:from|sender):(.+)$/i);
      if (fromMatch?.[1]) {
        senders.push(fromMatch[1]);
      }
    }
  }
  return [...new Set(senders)];
}

// ── Main triage function ──────────────────────────────────────────────────

/** Triage a batch of unread emails. Returns sorted by priority (high first). */
export async function triageEmails(
  projectId: string,
  accountId: string,
  limit: number = 20,
): Promise<TriageResult[]> {
  const emailSkills = loadEmailSkills(projectId);
  const highPrioritySenders = loadHighPrioritySenders(projectId);

  // Fetch recent unread emails
  const { messages } = await listEmails(accountId, "INBOX", 1, limit, { unseen: true });

  const results: TriageResult[] = [];

  for (const msg of messages) {
    const senderAddr = msg.from[0]?.address ?? "";
    const bodyText = msg.body.text ?? msg.body.html ?? "";
    const category = categorizeEmail(msg.subject, bodyText);
    const priority = scorePriority(msg.subject, bodyText, senderAddr, highPrioritySenders);

    // Match skills: check if sender or keywords match any email skill
    const matchedSkills: string[] = [];
    const combined = `${msg.subject} ${bodyText} ${senderAddr}`.toLowerCase();

    for (const skill of emailSkills) {
      const skillContent = (skill.content ?? "").toLowerCase();
      const skillTags = (skill.tags ?? "").toLowerCase();

      // Check if sender address matches a tag
      if (skillTags.includes(senderAddr.toLowerCase())) {
        matchedSkills.push(skill.name);
        continue;
      }

      // Check keyword overlap between email content and skill content
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
      if (overlap >= 3) {
        matchedSkills.push(skill.name);
      }
    }

    const action = suggestAction(priority, category, matchedSkills);
    const confidence = matchedSkills.length > 0 ? Math.min(0.5 + matchedSkills.length * 0.1, 1.0) : 0.2;

    results.push({
      emailUid: msg.uid,
      category,
      priority,
      suggestedAction: action,
      matchedSkills: [...new Set(matchedSkills)],
      confidence,
    });
  }

  // Sort: high → medium → low
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  results.sort((a, b) => priorityOrder[a.priority]! - priorityOrder[b.priority]!);

  return results;
}
