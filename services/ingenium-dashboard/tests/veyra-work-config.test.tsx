import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeClient } from "../src/lib/opencode";
import { useWorkChatConfig } from "../src/app/components/veyra-work/useWorkChatConfig";

afterEach(cleanup);
describe("Work installation default refresh", () => {
  it("ignores a late old catalog after the settings refresh and detaches its listener on unmount", async () => {
    const original = { defaultSelection: { providerId: "old", modelId: "old" }, providers: [] };
    const updated = { defaultSelection: { providerId: "new", modelId: "new" }, providers: [] };
    let resolveOld!: (value: typeof original) => void;
    const load = vi.fn().mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValue(updated);
    const client = { chat: { config: load } } as unknown as OpenCodeClient;
    const { result, unmount } = renderHook(() => useWorkChatConfig(client));
    act(() => window.dispatchEvent(new Event("veyra-chat-defaults-changed")));
    await waitFor(() => expect(result.current.config?.defaultSelection?.modelId).toBe("new"));
    await act(async () => { resolveOld(original); });
    expect(result.current.config?.defaultSelection?.modelId).toBe("new");
    unmount();
    window.dispatchEvent(new Event("veyra-chat-defaults-changed"));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("retains the previous catalog for display but reports a failed refresh as unavailable", async () => {
    const load = vi.fn().mockResolvedValueOnce({ defaultSelection: { providerId: "provider", modelId: "model" }, providers: [] }).mockRejectedValueOnce(new Error("Read unavailable"));
    const client = { chat: { config: load } } as unknown as OpenCodeClient;
    const { result } = renderHook(() => useWorkChatConfig(client));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toBe("Read unavailable");
    expect(result.current.config?.defaultSelection?.modelId).toBe("model");
  });
});
