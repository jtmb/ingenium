import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTest } from "../lib/db.js";
import * as cloudflareTunnel from "../lib/tools/cloudflare-tunnel.js";
import { createProject } from "../lib/tools/projects.js";
import * as settings from "../lib/tools/settings.js";
import * as vault from "../lib/tools/vault.js";

const PASSPHRASE = "cloudflare-test-passphrase";
const TOKEN = "eyJhIjoiY2xvdWRmbGFyZS10dW5uZWwtdGVzdC10b2tlbiJ9.test";
const inventory: cloudflareTunnel.CloudflareTrustedIngressInventory = {
  tunnelName: "ingenium-production",
  routes: {
    dashboard: [{ publicUrl: "https://dashboard.example.com/", target: cloudflareTunnel.CLOUDFLARE_SERVICE_TARGETS.dashboard }],
    opencode: [{ publicUrl: "https://opencode.example.com/", target: cloudflareTunnel.CLOUDFLARE_SERVICE_TARGETS.opencode }],
    cli: [{ publicUrl: "https://cli.example.com/", target: cloudflareTunnel.CLOUDFLARE_SERVICE_TARGETS.cli }],
    vscode: [{ publicUrl: "https://vscode.example.com/", target: cloudflareTunnel.CLOUDFLARE_SERVICE_TARGETS.vscode }],
    api: [{ publicUrl: "https://api.example.com/", target: cloudflareTunnel.CLOUDFLARE_SERVICE_TARGETS.api }],
  },
};
let tempDir = "";
let projectId = "";

function config(overrides: Partial<cloudflareTunnel.CloudflareTunnelConfig> = {}): cloudflareTunnel.CloudflareTunnelConfig {
  const base = cloudflareTunnel.defaultCloudflareTunnelConfig();
  return {
    ...base,
    enabled: true,
    tunnelName: "ingenium-production",
    services: {
      ...base.services,
      dashboard: { enabled: true, publicUrl: "https://dashboard.example.com/" },
    },
    ...overrides,
  };
}

beforeEach(() => {
  resetDbForTest();
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-cloudflare-tunnel-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");
  projectId = createProject("global-default", true).id;
  vault.sealVault();
});

