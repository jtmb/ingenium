import type { EmailAccount, EmailProvider } from "./types.js";

/**
 * Provider configuration: default IMAP/SMTP host, port, and TLS settings.
 *
 * Only custom accounts can override these endpoints. Fixed-provider accounts
 * always resolve through this canonical configuration.
 */
export interface ProviderConfig {
  imap: { host: string; port: number; tls: boolean };
  smtp: { host: string; port: number; tls: boolean };
}

/**
 * Known email provider defaults.
 *
 * NOTE: SMTP port 587 with STARTTLS is used (not 465 with implicit TLS) because
 * it's more widely supported across providers.  Port 993 for IMAP uses implicit TLS.
 *
 * "custom" defaults to example.com — users must override with their actual server.
 */
export const PROVIDERS: Record<EmailProvider, ProviderConfig> = {
  gmail: {
    imap: { host: "imap.gmail.com", port: 993, tls: true },
    smtp: { host: "smtp.gmail.com", port: 587, tls: true },
  },
  outlook: {
    imap: { host: "outlook.office365.com", port: 993, tls: true },
    smtp: { host: "smtp.office365.com", port: 587, tls: true },
  },
  yahoo: {
    imap: { host: "imap.mail.yahoo.com", port: 993, tls: true },
    smtp: { host: "smtp.mail.yahoo.com", port: 587, tls: true },
  },
  custom: {
    imap: { host: "imap.example.com", port: 993, tls: true },
    smtp: { host: "smtp.example.com", port: 587, tls: true },
  },
};

export function isEmailProvider(value: unknown): value is EmailProvider {
  return typeof value === "string"
    && Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}

export function isFixedProvider(provider: EmailProvider): boolean {
  return provider !== "custom";
}

/** Resolve endpoints at transport time so fixed-provider overrides cannot redirect credentials. */
export function resolveProviderEndpoints(
  account: Pick<EmailAccount, "provider" | "imapHost" | "imapPort" | "smtpHost" | "smtpPort">,
): ProviderConfig {
  const config = PROVIDERS[account.provider];
  if (isFixedProvider(account.provider)) return config;

  return {
    imap: {
      ...config.imap,
      host: account.imapHost || config.imap.host,
      port: account.imapPort || config.imap.port,
    },
    smtp: {
      ...config.smtp,
      host: account.smtpHost || config.smtp.host,
      port: account.smtpPort || config.smtp.port,
    },
  };
}
