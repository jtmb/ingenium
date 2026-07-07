/** Typed HTTP client for the Ingenium API. Returns { ok, status, data } for every call. */
export declare const api: {
    get: (path: string, params?: Record<string, string>) => Promise<{
        ok: boolean;
        status: number;
        data: any;
    }>;
    post: (path: string, body?: unknown, params?: Record<string, string>) => Promise<{
        ok: boolean;
        status: number;
        data: any;
    }>;
    patch: (path: string, body?: unknown, params?: Record<string, string>) => Promise<{
        ok: boolean;
        status: number;
        data: any;
    }>;
    del: (path: string, params?: Record<string, string>) => Promise<{
        ok: boolean;
        status: number;
        data: null;
    }>;
};
//# sourceMappingURL=client.d.ts.map