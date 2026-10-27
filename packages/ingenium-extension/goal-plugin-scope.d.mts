export const GOAL_TOOLS: Set<string>;
export function excludedAgent(agent: unknown): boolean;
export function scopedGoalContext(ctx: any): any;
export function setupScopedGoals(ctx: any, upstream: any): Promise<() => Promise<void>>;
