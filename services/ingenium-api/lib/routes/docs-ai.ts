import { Router, Request, Response } from "express";
import { logger, projects } from "ingenium-core";
import { executeSynthesisBroker } from "../opencode-client.js";
import {
  getChatProviderCatalog,
  getStoredOrDefaultChatSelection,
  isAllowedChatSelection,
} from "../chat-provider-catalog.js";

/**
 * AI-assisted documentation routes for the Docs wiki.
 * Docs is globally scoped. It resolves the authenticated, server-owned Chat
 * selection after loading the global Chat catalog; when absent or stale it uses
 * only a server-derived default. Browser-supplied provider and model IDs are
 * intentionally absent from this request contract.
 * Content is truncated to 4000 chars per prompt to keep token usage predictable
 * given that most requested actions only need context, not the full document.
 */
export const router = Router();

// ── Types ──────────────────────────────────────────────────────────────────────

type AIAction =
  | "outline"
  | "continue"
  | "rewrite"
  | "summarize"
  | "fix_grammar"
  | "tone_professional"
  | "tone_casual"
  | "tone_technical";

interface AIRequestBody {
  action?: AIAction;
  content?: string;
  title?: unknown;
  // Subset of content to operate on (for rewrite/grammar fixes on selection)
  selectedText?: unknown;
  /** Never accepted: Docs AI always uses the server-resolved global project. */
  project?: unknown;
}

const MAX_AI_CONTENT_LENGTH = 16_000;
const MAX_AI_TITLE_LENGTH = 512;
const MAX_AI_SELECTED_TEXT_LENGTH = 16_000;
const VALID_ACTIONS: readonly AIAction[] = [
  "outline", "continue", "rewrite", "summarize", "fix_grammar",
  "tone_professional", "tone_casual", "tone_technical",
];

