import { Router, Request, Response } from "express";
import { logger, projects } from "ingenium-core";
import {
  DOCS_AI_BROKER_TIMEOUT_MS,
  executeSynthesisBroker,
} from "../opencode-client.js";
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
 * Request documents may be larger than the prompt context. The API retains the
 * complete request for validation, then selects bounded, action-specific prompt
 * context so DocsEditor can safely apply results against its full snapshot.
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

/**
 * A 128 KiB UTF-8 document is large enough for normal repository documentation
 * pages while leaving substantial headroom beneath the API's 2 MiB JSON body
 * limit, including JSON escaping and the separately bounded selection/title.
 */
const MAX_AI_CONTENT_BYTES = 128 * 1024;
const MAX_AI_TITLE_LENGTH = 512;
const MAX_AI_SELECTED_TEXT_LENGTH = 16_000;
const MAX_AI_PROMPT_DOCUMENT_CONTEXT_LENGTH = 4_000;
const VALID_ACTIONS: readonly AIAction[] = [
  "outline", "continue", "rewrite", "summarize", "fix_grammar",
  "tone_professional", "tone_casual", "tone_technical",
];

const DOCS_AI_ERRORS = {
  invalidRequest: {
    code: "INVALID_AI_REQUEST",
    message: "Provide a supported action and non-empty content, a title for a blank outline, or selected text for rewrite.",
  },
  contentTooLarge: (action: AIAction) => ({
    code: "DOCS_AI_CONTENT_TOO_LARGE",
    message: `The ${action} action accepts documentation content up to ${MAX_AI_CONTENT_BYTES.toLocaleString("en-US")} UTF-8 bytes.`,
  }),
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
  brokerTimeout: {
    code: "LLM_BROKER_TIMEOUT",
    message: "The AI service timed out. Please try again later.",
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
  status: 400 | 413 | 422 | 500 | 502 | 503 | 504,
  error: { code: string; message: string },
): void {
  res.status(status).json({ error });
}

function getDocumentPromptContext(action: AIAction, content: string): string {
  // Continue must see the end of the document it will extend. Other document
  // actions use a bounded leading context; Rewrite uses selectedText instead.
  return action === "continue"
    ? content.slice(-MAX_AI_PROMPT_DOCUMENT_CONTEXT_LENGTH)
    : content.slice(0, MAX_AI_PROMPT_DOCUMENT_CONTEXT_LENGTH);
}

// ── Prompt builders ────────────────────────────────────────────────────────────

function buildPrompt(action: AIAction, content: string, title?: string, selectedText?: string): string {
  const documentContext = getDocumentPromptContext(action, content);

  switch (action) {
    case "outline":
      return `You are a documentation assistant. Generate a structured outline for a documentation page.

Page title: ${title || "Untitled"}
Current content:
${documentContext}

Return ONLY the outline as a markdown list with hierarchical headings (## Title, ### Section, etc.). Include bullet points under each section. Do not include any preamble or explanation.`;

    case "continue":
      return `You are a documentation assistant. Continue writing the following content from where it left off. Match the tone, style, and formatting of the existing content.

Page title: ${title || "Untitled"}
Current content to continue from:
${documentContext}

Return ONLY the continuation text. Do not include the original content. Do not include any preamble or explanation.`;

    case "rewrite":
      return `You are a documentation assistant. Rewrite the following selected text to be clearer, more concise, and more professional while preserving the original meaning.

${selectedText ?? ""}

Return ONLY the rewritten text. Do not include any preamble or explanation.`;

    case "summarize":
      return `You are a documentation assistant. Summarize the following documentation page into a concise overview paragraph.

Page title: ${title || "Untitled"}
Content:
${documentContext}

Return ONLY the summary as a paragraph. Do not include any preamble or explanation.`;

    case "fix_grammar":
      return `You are a documentation assistant. Fix all grammar, spelling, and punctuation errors in the following text. Preserve the original meaning, structure, and markdown formatting. Do not rewrite or change the style.

${documentContext}

Return ONLY the corrected text. Do not include any preamble or explanation.`;

    case "tone_professional":
      return `You are a documentation assistant. Rewrite the following text to have a professional, formal tone suitable for business documentation. Preserve the original meaning, structure, and markdown formatting.

${documentContext}

Return ONLY the rewritten text. Do not include any preamble or explanation.`;

    case "tone_casual":
      return `You are a documentation assistant. Rewrite the following text to have a casual, conversational tone suitable for internal team documentation. Preserve the original meaning, structure, and markdown formatting.

${documentContext}

Return ONLY the rewritten text. Do not include any preamble or explanation.`;

    case "tone_technical":
      return `You are a documentation assistant. Rewrite the following text to have a technical, precise tone suitable for developer documentation. Preserve the original meaning, structure, and markdown formatting.

${documentContext}

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

    const hasContent = typeof content === "string" && content.trim().length > 0;
    const hasTitle = typeof title === "string" && title.trim().length > 0;
    const hasSelection = typeof selectedText === "string" && selectedText.trim().length > 0;
    const requiresContent = action !== "outline" && action !== "rewrite";
    const blankOutlineHasTitle = action !== "outline" || hasContent || hasTitle;

    if (!isAIAction(action) || typeof content !== "string"
      || (title !== undefined && (typeof title !== "string" || title.length > MAX_AI_TITLE_LENGTH))
      || (selectedText !== undefined
        && (typeof selectedText !== "string" || selectedText.length > MAX_AI_SELECTED_TEXT_LENGTH))
      || (requiresContent && !hasContent)
      || !blankOutlineHasTitle
      || (action === "rewrite" && !hasSelection)) {
      sendDocsAiError(res, 400, DOCS_AI_ERRORS.invalidRequest);
      return;
    }

    if (Buffer.byteLength(content, "utf8") > MAX_AI_CONTENT_BYTES) {
      sendDocsAiError(res, 413, DOCS_AI_ERRORS.contentTooLarge(action));
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

    let selection: { providerId: string; modelId: string } | null;
    try {
      selection = getStoredOrDefaultChatSelection(projectId, catalog.providers);
      if (!selection || !isAllowedChatSelection(catalog.providers, selection)) {
        sendDocsAiError(res, 503, DOCS_AI_ERRORS.llmUnavailable);
        return;
      }
    } catch {
      // Selection resolution reads server-owned state. A failure here is a
      // temporary dependency problem, not an internal error a browser can act
      // on, and must not expose provider or storage diagnostics.
      logger.warn("docs-ai", "Unable to resolve the global Chat selection", { projectId });
      sendDocsAiError(res, 503, DOCS_AI_ERRORS.catalogUnavailable);
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
        timeoutMs: DOCS_AI_BROKER_TIMEOUT_MS,
        timeoutPolicy: "docs-ai",
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
      if (result.error === "timeout") {
        logger.warn("docs-ai", "Broker request timed out", { projectId });
        sendDocsAiError(res, 504, DOCS_AI_ERRORS.brokerTimeout);
        return;
      }
      logger.warn("docs-ai", "Broker request failed", { projectId });
      sendDocsAiError(res, 502, DOCS_AI_ERRORS.brokerError);
      return;
    }
    if (!result.content.trim()) {
      logger.warn("docs-ai", "Broker request returned no usable content", { projectId });
      sendDocsAiError(res, 502, DOCS_AI_ERRORS.brokerError);
      return;
    }
    res.json({ data: { result: result.content } });
  } catch {
    logger.error("docs-ai", "AI documentation request failed");
    sendDocsAiError(res, 500, DOCS_AI_ERRORS.internal);
  }
});
