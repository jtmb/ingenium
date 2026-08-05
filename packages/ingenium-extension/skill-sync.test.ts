import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSkillsOnlySync = vi.hoisted(() => vi.fn());

vi.mock("./resource-sync.js", () => ({
  skillsOnlySync: mockSkillsOnlySync,
}));

import { SkillSyncPlugin } from "./skill-sync.js";

describe("skill sync lifecycle wrapper", () => {
  beforeEach(() => {
    mockSkillsOnlySync.mockReset();
    mockSkillsOnlySync.mockResolvedValue({ synced: 2, skipped: 3 });
  });

  it.each([
    ["session.created", "Synced 2 skill(s) from API to .opencode/skills/ (3 already present)"],
    ["session.idle", "Synced 2 skill(s) from API (3 already present)"],
  ])("keeps the %s log suffix", async (eventType, message) => {
    const log = vi.fn();
    const plugin = await SkillSyncPlugin({ worktree: "/worktree", client: { app: { log } } });

    await plugin.event({ event: { type: eventType } });

    expect(mockSkillsOnlySync).toHaveBeenCalledWith("/worktree");
    expect(log).toHaveBeenCalledWith({
      body: { service: "skill-sync", level: "info", message },
    });
  });

  it("ignores unrelated lifecycle events", async () => {
    const log = vi.fn();
    const plugin = await SkillSyncPlugin({ worktree: "/worktree", client: { app: { log } } });

    await plugin.event({ event: { type: "message.updated" } });

    expect(mockSkillsOnlySync).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
