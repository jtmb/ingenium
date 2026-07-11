export declare function configGet(project: string, type: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare function configSet(project: string, type: string, content: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare function configSync(project: string, type: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=configs.d.ts.map