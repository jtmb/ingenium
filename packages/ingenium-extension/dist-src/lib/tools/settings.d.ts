export declare function settingGet(project: string, key: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare function settingSet(project: string, key: string, value: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=settings.d.ts.map