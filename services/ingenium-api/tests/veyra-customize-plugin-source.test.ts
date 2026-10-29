import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";

const { getPlugin, readSource } = vi.hoisted(() => ({
  getPlugin: vi.fn(), readSource: vi.fn(),
}));
vi.mock("ingenium-core", () => ({
  plugins: { getPlugin },
  getPluginsBase: () => "/virtual/customize/project-1/plugins",
  logger: { error: vi.fn() },
}));
vi.mock("../lib/helpers.js", () => ({ requireProject: () => "project-1" }));
vi.mock("node:fs", async (load) => ({
  ...await load<typeof import("node:fs")>(),
  readFileSync: readSource,
}));

import { pluginsRouter } from "../lib/routes/plugins.js";

beforeEach(() => {
  getPlugin.mockReset();
  readSource.mockReset();
});

function invoke() {
  const handler = pluginsRouter.stack.find((layer) => layer.route?.path === "/:name/source")!.route!.stack[0]!.handle;
  let status = 200;
  let payload: unknown;
  const response = {
    status(value: number) { status = value; return response; },
    json(value: unknown) { payload = value; return response; },
  };
  handler({ params: { name: "same-name" }, query: { project: "explicit-installation" } }, response, () => undefined);
  return { status, payload };
}

describe("Customize inherited plugin source contract", () => {
  it("returns registered namespace source rather than a same-named process-directory file", () => {
    getPlugin.mockReturnValue({ id: "owned", project_id: "project-1", enabled: true, name: "same-name", file_path: "same.ts", source_content: "registered owner source" });
    readSource.mockImplementation((path: string) => {
      if (path === resolve(process.cwd(), "same.ts")) return "unrelated process-directory source";
      throw new Error("Unexpected source path.");
    });
    const result = invoke();
    expect(result.status).toBe(200);
    expect(getPlugin).toHaveBeenCalledWith("project-1", "same-name");
    expect(result.payload).toEqual({ data: { source: "registered owner source" } });
  });

  it("distinguishes confirmed empty source from unavailable source", () => {
    getPlugin.mockReturnValue({ id: "empty", project_id: "project-1", enabled: true, name: "same-name", file_path: "empty.ts", source_content: "" });
    readSource.mockImplementation(() => { throw new Error("No projection is needed for the registered empty source."); });
    expect(invoke()).toEqual({ status: 200, payload: { data: { source: "" } } });
  });

  it("does not report a missing source as a successful empty editor buffer", () => {
    getPlugin.mockReturnValue({ id: "missing", project_id: "project-1", enabled: true, name: "same-name", file_path: "missing.ts" });
    readSource.mockImplementation(() => { throw Object.assign(new Error("Fixture source is unavailable"), { code: "ENOENT" }); });
    expect(invoke().status).not.toBe(200);
  });
});
