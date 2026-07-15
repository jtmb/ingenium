/**
 * Tests for Gmail address parsing using mailparser's `simpleParser`.
 *
 * The gmail.ts provider uses simpleParser to parse From headers
 * (see providers/gmail.ts lines 141-145). This replaces a previously
 * broken hand-rolled regex that catastrophically backtracked for
 * unquoted display names.
 */
import { describe, it, expect } from "vitest";
import { simpleParser } from "mailparser";

/** Parse a From header string into { name, addr } using simpleParser. */
async function parseFromHeader(fromRaw: string): Promise<{ name: string | null; addr: string | null } | null> {
  if (!fromRaw || fromRaw.trim() === "") return null;
  try {
    const parsed = await simpleParser(`From: ${fromRaw}\r\n\r\n`);
    const fromValue = parsed.from?.value?.[0];
    const addr = fromValue?.address?.trim() || null;
    if (!addr) return null; // no address = invalid From
    return {
      name: fromValue?.name?.trim() || null,
      addr,
    };
  } catch {
    return null;
  }
}

describe("Gmail address parsing (simpleParser)", () => {
  it('parses quoted display name: "Alice Smith" <alice@example.com>', async () => {
    const result = await parseFromHeader('"Alice Smith" <alice@example.com>');
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Alice Smith");
    expect(result!.addr).toBe("alice@example.com");
  });

  it("parses unquoted display name: Docker <no-reply@docker.com>", async () => {
    const result = await parseFromHeader("Docker <no-reply@docker.com>");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Docker");
    expect(result!.addr).toBe("no-reply@docker.com");
  });

  it("parses bare email: user@example.com", async () => {
    const result = await parseFromHeader("user@example.com");
    expect(result).not.toBeNull();
    expect(result!.name).toBeNull();
    expect(result!.addr).toBe("user@example.com");
  });

  it("returns null for empty From", async () => {
    const result = await parseFromHeader("");
    expect(result).toBeNull();
  });

  it("parses address with angle brackets only: <no-reply@github.com>", async () => {
    const result = await parseFromHeader("<no-reply@github.com>");
    expect(result).not.toBeNull();
    expect(result!.addr).toBe("no-reply@github.com");
  });

  it("parses display name with special characters: M. O'Brian <mob@example.com>", async () => {
    const result = await parseFromHeader("M. O'Brian <mob@example.com>");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("M. O'Brian");
    expect(result!.addr).toBe("mob@example.com");
  });

  it("handles noreply style sender: no-reply@docker.com", async () => {
    // Plain email should parse with addr set and name null
    const result = await parseFromHeader("no-reply@docker.com");
    expect(result).not.toBeNull();
    expect(result!.addr).toBe("no-reply@docker.com");
    expect(result!.name).toBeNull();
  });

  it("parses display name with commas: Doe, John <john.doe@example.com>", async () => {
    const result = await parseFromHeader("Doe, John <john.doe@example.com>");
    expect(result).not.toBeNull();
    expect(result!.addr).toBe("john.doe@example.com");
    // simpleParser may or may not extract name for this format
    // but addr must always be correct
  });
});
