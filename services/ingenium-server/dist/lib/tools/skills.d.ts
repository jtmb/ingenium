/** List all skills for a project. */
export declare function skillList(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Load a single skill by name. */
export declare function skillLoad(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Full-text search across skills. */
export declare function skillSearch(project: string, query: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Create a new skill. */
export declare function skillCreate(project: string, name: string, description: string, content: string, category?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Update an existing skill's content. */
export declare function skillUpdate(project: string, name: string, content: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=skills.d.ts.map