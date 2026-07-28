import { describe, expect, it } from "vitest";
import { isProjectSwitchingDisabled } from "../src/app/components/ProjectDropdown";

describe("ProjectDropdown route guards", () => {
  it("disables project switching for the global-owned backups page", () => {
    expect(isProjectSwitchingDisabled("/backups")).toBe(true);
    expect(isProjectSwitchingDisabled("/backups/history")).toBe(true);
  });

  it("does not disable switching for ordinary project-scoped pages", () => {
    expect(isProjectSwitchingDisabled("/tasks")).toBe(false);
  });
});
