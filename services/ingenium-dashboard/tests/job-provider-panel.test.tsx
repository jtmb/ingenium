import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import type { Job, JobProviderState } from "../src/lib/api";
const mocks = vi.hoisted(() => ({ provider: vi.fn(), configure: vi.fn(), get: vi.fn(),
  complete: null as (() => void) | null, settingsWrite: vi.fn() }));
vi.mock("../src/lib/api", () => ({ api: { jobs: {
  provider: mocks.provider, configureProvider: mocks.configure, get: mocks.get,
}, settings: { set: mocks.settingsWrite } } }));
vi.mock("../src/app/components/auth/StepUpDialog", () => ({
  default: ({ open, onComplete, onClose }: { open: boolean; onComplete: () => void; onClose: () => void }) => {
    if (!open) return null;
    mocks.complete = onComplete;
    return <div role="dialog"><button onClick={onComplete}>Confirm provider authorization</button><button onClick={onClose}>Cancel</button></div>;
  },
}));
import JobProviderPanel from "../src/app/jobs/JobProviderPanel";
const job = { id: "owned-job", revision: 7, agent: "ingenium-chat" } as Job;
const available: JobProviderState = { connection: null, models: [{ id: "beam-free", label: "Beam Free" }],
  defaultModel: "beam-free", catalogAvailable: true, agentAvailable: true };
beforeEach(() => {
  mocks.provider.mockReset().mockResolvedValue({ data: available });
  mocks.configure.mockReset().mockResolvedValue({ data: { job: { ...job, revision: 8 },
    connection: { kind: "anonymous", providerId: "opencode", modelId: "beam-free", authorized: true } } });
  mocks.get.mockReset().mockResolvedValue({ data: job });
  mocks.complete = null; mocks.settingsWrite.mockReset();
});
afterEach(cleanup);

describe("Job provider configuration", () => {
  it("shows loading explicitly and waits for actual catalog data", async () => {
    let resolve!: (value: unknown) => void;
    mocks.provider.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<JobProviderPanel job={job} project="team / project" onUpdated={vi.fn()} busy={false} />);
    expect(screen.getByRole("status").textContent).toContain("Loading");
    expect(screen.queryByRole("button", { name: "Authorize Free Zen for this job" })).toBeNull();
    resolve({ data: available });
    expect(await screen.findByRole("option", { name: "Beam Free" })).toBeTruthy();
    expect(mocks.provider).toHaveBeenCalledWith("owned-job", "team / project", expect.any(AbortSignal));
  });
  it("requires confirmation and configures only this job with its expected revision", async () => {
    const updated = vi.fn();
    render(<JobProviderPanel job={job} project="team / project" onUpdated={updated} busy={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Authorize Free Zen for this job" }));
    expect(mocks.configure).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm provider authorization" }));
    await waitFor(() => expect(mocks.configure).toHaveBeenCalledWith("owned-job", "beam-free", 7, "team / project"));
    await waitFor(() => expect(updated).toHaveBeenCalledWith(expect.objectContaining({ revision: 8 })));
    expect(mocks.settingsWrite).not.toHaveBeenCalled();
  });
  it("can revoke an existing grant when the catalog is unavailable", async () => {
    mocks.provider.mockResolvedValue({ data: { ...available, catalogAvailable: false, models: [], defaultModel: null,
      connection: { kind: "anonymous", providerId: "opencode", modelId: "beam-free", authorized: true } } });
    render(<JobProviderPanel job={job} project="p" onUpdated={vi.fn()} busy={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke provider access" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm provider authorization" }));
    await waitFor(() => expect(mocks.configure).toHaveBeenCalledWith(job.id, null, 7, "p"));
  });
  it("shows setup errors and reloads the whole job explicitly", async () => {
    mocks.provider.mockRejectedValueOnce(new Error("Catalog request failed"));
    render(<JobProviderPanel job={job} project="p" onUpdated={vi.fn()} busy={false} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Catalog request failed");
    fireEvent.click(screen.getByRole("button", { name: "Reload job and provider" }));
    await screen.findByRole("option", { name: "Beam Free" });
    expect(mocks.get).toHaveBeenCalledWith(job.id, "p");
  });
  it("does not apply a late catalog response from a different project", async () => {
    let resolve!: (value: unknown) => void;
    mocks.provider.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const { rerender } = render(<JobProviderPanel job={job} project="old" onUpdated={vi.fn()} busy={false} />);
    rerender(<JobProviderPanel job={{ ...job, id: "new-job" }} project="new" onUpdated={vi.fn()} busy={false} />);
    await screen.findByRole("option", { name: "Beam Free" });
    resolve({ data: { ...available, models: [{ id: "old-model", label: "Old project model" }] } });
    await waitFor(() => expect(screen.queryByText("Old project model")).toBeNull());
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("beam-free");
  });
  it("does not submit an old confirmation after the job or project changes", async () => {
    const { rerender } = render(<JobProviderPanel job={job} project="old" onUpdated={vi.fn()} busy={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Authorize Free Zen for this job" }));
    const oldComplete = mocks.complete!;
    rerender(<JobProviderPanel job={{ ...job, id: "new-job" }} project="new" onUpdated={vi.fn()} busy={false} />);
    await screen.findByRole("option", { name: "Beam Free" });
    oldComplete();
    expect(mocks.configure).not.toHaveBeenCalled();
  });
  it("does not replace managed access and disables changes during an active run", async () => {
    mocks.provider.mockResolvedValueOnce({ data: { ...available,
      connection: { kind: "managed", providerId: "existing", authorized: true } } });
    const { rerender } = render(<JobProviderPanel job={job} project="p" onUpdated={vi.fn()} busy={false} />);
    expect(await screen.findByText("This job uses an existing managed provider connection.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Authorize Free Zen for this job" })).toBeNull();
    rerender(<JobProviderPanel job={{ ...job, revision: 8 }} project="p" onUpdated={vi.fn()} busy />);
    expect(await screen.findByRole("button", { name: "Authorize Free Zen for this job" })).toBeDisabled();
  });
  it("shows a revision conflict without reporting success or changing defaults", async () => {
    const updated = vi.fn(); mocks.configure.mockRejectedValueOnce(new Error("Job has changed. Reload before saving."));
    render(<JobProviderPanel job={job} project="p" onUpdated={updated} busy={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Authorize Free Zen for this job" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm provider authorization" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Reload");
    expect(updated).not.toHaveBeenCalled(); expect(mocks.settingsWrite).not.toHaveBeenCalled();
  });
});
