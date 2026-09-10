import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const frameSource = readFileSync(
  resolve(__dirname, "../src/app/components/OpenCodeFrame.tsx"),
  "utf8",
);

describe("Phase 2C — inactive OpenCode frame error isolation contract", () => {
  it("guards frame errors by the current mode instead of sharing one global error", () => {
    expect(frameSource).toContain("const modeRef = useRef(mode);");
    expect(frameSource).toContain("if (frameMode !== modeRef.current) return;");
    expect(frameSource).toContain(
      "setFrameError({ mode: frameMode, message: \"OpenCode could not be reached\" });",
    );
    expect(frameSource).toContain(
      "const activeFrameError = frameError?.mode === mode ? frameError.message : null;",
    );
  });
});
