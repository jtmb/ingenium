export interface WorkSuggestion { id: string; label: string; prompt: string; reason: string }

export function workSuggestions(context: { hasSession: boolean; hasFiles: boolean; hasChanges: boolean; hasError: boolean }): WorkSuggestion[] {
  if (context.hasError) return [{ id: "diagnose", label: "Diagnose the failure", prompt: "Explain the current task failure using the available evidence. Preserve the first failure and propose the next safe diagnostic step.", reason: "This conversation reports an error." }];
  if (!context.hasSession) return [
    { id: "explore", label: "Explore this workspace", prompt: "Explore this workspace and explain its structure before proposing changes.", reason: "No conversation is selected." },
    { id: "plan", label: "Plan a change", prompt: "Help me plan a change in this workspace. Establish the current state and acceptance criteria first.", reason: "No conversation is selected." },
  ];
  const suggestions: WorkSuggestion[] = [];
  if (context.hasChanges) suggestions.push({ id: "review", label: "Review current changes", prompt: "Review the current conversation's changes for correctness and regressions. Explain actionable findings with file references.", reason: "A nonempty change list has been loaded for this conversation." });
  if (context.hasFiles) suggestions.push({ id: "files", label: "Explain attached files", prompt: "Explain the files attached to this conversation, their relevant details and any limitations in what you can inspect.", reason: "This conversation contains native file parts." });
  suggestions.push({ id: "continue", label: "Assess the next step", prompt: "Assess the current task against its acceptance criteria. Identify completed work, remaining requirements and the next concrete step.", reason: "A conversation is selected." });
  return suggestions;
}
