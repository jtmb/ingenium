/** Create a new task with optional description and assignee. */
export declare function taskCreate(project: string, title: string, description?: string, assignedTo?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** List tasks, optionally filtered by column. */
export declare function taskList(project: string, columnId?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Move a task to a different column. */
export declare function taskMove(project: string, taskId: string, columnId: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Mark a task as completed (move to "done" column). */
export declare function taskComplete(project: string, taskId: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Get the highest-priority next task to work on. */
export declare function taskNext(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Update task fields (title, description, assigned_to, priority, etc.). */
export declare function taskUpdate(project: string, taskId: string, fields: Record<string, unknown>): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Delete a task by ID. */
export declare function taskDelete(project: string, taskId: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Full-text search across tasks. */
export declare function taskSearch(project: string, query: string, limit?: number): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Add a comment to a task. */
export declare function taskComment(project: string, taskId: string, author: string, body: string, parentCommentId?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Get activity feed for a task. */
export declare function taskActivity(project: string, taskId: string, limit?: number): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Link two tasks together (blocks, relates_to, duplicates). */
export declare function taskLink(project: string, taskId: string, linkedTaskId: string, linkType: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Get board configuration (columns and custom field definitions). */
export declare function taskBoardConfigGet(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Set board configuration (columns and/or custom field definitions). */
export declare function taskBoardConfigSet(project: string, columns?: unknown[], customFieldDefs?: unknown[]): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Create a subtask under an existing task. */
export declare function taskSubtaskCreate(project: string, parentId: string, title: string, description?: string, assignedTo?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** List task notifications for a recipient, optionally filtered by unread status. */
export declare function taskNotifications(project: string, recipient: string, unread?: boolean): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=tasks.d.ts.map