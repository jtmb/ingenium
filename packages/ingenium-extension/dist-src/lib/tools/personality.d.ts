/** Get personality profile (aggregated) */
export declare function personalityProfile(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** List traits with optional type filter */
export declare function personalityTraits(project: string, traitType?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Upsert a trait (used by synthesis pipeline) */
export declare function personalitySetTrait(project: string, traitType: string, traitValue: string, label?: string, confidence?: number): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=personality.d.ts.map