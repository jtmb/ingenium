/**
 * Known email provider defaults.
 *
 * NOTE: SMTP port 587 with STARTTLS is used (not 465 with implicit TLS) because
 * it's more widely supported across providers.  Port 993 for IMAP uses implicit TLS.
 *
 * "custom" defaults to example.com — users must override with their actual server.
 */
export const PROVIDERS = {
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
