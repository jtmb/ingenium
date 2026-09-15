/**
 * Keep the active project explicit while navigating between dashboard routes.
 * Existing page state and hash fragments are retained for the destination.
 */
export function buildProjectNavigationHref(
  pathname: string,
  project: string,
  currentSearch = "",
  hash = "",
): string {
  const params = new URLSearchParams(currentSearch);
  params.set("project", project);
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}