const DOCS_AI_ERRORS = {
  invalidRequest: {
    code: "INVALID_AI_REQUEST",
    message: "Provide a supported action and non-empty documentation content within the allowed size.",
  },
  projectConflict: {
    code: "DOCS_AI_PROJECT_CONFLICT",
    message: "Documentation AI always uses the server-selected global project.",
  },
  globalProjectUnavailable: {
    code: "GLOBAL_PROJECT_UNAVAILABLE",
    message: "Documentation AI requires exactly one active global project. Repair the global project configuration and try again.",
  },
  catalogUnavailable: {
    code: "LLM_CATALOG_UNAVAILABLE",
    message: "The Chat model catalog is temporarily unavailable. Try again later.",
  },
  llmUnavailable: {
    code: "LLM_UNAVAILABLE",
    message: "No Chat provider or model is currently available. Open Chat or Settings → Providers, then try again.",
  },
  brokerError: {
    code: "LLM_BROKER_ERROR",
    message: "The AI service is unavailable. Please try again later.",
  },
  internal: {
    code: "INTERNAL_ERROR",
    message: "Unable to generate documentation assistance. Please try again later.",
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAIAction(value: unknown): value is AIAction {
  return typeof value === "string" && VALID_ACTIONS.includes(value as AIAction);
}

function sendDocsAiError(
  res: Response,
  status: 400 | 422 | 500 | 502 | 503,
  error: { code: string; message: string },
): void {
  res.status(status).json({ error });
}

// ── Prompt builders ────────────────────────────────────────────────────────────

function buildPrompt(action: AIAction, content: string, title?: string, selectedText?: string): string {
  switch (action) {
    case "outline":
      return `You are a documentation assistant. Generate a structured outline for a documentation page.

Page title: ${title || "Untitled"}
Current content:
${content.slice(0, 4000)}

Return ONLY the outline as a markdown list with hierarchical headings (## Title, ### Section, etc.). Include bullet points under each section. Do not include any preamble or explanation.`;

    case "continue":
      return `You are a documentation assistant. Continue writing the following content from where it left off. Match the tone, style, and formatting of the existing content.

Page title: ${title || "Untitled"}
Current content to continue from:
${content.slice(0, 4000)}

Return ONLY the continuation text. Do not include the original content. Do not include any preamble or explanation.`;

    case "rewrite":
      return `You are a documentation assistant. Rewrite the following selected text to be clearer, more concise, and more professional while preserving the original meaning.

${selectedText?.slice(0, 4000) || content.slice(0, 4000)}

Return ONLY the rewritten text. Do not include any preamble or explanation.`;

    case "summarize":
      return `You are a documentation assistant. Summarize the following documentation page into a concise overview paragraph.

Page title: ${title || "Untitled"}
Content:
${content.slice(0, 4000)}

Return ONLY the summary as a paragraph. Do not include any preamble or explanation.`;

    case "fix_grammar":
      return `You are a documentation assistant. Fix all grammar, spelling, and punctuation errors in the following text. Preserve the original meaning, structure, and markdown formatting. Do not rewrite or change the style.

${content.slice(0, 4000)}

Return ONLY the corrected text. Do not include any preamble or explanation.`;

    case "tone_professional":
      return `You are a documentation assistant. Rewrite the following text to have a professional, formal tone suitable for business documentation. Preserve the original meaning, structure, and markdown formatting.

${content.slice(0, 4000)}

Return ONLY the rewritten text. Do not include any preamble or explanation.`;

    case "tone_casual":
      return `You are a documentation assistant. Rewrite the following text to have a casual, conversational tone suitable for internal team documentation. Preserve the original meaning, structure, and markdown formatting.

${content.slice(0, 4000)}

Return ONLY the rewritten text. Do not include any preamble or explanation.`;

    case "tone_technical":
      return `You are a documentation assistant. Rewrite the following text to have a technical, precise tone suitable for developer documentation. Preserve the original meaning, structure, and markdown formatting.

${content.slice(0, 4000)}

Return ONLY the rewritten text. Do not include any preamble or explanation.`;

    default:
      return "";
  }
}

function sendGlobalProjectUnavailable(res: Response): void {
  sendDocsAiError(res, 503, DOCS_AI_ERRORS.globalProjectUnavailable);
}

function resolveDocsGlobalProjectId(res: Response): string | null {
  try {
    const globalProject = projects.getGlobalProject();
    if (globalProject) return globalProject.id;
  } catch {
    logger.warn("docs-ai", "Documentation AI rejected because global project resolution failed");
    sendGlobalProjectUnavailable(res);
    return null;
  }
  sendGlobalProjectUnavailable(res);
  return null;
}

// ── POST /ai ───────────────────────────────────────────────────────────────────
// Reuses the primary LLM config (Settings → Providers) so users don't need
// a separate API key for documentation features.

router.post("/ai", async (req: Request, res: Response) => {
  try {
    if (!isRecord(req.body)) {
      sendDocsAiError(res, 400, DOCS_AI_ERRORS.invalidRequest);
      return;
    }
    const { action, content, title, selectedText, project } = req.body as AIRequestBody;

    if (!isAIAction(action) || typeof content !== "string" || content.length === 0
      || content.length > MAX_AI_CONTENT_LENGTH
      || (title !== undefined && (typeof title !== "string" || title.length > MAX_AI_TITLE_LENGTH))
      || (selectedText !== undefined
        && (typeof selectedText !== "string" || selectedText.length > MAX_AI_SELECTED_TEXT_LENGTH))) {
      sendDocsAiError(res, 400, DOCS_AI_ERRORS.invalidRequest);
      return;
    }

    // Docs navigation may preserve a browser project query parameter, but that
    // context must never select the authority for globally scoped Docs AI.
    // Reject an attempted body override instead of silently accepting a
    // conflicting authority hint.
    if (project !== undefined) {
      sendDocsAiError(res, 422, DOCS_AI_ERRORS.projectConflict);
      return;
    }

    const projectId = resolveDocsGlobalProjectId(res);
    if (!projectId) return;

    let catalog: Awaited<ReturnType<typeof getChatProviderCatalog>>;
    try {
      catalog = await getChatProviderCatalog(projectId);
    } catch {
      logger.warn("docs-ai", "Unable to load the global Chat provider catalog", { projectId });
      sendDocsAiError(res, 503, DOCS_AI_ERRORS.catalogUnavailable);
      return;
    }

    if (catalog.unavailable) {
      logger.warn("docs-ai", "Global Chat provider catalog is unavailable", { projectId });
      sendDocsAiError(res, 503, DOCS_AI_ERRORS.catalogUnavailable);
      return;
    }

    const selection = getStoredOrDefaultChatSelection(projectId, catalog.providers);

    if (!selection) {
      sendDocsAiError(res, 503, DOCS_AI_ERRORS.llmUnavailable);
      return;
    }

    if (!isAllowedChatSelection(catalog.providers, selection)) {
      sendDocsAiError(res, 503, DOCS_AI_ERRORS.llmUnavailable);
      return;
    }

    const prompt = buildPrompt(
      action,
      content,
      typeof title === "string" ? title : undefined,
      typeof selectedText === "string" ? selectedText : undefined,
    );
    let result: Awaited<ReturnType<typeof executeSynthesisBroker>>;
    try {
      result = await executeSynthesisBroker({
        projectId,
        system: "You are a documentation assistant. Respond with exactly the requested output, no preamble.",
        user: prompt,
        timeoutMs: 60_000,
        selection: { providerID: selection.providerId, modelID: selection.modelId },
      });
    } catch (error) {
      logger.warn("docs-ai", "Broker request threw unexpectedly", {
        projectId,
        error: error instanceof Error ? error.name : "unknown",
      });
      sendDocsAiError(res, 502, DOCS_AI_ERRORS.brokerError);
      return;
    }
    if (!result.ok) {
      logger.warn("docs-ai", "Broker request failed", { projectId });
      sendDocsAiError(res, 502, DOCS_AI_ERRORS.brokerError);
      return;
    }
    res.json({ data: { result: result.content } });
  } catch {
    logger.error("docs-ai", "AI documentation request failed");
    sendDocsAiError(res, 500, DOCS_AI_ERRORS.internal);
  }
});
