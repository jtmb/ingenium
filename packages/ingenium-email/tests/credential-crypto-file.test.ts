import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getEmailEncryptionKey } from "../lib/credential-crypto.js";

const KEY = "d".repeat(64);
const directories: string[] = [];

function protectedKeyFile(): string {
  const directory = mkdtempSync(join(tmpdir(), "ingenium-email-key-file-"));
  directories.push(directory);
  chmodSync(directory, 0o700);
  const file = join(directory, "email.key");
  writeFileSync(file, `${KEY}\n`, { mode: 0o600 });
  return file;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("email encryption key protected file", () => {
  it("loads an owner-only regular file", () => {
    vi.stubEnv("INGENIUM_EMAIL_ENCRYPTION_KEY", "");
    vi.stubEnv("INGENIUM_EMAIL_ENCRYPTION_KEY_FILE", protectedKeyFile());
    expect(getEmailEncryptionKey()).toHaveLength(32);
  });

  it("rejects source conflicts, broad modes, unsafe parents, and symlinks", () => {
    const file = protectedKeyFile();
    vi.stubEnv("INGENIUM_EMAIL_ENCRYPTION_KEY_FILE", file);
    vi.stubEnv("INGENIUM_EMAIL_ENCRYPTION_KEY", KEY);
    expect(() => getEmailEncryptionKey()).toThrow("Conflicting");
    vi.stubEnv("INGENIUM_EMAIL_ENCRYPTION_KEY", "");
    chmodSync(file, 0o640);
    expect(() => getEmailEncryptionKey()).toThrow("unsafe");
    chmodSync(file, 0o600);
    chmodSync(dirname(file), 0o750);
    expect(() => getEmailEncryptionKey()).toThrow("parent is unsafe");
    chmodSync(dirname(file), 0o700);
    const link = `${file}.link`;
    symlinkSync(file, link);
    vi.stubEnv("INGENIUM_EMAIL_ENCRYPTION_KEY_FILE", link);
    expect(() => getEmailEncryptionKey()).toThrow();
  });
});