afterEach(() => {
  vault.sealVault();
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Cloudflare tunnel core boundary", () => {
  it("defaults disabled and persists only exact public service mappings", () => {
    expect(cloudflareTunnel.getCloudflareTunnelConfig()).toEqual({
      status: "ok",
      config: cloudflareTunnel.defaultCloudflareTunnelConfig(),
    });

    const saved = cloudflareTunnel.saveCloudflareTunnelConfig(config(), inventory);

    expect(saved.services.dashboard.publicUrl).toBe("https://dashboard.example.com/");
    expect(cloudflareTunnel.getCloudflareTunnelConfig(inventory)).toEqual({ status: "ok", config: saved });
  });

  it.each([
    ["local compatibility host", "http://opencode.localhost:3000/"],
    ["private IP", "https://127.0.0.1/"],
    ["path-bearing URL", "https://dashboard.example.com/opencode"],
    ["credential-bearing URL", "https://user:password@dashboard.example.com/"],
  ])("rejects an unsafe %s", (_label, publicUrl) => {
    const candidate = config();
    candidate.services.dashboard.publicUrl = publicUrl;

    expect(cloudflareTunnel.validateCloudflareTunnelConfig(candidate, inventory)).toMatchObject({ ok: false });
  });

  it("rejects arbitrary upstream and command fields", () => {
    const candidate = config() as unknown as Record<string, unknown>;
    candidate.command = "cloudflared tunnel run";

    expect(cloudflareTunnel.validateCloudflareTunnelConfig(candidate, inventory)).toEqual({
      ok: false,
      error: "config must contain only enabled, tunnelName, and services",
    });
  });

  it("accepts only origins assigned to the service in the trusted ingress inventory", () => {
    const arbitrary = config();
    arbitrary.services.dashboard.publicUrl = "https://other.example.com/";
    expect(cloudflareTunnel.validateCloudflareTunnelConfig(arbitrary, inventory)).toEqual({
      ok: false,
      error: "dashboard.publicUrl is not present in the trusted ingress inventory",
    });

    const wrongAudience = config();
    wrongAudience.services.dashboard.publicUrl = "https://api.example.com/";
    expect(cloudflareTunnel.validateCloudflareTunnelConfig(wrongAudience, inventory)).toEqual({
      ok: false,
      error: "dashboard.publicUrl is not present in the trusted ingress inventory",
    });
    expect(cloudflareTunnel.validateCloudflareTunnelConfig(config())).toEqual({
      ok: false,
      error: "dashboard.publicUrl is not present in the trusted ingress inventory",
    });
  });

  it("stores, updates, reads, and clears the token only through the encrypted vault", () => {
    expect(vault.initializeVault(projectId, PASSPHRASE, PASSPHRASE).ok).toBe(true);

    expect(cloudflareTunnel.updateCloudflareTunnelToken("replace", TOKEN)).toEqual({ status: "ok", configured: true });
    expect(cloudflareTunnel.getCloudflareTunnelToken()).toBe(TOKEN);
    expect(settings.getSetting(projectId, cloudflareTunnel.CLOUDFLARE_TUNNEL_TOKEN_SETTING_KEY)).toBeUndefined();
    expect(getDb().prepare("SELECT value FROM settings WHERE project_id = ? AND key = ?").get(
      projectId,
      cloudflareTunnel.CLOUDFLARE_TUNNEL_TOKEN_SETTING_KEY,
    )).toBeUndefined();

    const updated = `${TOKEN}-updated`;
    expect(cloudflareTunnel.updateCloudflareTunnelToken("replace", updated)).toEqual({ status: "ok", configured: true });
    expect(cloudflareTunnel.getCloudflareTunnelToken()).toBe(updated);
    expect(cloudflareTunnel.updateCloudflareTunnelToken("clear")).toEqual({ status: "ok", configured: false });
    expect(cloudflareTunnel.getCloudflareTunnelToken()).toBeUndefined();
  });

  it("fails closed while the vault is sealed and blocks generic plaintext settings writes", () => {
    vault.initVault(projectId, PASSPHRASE);

    expect(cloudflareTunnel.updateCloudflareTunnelToken("replace", TOKEN)).toEqual({ status: "vault_unavailable", configured: false });
    expect(() => settings.setSetting(projectId, cloudflareTunnel.CLOUDFLARE_TUNNEL_TOKEN_SETTING_KEY, TOKEN)).toThrow(
      "Cloudflare tunnel tokens must be stored in protected vault storage",
    );
  });

  it.each(["replace", "clear"] as const)("rolls back %s and audit writes when saving config fails", (action) => {
    vault.initializeVault(projectId, PASSPHRASE, PASSPHRASE);
    cloudflareTunnel.saveCloudflareTunnelConfig(config(), inventory, { action: "replace", value: TOKEN });
    const before = getDb().prepare("SELECT * FROM vault_items").all();
    const audits = getDb().prepare("SELECT * FROM vault_audit_log").all();
    getDb().exec(`CREATE TEMP TRIGGER reject_cloudflare_save BEFORE INSERT ON settings
      WHEN NEW.key = 'cloudflare_tunnel_config' BEGIN SELECT RAISE(ABORT, 'injected config failure'); END`);

    expect(() => cloudflareTunnel.saveCloudflareTunnelConfig(config({ enabled: false }), inventory,
      { action, ...(action === "replace" ? { value: `${TOKEN}-new` } : {}) })).toThrow("injected config failure");

    expect(getDb().prepare("SELECT * FROM vault_items").all()).toEqual(before);
    expect(getDb().prepare("SELECT * FROM vault_audit_log").all()).toEqual(audits);
    expect(cloudflareTunnel.getCloudflareTunnelConfig(inventory)).toEqual({ status: "ok", config: config() });
  });

  it("rolls back a newly created token when the first config save fails", () => {
    vault.initializeVault(projectId, PASSPHRASE, PASSPHRASE);
    const before = getDb().prepare("SELECT * FROM vault_audit_log").all();
    getDb().exec(`CREATE TEMP TRIGGER reject_cloudflare_save BEFORE INSERT ON settings
      WHEN NEW.key = 'cloudflare_tunnel_config' BEGIN SELECT RAISE(ABORT, 'injected config failure'); END`);

    expect(() => cloudflareTunnel.saveCloudflareTunnelConfig(config(), inventory,
      { action: "replace", value: TOKEN })).toThrow("injected config failure");
    expect(getDb().prepare("SELECT * FROM vault_items").all()).toEqual([]);
    expect(getDb().prepare("SELECT * FROM vault_audit_log").all()).toEqual(before);
    expect(cloudflareTunnel.getCloudflareTunnelConfig(inventory).config.enabled).toBe(false);
  });

  it.each(["replace", "clear"] as const)("rolls back the entire %s if duplicate cleanup fails", (action) => {
    vault.initializeVault(projectId, PASSPHRASE, PASSPHRASE);
    cloudflareTunnel.updateCloudflareTunnelToken("replace", TOKEN);
    vault.createItem(projectId, "Cloudflare Tunnel Token", "api_key", `${TOKEN}-duplicate`);
    const before = getDb().prepare("SELECT * FROM vault_items").all();
    getDb().exec(`CREATE TEMP TRIGGER reject_token_delete BEFORE UPDATE OF access_policy ON vault_items
      BEGIN SELECT RAISE(ABORT, 'injected vault failure'); END`);

    expect(() => cloudflareTunnel.updateCloudflareTunnelToken(action, `${TOKEN}-new`)).toThrow("injected vault failure");
    expect(getDb().prepare("SELECT * FROM vault_items").all()).toEqual(before);
  });

  it("keeps nested vault writes checkpoint-safe across the write threshold", () => {
    vault.initializeVault(projectId, PASSPHRASE, PASSPHRASE);
    for (let index = 0; index < 55; index++) {
      cloudflareTunnel.saveCloudflareTunnelConfig(config(), inventory, { action: "replace", value: `${TOKEN}-${index}` });
    }
    expect(cloudflareTunnel.getCloudflareTunnelToken()).toBe(`${TOKEN}-54`);
  });
});
