import { describe, expect, it } from "vitest";
import {
  buildPageSpecificQueryVariants,
  discoverRouteInventory,
} from "./route-inventory";

describe("dashboard route inventory", () => {
  it("classifies current navigation routes separately from compatibility and standalone variants", () => {
    const inventory = discoverRouteInventory();

    expect(inventory.canonicalNavigationRoutes).toEqual([
      "/",
      "/agents",
      "/backups",
      "/chat",
      "/config",
      "/context",
      "/docs",
      "/jobs",
      "/logs",
      "/mail",
      "/mcp-servers",
      "/observations",
      "/opencode",
      "/personality",
      "/pipeline",
      "/plugins",
      "/projects",
      "/secrets",
      "/skills",
      "/status",
      "/tasks",
      "/usage",
      "/vscode",
    ]);
    expect(inventory.compatibilityRoutes).toEqual(["/settings"]);
    expect(buildPageSpecificQueryVariants({ docsSpaceId: "0", docsPageId: "0", mailAccount: "none" })
      .filter((variant) => variant.name.startsWith("standalone"))
      .map((variant) => variant.path)).toEqual([
      "/standalone",
      "/standalone",
      "/standalone",
      "/standalone",
      "/standalone",
    ]);
  });
});
