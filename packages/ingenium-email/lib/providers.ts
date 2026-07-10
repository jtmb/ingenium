import type { EmailProvider } from "./types.js";

/** Provider configuration: default IMAP/SMTP host, port, and TLS settings. */
export interface ProviderConfig {
  imap: { host: string; port: number; tls: boolean };
  smtp: { host: string; port: number; tls: boolean };
}

/** Known email provider defaults. "custom" has empty hosts for user override. */
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
    imap: { host: "", port: 993, tls: true },
    smtp: { host: "", port: 587, tls: true },
  },
};
