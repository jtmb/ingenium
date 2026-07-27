type SearchParamsInput = Pick<URLSearchParams, "toString">;

/** Update Docs space/page state without dropping project or other query context. */
export function buildDocsUrl(
  currentSearchParams: SearchParamsInput,
  spaceId: number | null,
  pageId: number | null,
): string {
  const params = new URLSearchParams(currentSearchParams.toString());
  if (spaceId === null) params.delete("space");
  else params.set("space", String(spaceId));
  if (pageId === null) params.delete("page");
  else params.set("page", String(pageId));
  const query = params.toString();
  return query ? `/docs?${query}` : "/docs";
}

/**
 * Encode Docs state for a standalone URL. `page` is reserved by `/standalone`
 * to select its surface, so the Docs page ID is carried as `docsPage` and is
 * restored to `page` only during the handoff back to `/docs`.
 */
export function buildDocsWorkspacePopoutState(
  currentSearchParams: SearchParamsInput,
): Record<string, string> {
  const state: Record<string, string> = {};
  const params = new URLSearchParams(currentSearchParams.toString());
  params.forEach((value, key) => {
    if (key === "standalone") return;
    state[key === "page" ? "docsPage" : key] = value;
  });
  return state;
}

/**
 * Return to the Docs workspace without losing project, space, page, or other
 * Docs query state. The standalone route's own `page=docs` and `standalone=1`
 * parameters are intentionally omitted from the destination.
 */
export function buildStandaloneDocsHandoffUrl(
  standaloneSearchParams: SearchParamsInput,
  selectedSpaceId: number,
): string {
  const source = new URLSearchParams(standaloneSearchParams.toString());
  const destination = new URLSearchParams();
  const docsPageId = source.get("docsPage");

  source.forEach((value, key) => {
    if (key === "page" || key === "standalone" || key === "docsPage") return;
    destination.set(key, value);
  });
  destination.set("space", String(selectedSpaceId));
  if (docsPageId) destination.set("page", docsPageId);

  return `/docs?${destination.toString()}`;
}
