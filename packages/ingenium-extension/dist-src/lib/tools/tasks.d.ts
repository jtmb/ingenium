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
/** Mark a task as completed. */
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
//# sourceMappingURL=tasks.d.ts.map