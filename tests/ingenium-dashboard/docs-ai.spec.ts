import { expect, test, type Route } from "./fixture";

const LARGE_DOCUMENT = `# Large architecture document\n\n${"bounded documentation content ".repeat(2_600)}`;
const DOC_PAGE = {
  id: 7,
  spaceId: 1,
  parentPageId: null,
  title: "Large architecture document",
  slug: "large-architecture-document",
  content: LARGE_DOCUMENT,
  revision: 1,
  status: "draft" as const,
  sortOrder: 0,
  isFavorite: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/**
 * Runs in a real browser against the production dashboard fixture. Docs reads
 * are intercepted so the test neither needs a configured provider nor mutates
 * the fixture's document state.
 */
test.describe("Docs AI browser request contract", () => {
  test("Summarize submits a 70 KiB document unchanged and renders the safe result", async ({ page }) => {
    expect(Buffer.byteLength(LARGE_DOCUMENT, "utf8")).toBeGreaterThan(70 * 1024);

    await page.route("**/api/v1/docs/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;

      if (request.method() !== "GET") {
        await json(route, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
        return;
      }
      if (pathname === "/api/v1/docs/spaces") {
        await json(route, 200, { data: [{
          id: 1,
          name: "Engineering",
          slug: "engineering",
          description: "",
          icon: "",
          sortOrder: 0,
          createdAt: DOC_PAGE.createdAt,
          updatedAt: DOC_PAGE.updatedAt,
        }], total: 1 });
        return;
      }
      if (pathname === "/api/v1/docs/spaces/1/tree") {
        await json(route, 200, { data: [{ ...DOC_PAGE, children: [] }] });
        return;
      }
      if (pathname === "/api/v1/docs/pages/7/draft") {
        await json(route, 200, { data: null });
        return;
      }
      if (pathname === "/api/v1/docs/pages/7") {
        await json(route, 200, { data: DOC_PAGE });
        return;
      }
      await json(route, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
    });

    let summarizePayload: Record<string, unknown> | undefined;
    await page.route("**/api/v1/docs/ai", async (route) => {
      summarizePayload = route.request().postDataJSON() as Record<string, unknown>;
      await json(route, 200, { data: { result: "This is the large document summary." } });
    });

    await page.goto("/docs?space=1&page=7");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("button", { name: "AI", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "AI", exact: true }).click();
    const summarize = page.getByRole("menuitem", { name: "Summarize", exact: true });
    await expect(summarize).toBeEnabled();
    const response = page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname === "/api/v1/docs/ai"
      && candidate.request().method() === "POST",
    );
    await summarize.click();
    await response;

    await expect(page.getByText("This is the large document summary.")).toBeVisible();
    expect(summarizePayload).toMatchObject({
      action: "summarize",
      content: LARGE_DOCUMENT,
      title: DOC_PAGE.title,
    });
    expect(summarizePayload).not.toHaveProperty("project");
    expect(summarizePayload).not.toHaveProperty("providerId");
    expect(summarizePayload).not.toHaveProperty("modelId");
  });
});
