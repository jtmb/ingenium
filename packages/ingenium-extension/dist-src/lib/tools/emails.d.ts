/** List emails in a folder with pagination */
export declare function emailList(project: string, account: string, folder?: string, page?: number): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Search emails by keyword, sender, subject, or date range */
export declare function emailSearch(project: string, account: string, query: string, folder?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Read a full email by its UID */
export declare function emailRead(project: string, account: string, uid: number, folder?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Compose and send an email */
export declare function emailSend(project: string, account: string, to: string, subject: string, html?: string, text?: string, cc?: string, bcc?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Save a draft email without sending */
export declare function emailDraft(project: string, account: string, to: string, subject: string, html?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** List all email folders for an account */
export declare function emailFolders(project: string, account: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** List connected email accounts */
export declare function emailAccounts(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Triage emails — categorize by priority and suggest actions */
export declare function emailTriage(project: string, account: string, limit?: number): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Suggest an email response based on learned user patterns */
export declare function emailSuggestResponse(project: string, account: string, uid: number, folder?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Auto-draft a response to an email based on learned patterns */
export declare function emailDraftResponse(project: string, account: string, uid: number, folder?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** List all learned email response patterns (skills with category 'email') */
export declare function emailPatterns(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Start IMAP IDLE watcher for real-time email monitoring */
export declare function emailWatchStart(project: string, account: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Check if the IMAP IDLE watcher is running for an account */
export declare function emailWatchStatus(project: string, account: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=emails.d.ts.map