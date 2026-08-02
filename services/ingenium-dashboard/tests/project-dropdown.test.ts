import { describe, expect, it } from "vitest";
import { isProjectSwitchingDisabled } from "../src/app/components/ProjectDropdown";

describe("ProjectDropdown route guards", () => {
  it("disables project switching for the global-owned backups page", () => {
    expect(isProjectSwitchingDisabled("/backups")).toBe(true);
    expect(isProjectSwitchingDisabled("/backups/history")).toBe(true);
  });

  it("keeps project switching enabled for Chat while retaining global-only routes", () => {
    expect(isProjectSwitchingDisabled("/mail")).toBe(true);
    expect(isProjectSwitchingDisabled("/opencode")).toBe(true);
    expect(isProjectSwitchingDisabled("/vscode")).toBe(true);
    expect(isProjectSwitchingDisabled("/chat")).toBe(false);
  });

  it("does not disable switching for ordinary project-scoped pages", () => {
    expect(isProjectSwitchingDisabled("/tasks")).toBe(false);
  });
});
