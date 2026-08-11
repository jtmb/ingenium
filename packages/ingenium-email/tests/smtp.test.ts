import { afterEach, describe, expect, it, vi } from "vitest";

const nodemailerMocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: nodemailerMocks,
}));
vi.mock("../lib/imap.js", () => ({
  connectAccount: vi.fn(),
}));

import { connectAccount } from "../lib/imap.js";
import { createTransport, saveDraft } from "../lib/smtp.js";

const account = {
  id: "draft-account",
  email: "author@example.test",
  name: "Author",
  provider: "custom" as const,
  authType: "app_password" as const,
  connected: true,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("saveDraft", () => {
  it("uses Gmail's canonical SMTP endpoint when a fixed-provider account carries an override", async () => {
    nodemailerMocks.createTransport.mockReturnValue({ sendMail: vi.fn() });

    await createTransport({
      ...account,
      provider: "gmail",
      smtpHost: "smtp.attacker.example",
      smtpPort: 2525,
    }, { password: "app-password" });

    expect(nodemailerMocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
    }));
  });

  it("uses Nodemailer's local stream transport and appends one RFC822 draft without SMTP delivery", async () => {
    const sendMail = vi.fn().mockResolvedValue({
      messageId: "<draft-message@example.test>",
      message: Buffer.from("From: Author <author@example.test>\r\nTo: Reply <reply@example.test>\r\n\r\nDraft body"),
    });
    const append = vi.fn().mockResolvedValue(undefined);
    nodemailerMocks.createTransport.mockReturnValue({ sendMail });
    vi.mocked(connectAccount).mockResolvedValue({ append } as never);

    await expect(saveDraft(account, { password: "app-password" }, {
      to: [{ name: "Reply", address: "reply@example.test" }],
      subject: "Draft subject",
      text: "Draft body",
    })).resolves.toBe("<draft-message@example.test>");

    expect(nodemailerMocks.createTransport).toHaveBeenCalledOnce();
    expect(nodemailerMocks.createTransport).toHaveBeenCalledWith({
      streamTransport: true,
      buffer: true,
      newline: "windows",
    });
    expect(nodemailerMocks.createTransport.mock.calls.some(([options]) => (
      typeof options === "object" && options !== null && "host" in options
    ))).toBe(false);
    expect(sendMail).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledWith("Drafts", expect.any(Buffer), ["\\Draft"]);
    expect(append.mock.calls[0]?.[1].toString()).toContain("reply@example.test");
  });

  it("fails when the Drafts append fails instead of reporting an unsaved draft", async () => {
    const sendMail = vi.fn().mockResolvedValue({
      messageId: "<draft-message@example.test>",
      message: Buffer.from("To: reply@example.test\r\n\r\nDraft body"),
    });
    nodemailerMocks.createTransport.mockReturnValue({ sendMail });
    vi.mocked(connectAccount).mockResolvedValue({
      append: vi.fn().mockRejectedValue(new Error("imap append failed")),
    } as never);

    await expect(saveDraft(account, { password: "app-password" }, {
      to: [{ address: "reply@example.test" }],
      subject: "Draft subject",
      text: "Draft body",
    })).rejects.toMatchObject({ operation: "imap" });
  });

  it("rejects an invalid recipient before composing or appending a draft", async () => {
    await expect(saveDraft(account, { password: "app-password" }, {
      to: [{ address: "not-an-address" }],
      subject: "Draft subject",
      text: "Draft body",
    })).rejects.toMatchObject({ code: "PROVIDER_REJECTED", operation: "imap" });

    expect(nodemailerMocks.createTransport).not.toHaveBeenCalled();
    expect(connectAccount).not.toHaveBeenCalled();
  });
});
