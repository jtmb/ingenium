/** Minimal type declarations for mailparser (no @types/mailparser available). */

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
    text?: string;
    html?: string | false;
    attachments: Attachment[];
    threadId?: string;
    inReplyTo?: string;
    references?: string | string[];
  }

  export function simpleParser(source: string | Buffer): Promise<ParsedMail>;
}
