import { describe, expect, it } from "vitest";
import { classifyObserverFailure, classifyObserverHttpFailure } from "../observer-core.js";

describe("observer API diagnostics", () => {
  it.each([
    [401, "authentication"],
    [403, "authentication"],
    [404, "not_found"],
    [423, "locked"],
    [500, "request_failed"],
  ] as const)("maps HTTP %i to the stable %s category", (status, expected) => {
    expect(classifyObserverHttpFailure(status)).toBe(expected);
  });

  it("classifies timeout-shaped transport failures without preserving error text", () => {
    const error = new Error("Bearer secret-token timed out") as Error & { name: string };
    error.name = "TimeoutError";

    expect(classifyObserverFailure(error)).toBe("timeout");
  });
});
