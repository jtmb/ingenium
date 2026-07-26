import type { EmailProvider } from "./types.js";
/**
 * Provider configuration: default IMAP/SMTP host, port, and TLS settings.
 *
 * Accounts can override these defaults via their own imapHost/imapPort/smtpHost/smtpPort
 * fields.  The defaults are used when the account doesn't specify custom values.
 */
export interface ProviderConfig {
    imap: {
        host: string;
        port: number;
        tls: boolean;
    };
    smtp: {
        host: string;
        port: number;
        tls: boolean;
    };
}
/**
 * Known email provider defaults.
 *
 * NOTE: SMTP port 587 with STARTTLS is used (not 465 with implicit TLS) because
 * it's more widely supported across providers.  Port 993 for IMAP uses implicit TLS.
 *
 * "custom" defaults to example.com — users must override with their actual server.
 */
export declare const PROVIDERS: Record<EmailProvider, ProviderConfig>;
//# sourceMappingURL=providers.d.ts.map