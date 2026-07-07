/** List all projects known to the Ingenium API. */
export declare function projectList(): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Initialise a new project on the Ingenium API. */
export declare function projectInit(name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Delete a project by name. */
export declare function projectDelete(name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=projects.d.ts.map