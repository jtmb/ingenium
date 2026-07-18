import { Router, Request, Response } from "express";
import { logger, safeLlmFetch, synthesisLlm } from "ingenium-core";

/**
 * AI-assisted documentation routes for the Docs wiki.
 * All routes use the configured Synthesis LLM (same model used for self-learning).
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
  action: AIAction;
  content: string;
  title?: string;
  // Subset of content to operate on (for rewrite/grammar fixes on selection)
  selectedText?: string;
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

${selectedText || content.slice(0, 4000)}

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

// ── POST /ai ───────────────────────────────────────────────────────────────────
// Reuses the primary LLM config (Settings → Providers) so users don't need
// a separate API key for documentation features.

router.post("/ai", async (req: Request, res: Response) => {
  try {
    const { action, content, title, selectedText } = req.body as AIRequestBody;

    // Validate required fields
    if (!action) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "action is required" } });
      return;
    }
    if (!content) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "content is required" } });
      return;
    }

    // Validate action
    const validActions: AIAction[] = [
      "outline", "continue", "rewrite", "summarize", "fix_grammar",
      "tone_professional", "tone_casual", "tone_technical",
    ];
    if (!validActions.includes(action)) {
      res.status(400).json({
        error: { code: "BAD_REQUEST", message: `Invalid action: ${action}. Valid: ${validActions.join(", ")}` },
      });
      return;
    }

    // Resolve LLM config
    const config = synthesisLlm.resolveLLMConfig();
    if (!config || !config.model) {
      res.status(400).json({
        error: { code: "LLM_NOT_CONFIGURED", message: "AI features require an LLM to be configured in Settings" },
      });
      return;
    }

    const prompt = buildPrompt(action, content, title, selectedText);
    const baseEndpoint = (config.endpoint || "https://api.openai.com/v1")
      .replace(/\/+v1\/?$/i, "").replace(/\/+$/, "");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

    // temperature 0.5 balances creativity (tone rewrites) with consistency (outlines, summaries)
    // max_tokens 8192: 🔴 must NOT fall back to reasoning_content — this ensures the model
    // allocates enough output tokens for full document transformations
    const response = await safeLlmFetch(`${baseEndpoint}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: "You are a documentation assistant. Respond with exactly the requested output, no preamble." },
          { role: "user", content: prompt },
        ],
        temperature: 0.5,
        max_tokens: 8192,
      }),
    }, { allowPrivateNetwork: config.allowPrivateNetwork === true, timeoutMs: 60_000 });

    if (!response.ok) {
      logger.warn("docs-ai", `LLM upstream request failed with status ${response.status}`);
      // Release the upstream body to prevent connection-pool exhaustion
      await response.body?.cancel();
      res.status(502).json({
        error: { code: "LLM_ERROR", message: "The AI service returned an error. Please try again later." },
      });
      return;
    }

    const json = await response.json();
    // 🔴 NEVER fall back to reasoning_content — must be content only
    const result = json.choices?.[0]?.message?.content || "";

    res.json({ data: { result } });
  } catch (err) {
    logger.error("docs-ai", "AI documentation request failed");
    if (err instanceof Error && err.message.startsWith("endpoint ")) {
      res.status(502).json({
        error: { code: "LLM_ERROR", message: "The AI service returned an error. Please try again later." },
      });
      return;
    }
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to generate documentation assistance. Please try again later." } });
  }
});
