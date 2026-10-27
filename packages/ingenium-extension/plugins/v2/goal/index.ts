import upstream from "../../../vendor/opencode-goal-plugin/server.mjs";
import { setupScopedGoals } from "../../../goal-plugin-scope.mjs";

export default {
  id: "ingenium.goal-mode",
  setup: (ctx: unknown) => setupScopedGoals(ctx, upstream),
};
