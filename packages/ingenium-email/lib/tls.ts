/** Optional operator-owned CA bundle for private IMAP/SMTP servers. */
import { readFileSync } from "node:fs";
import { createSecureContext, rootCertificates, type ConnectionOptions } from "node:tls";

export function mailTlsOptions(): ConnectionOptions | undefined {
  const path = process.env.INGENIUM_EMAIL_CA_FILE?.trim();
  if (!path) return undefined;
  const pem = readFileSync(path, "utf8");
  if (pem.length > 1_048_576 || !pem.includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error("Invalid mail CA bundle");
  }
  // Validate before connecting; malformed/missing bundles fail closed. Keep the
  // public roots and normal hostname/certificate verification for both clients.
  createSecureContext({ ca: pem });
  return { ca: [...rootCertificates, pem], rejectUnauthorized: true };
}
