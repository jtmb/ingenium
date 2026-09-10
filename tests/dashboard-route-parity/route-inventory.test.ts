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
      "/organizations",
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
    expect(inventory.settingsDeepLinks.map(({ id }) => id)).toEqual([
      "general",
      "account",
      "security",
      "sessions",
      "api-tokens",
      "organizations",
      "projects",
      "skills",
      "tasks",
      "jobs",
      "plugins",
      "mail",
      "agents",
      "mcp-servers",
      "config",
      "observations",
      "personality",
      "providers",
      "cloudflare",
      "logs",
    ]);
    expect(inventory.supportedSettingsTabs).toHaveLength(20);
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
