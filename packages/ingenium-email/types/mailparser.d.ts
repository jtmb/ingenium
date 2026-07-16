/**
 * Minimal type declarations for mailparser (no @types/mailparser available).
 *
 * Only covers the subset of mailparser's API used by this package.
 * If additional mailparser features are needed, extend these declarations
 * rather than casting to `any`.
 *
 * 🔴 Per AGENTS.md HARD RULE #12: Never hand-write RFC 2822 address-parsing
 *    regexes — always use mailparser's simpleParser instead.
 */

declare module "mailparser" {
  export interface EmailAddress {
    name?: string;
    address?: string;
  }

  export interface AddressObject {
    value: EmailAddress[];
    html: string;
    text: string;
  }

  export interface Attachment {
    partID: string;
    filename?: string;
    size: number;
    contentType: string;
  }

  export interface ParsedMail {
    messageId?: string;
    subject?: string;
    from?: AddressObject;
    to?: AddressObject;
    cc?: AddressObject;
    date?: Date;
    /** Plain text body (if available). */
    text?: string;
    /** HTML body. Can be `false` when no HTML part exists. */
    html?: string | false;
    attachments: Attachment[];
    threadId?: string;
    inReplyTo?: string;
    /** Can be a single string or an array of strings depending on mailparser version. */
    references?: string | string[];
  }

  /** Parse a raw RFC822 email string or Buffer into a structured ParsedMail object. */
  export function simpleParser(source: string | Buffer): Promise<ParsedMail>;
}
