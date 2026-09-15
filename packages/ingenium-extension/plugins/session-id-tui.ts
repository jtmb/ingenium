import type { TuiHostSlotMap, TuiPluginModule, TuiSlotContext } from "@opencode-ai/plugin/tui";
import { jsx } from "@opentui/solid/jsx-runtime";

export default {
  id: "ingenium-session-id",
  tui: async (api) => {
    api.slots.register({
      slots: {
        sidebar_content: (_context: TuiSlotContext, props: TuiHostSlotMap["sidebar_content"]) =>
          jsx("box", {
            width: "100%",
            flexDirection: "column",
            children: [
              jsx("text", { content: "Session ID" }),
              jsx("text", {
                width: "100%",
                minWidth: 0,
                selectable: true,
                wrapMode: "none",
                // Native truncation clips the viewport, not the underlying raw ID.
                truncate: true,
                get content() { return props.session_id; },
              }),
              jsx("text", {
                wrapMode: "word",
                content: "Use terminal selection. Truncated? Widen the view first. No clipboard action.",
              }),
            ],
          }),
      },
    });
  },
} satisfies TuiPluginModule;
