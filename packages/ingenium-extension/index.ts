/** Observes user behavior patterns via session events and triggers the self-learning synthesis pipeline. */
export { ObserverPlugin } from "./observer.js";

/** Backward-compatible skills-only sync; delegates to resource-sync.ts for existing npm installations. */
export { SkillSyncPlugin } from "./skill-sync.js";

/** Lightweight HTTP trigger for the server-side extraction engine, throttled to 1/60s on session.idle events. */
export { AutoObserverPlugin } from "./auto-observer.js";

/** Pushes all disk resources to the API on first session.created (backward-compat onboarding wrapper). */
export { OnboardingSyncPlugin } from "./onboarding-sync.js";

/** Unified bidirectional sync engine for skills, agents, plugins, commands, and config between API and disk. */
export { ResourceSyncPlugin } from "./resource-sync.js";
