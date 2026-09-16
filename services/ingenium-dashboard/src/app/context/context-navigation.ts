/**
 * Preserve project and other route state while changing the selected
 * conversation in the context index.
 */
export function buildContextUrl(
  current: URLSearchParams,
  conversationId: string | null,
): string {
  const next = new URLSearchParams(current.toString());
  if (conversationId) next.set("conversation", conversationId);
  else next.delete("conversation");
  const query = next.toString();
  return `/context${query ? `?${query}` : ""}`;
}
