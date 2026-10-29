import type { Actor, DotScope, Suggestion } from "../../../../packages/veyra-automation/contracts.js";
import { DotError, type DotService, type SuggestionInput } from "./service.js";

export interface ProactiveSources {
  isEnabled(actor: Actor, scope: DotScope): boolean;
  readEligible(actor: Actor, scope: DotScope, limit: number): SuggestionInput[];
}
/** Called by an existing authorized lifecycle/event hook; never starts a timer or extraction. */
export function collectProactiveSuggestions(service: DotService, actor: Actor, scope: DotScope, sources: ProactiveSources): Suggestion[] {
  service.assertCanSuggest(actor,scope);
  if(!sources.isEnabled(actor,scope))return [];
  const inputs=sources.readEligible(actor,scope,20);
  if(!Array.isArray(inputs) || inputs.length>20)throw new DotError("DOT_VALIDATION");
  return inputs.map(input=>service.proposeForSource(actor,scope,input));
}
