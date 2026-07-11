/** Trigger the synthesis pipeline */
export declare function synthesisRun(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Get synthesis pipeline status */
export declare function synthesisStatus(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Trigger cross-project synthesis */
export declare function synthesisCrossProject(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=synthesis.d.ts.map