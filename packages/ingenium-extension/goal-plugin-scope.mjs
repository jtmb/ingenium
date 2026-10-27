// Scope the upstream goal plugin to native OpenCode sessions. Never cache an
// allowed agent: the user can switch an existing goal session into Chat.
export const GOAL_TOOLS = new Set([
  "get_goal", "get_goal_history", "list_all_goals", "create_goal", "set_goal",
  "update_goal_objective", "update_goal_status", "update_goal", "stop_goal",
  "replace_goal", "update_goal_plan", "clear_goal",
]);

export function excludedAgent(agent) {
  return typeof agent === "string" &&
    /(?:^|\/)(?:ingenium-chat|ingenium-llm-broker)$/i.test(agent);
}

export function scopedGoalContext(ctx) {
  const excludedSessions = new Set();
  const explicitlyExcluded = (input) => excludedAgent(input?.agent) ||
    input?.prompt?.agents?.some((agent) => excludedAgent(agent.name)) === true;
  const allowed = async (input) => {
    if (typeof input?.sessionID !== "string") return false;
    if (explicitlyExcluded(input)) excludedSessions.add(input.sessionID);
    if (excludedSessions.has(input.sessionID)) return false;
    try {
      const response = await ctx.session.get({ sessionID: input.sessionID });
      const session = response?.data ?? response;
      // A missing/deleted/unreadable session must never admit a continuation.
      if (excludedAgent(session?.agent)) excludedSessions.add(input.sessionID);
      return typeof session?.id === "string" && !excludedSessions.has(input.sessionID);
    } catch {
      return false;
    }
  };
  const requireAllowed = async (input) => {
    if (!await allowed(input)) throw new Error("INGENIUM_GOALS_UNAVAILABLE_IN_CHAT");
  };
  return {
    ...ctx,
    tool: {
      ...ctx.tool,
      transform: (transform) => ctx.tool.transform((editor) => transform({
        ...editor,
        add: (tool) => editor.add({
          ...tool,
          execute: async (args, execution) => {
            await requireAllowed(execution);
            return tool.execute(args, execution);
          },
        }),
      })),
      hook: (name, hook) => ctx.tool.hook(name, async (input) => {
        if (await allowed(input)) return hook(input);
      }),
    },
    command: {
      ...ctx.command,
      transform: (transform) => ctx.command.transform((editor) => transform({
        add: (command) => editor.add({
          ...command,
          execute: async (input, execution) => {
            await requireAllowed(input);
            return command.execute(input, execution);
          },
        }),
      })),
    },
    session: {
      ...ctx.session,
      hook: (name, hook) => ctx.session.hook(name, async (input) => {
        if (await allowed(input)) return hook(input);
      }),
      prompt: async (input) => {
        await requireAllowed(input);
        return ctx.session.prompt(input);
      },
      context: async (input) => {
        await requireAllowed(input);
        return ctx.session.context(input);
      },
    },
    event: {
      ...ctx.event,
      async *subscribe(options) {
        for await (const event of ctx.event.subscribe(options)) {
          // All upstream goal events are session-specific. Unknown envelopes
          // and non-session events cannot start or update a goal.
          const data = event?.data;
          if (data && await allowed(data)) yield event;
        }
      },
    },
  };
}

export async function setupScopedGoals(ctx, upstream) {
  const cleanup = await upstream.setup(scopedGoalContext(ctx));
  const registrations = [];
  try {
    // Run after upstream hooks. Chat receives neither goal definitions nor the
    // universal Goal Mode system reminder, including during compaction.
    const hide = (input) => {
      if (!excludedAgent(input.agent)) return;
      for (const name of Object.keys(input.tools ?? {})) {
        if (GOAL_TOOLS.has(name) || GOAL_TOOLS.has(name.split(".").at(-1))) delete input.tools[name];
      }
    };
    for (const name of ["context", "generate", "compaction"]) {
      registrations.push(await ctx.session.hook(name, hide));
    }
    registrations.push(await ctx.tool.hook("execute.before", (input) => {
      if (excludedAgent(input.agent) && GOAL_TOOLS.has(input.tool.split(".").at(-1))) {
        throw new Error("INGENIUM_GOALS_UNAVAILABLE_IN_CHAT");
      }
    }));
  } catch (error) {
    for (const registration of registrations) await registration.dispose();
    await cleanup?.();
    throw error;
  }
  return async () => {
    for (const registration of registrations) await registration.dispose();
    await cleanup?.();
  };
}
