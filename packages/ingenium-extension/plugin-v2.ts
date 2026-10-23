import type { Plugin } from "@opencode/plugin";
import { tool as legacyTool, type Hooks as LegacyHooks } from "@opencode-ai/plugin";
import type { OpenCodeV2Client } from "./opencode-v2.js";

/**
 * OpenCode V2 adapter for the retained V1 plugin bodies.
 *
 * V2 does not run V1 plugin implementations: a V2 plugin default-exports a
 * definition with an `id` and `setup(ctx)` that registers hooks, transforms,
 * tools, and event subscriptions through the context. The retained Ingenium
 * plugin bodies still use the V1 `event`/`tool` shape and the pinned V1
 * `@opencode-ai/sdk/v2` session client.
 *
 * `defineV2Plugin` bridges the two without duplicating plugin behavior:
 *  - `setup` builds a V1-compatible context whose `client.v2` session surface
 *    reads sessions through the V2 context and forwards V2 events into the V1
 *    `event` hook with an adapted envelope.
 *  - the returned object keeps the V1 `server` factory so OpenCode 1.18.31
 *    keeps loading the same implementation until the container retires.
 *
 * This is a transition adapter, not a second implementation. Remove the V1
 * branch and this file once the compatibility runtime moves to V2.
 */

/** Minimal V1 plugin context the retained factories accept. */
export interface LegacyPluginContext {
  worktree: string;
  client: unknown;
  serverUrl?: URL;
}

export type LegacyPluginFactory = (ctx: LegacyPluginContext) => Promise<LegacyHooks> | LegacyHooks;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

/** V2 events carry the session ID under `data`; V1 hooks expected `properties`. */
export function legacyPluginEvent(event: unknown): { type: string; properties: JsonRecord } {
  const value = record(event);
  const data = record(value?.data);
  const type = typeof value?.type === "string" ? value.type : "";
  const sessionID = data?.sessionID;
  return { type, properties: typeof sessionID === "string" ? { sessionID } : {} };
}

/**
 * Adapt the V2 context's session API to the `OpenCodeV2Client` surface the
 * retained plugin bodies use. The V2 context returns the whole session context
 * in one call, so pagination is replayed locally with a positional cursor while
 * preserving the SDK response envelope.
 */
export function v2SessionAdapter(ctx: Plugin.Context): OpenCodeV2Client {
  const session = {
    get: async ({ sessionID }: { sessionID: string }) => ({
      data: { data: await ctx.session.get({ sessionID }) },
    }),
    messages: async (input: { sessionID: string; limit?: number; order?: "asc" | "desc"; cursor?: string }) => {
      const messages = await ctx.session.context({ sessionID: input.sessionID });
      const descending = input.order === "desc" || input.cursor?.startsWith("desc:") === true;
      const ordered = descending ? [...messages].reverse() : messages;
      const start = Number.parseInt(input.cursor?.replace(/^desc:/, "") ?? "0", 10);
      const offset = Number.isSafeInteger(start) && start > 0 ? start : 0;
      const size = Math.max(1, Math.min(input.limit ?? 100, 100));
      const page = ordered.slice(offset, offset + size);
      const next = offset + page.length < ordered.length
        ? `${descending ? "desc:" : ""}${offset + page.length}`
        : undefined;
      return { data: { data: page, cursor: next === undefined ? undefined : { next } } };
    },
  };
  return { session } as unknown as OpenCodeV2Client;
}

/** Convert the retained V1 tool argument tuple into a V2 JSON Schema input. */
export function toolInputSchema(args: unknown): unknown {
  const shape = record(args) ?? {};
  const schema = legacyTool.schema.object(shape as never);
  // Default ("output") mode keeps `additionalProperties: false`; the retained
  // tools define plain argument tuples without defaults or transforms, so the
  // input and output shapes are identical.
  return legacyTool.schema.toJSONSchema(schema);
}

function toolResult(result: unknown): unknown {
  if (typeof result === "string") return { content: result };
  const value = record(result);
  if (value && typeof value.output === "string") {
    return value.metadata === undefined
      ? { content: value.output }
      : { content: value.output, metadata: value.metadata };
  }
  return result;
}

export interface V2PluginDefinition {
  id: string;
  legacy: LegacyPluginFactory;
}

/**
 * Build the dual V1/V2 default export for a retained plugin body.
 *
 * V2 loads `setup`; V1 (OpenCode 1.18.29+ object entrypoints) keeps calling
 * `server`. Both share the same implementation.
 */
export function defineV2Plugin(input: V2PluginDefinition): Plugin.Plugin & { server: LegacyPluginFactory } {
  const setup = async (ctx: Plugin.Context) => {
    const worktree = ctx.location.directory;
    const hooks = await input.legacy({ worktree, client: { v2: v2SessionAdapter(ctx) } });

    if (hooks.tool !== undefined) {
      const tools = Object.entries(hooks.tool);
      await ctx.tool.transform((editor) => {
        for (const [name, definition] of tools) {
          editor.add({
            name,
            description: definition.description,
            input: toolInputSchema(definition.args),
            execute: async (args: unknown, toolCtx: unknown) => {
              // The V2 tool context carries no directory/worktree; retain the V1
              // behavior by supplying the plugin location as the fallback and
              // letting any native V2 field win.
              const context = { directory: worktree, worktree, ...(toolCtx as JsonRecord) };
              return toolResult(await definition.execute(args as never, context as never));
            },
          } as never);
        }
      });
    }

    const controller = new AbortController();
    const events = hooks.event;
    if (events !== undefined) {
      void (async () => {
        try {
          for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
            await events({ event: legacyPluginEvent(event) as never });
          }
        } catch {
          // Subscription aborted on unload; plugin failures must not escape here.
        }
      })();
    }

    return () => controller.abort();
  };

  return { id: input.id, setup, server: input.legacy };
}
