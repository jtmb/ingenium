/**
 * Typed HTTP client for the Ingenium API.
 * Every method returns `{ ok, status, data }` — never throws for HTTP errors (only for network/timeout exhaustion).
 *
 * The `data` field falls back to the raw response JSON if the API's standard `{ data: ... }` envelope
 * is absent (handles both wrapped and unwrapped API responses transparently).
 */
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
    put: (path: string, body?: unknown, params?: Record<string, string>) => Promise<{
        ok: boolean;
        status: number;
        data: any;
    }>;
    patch: (path: string, body?: unknown, params?: Record<string, string>) => Promise<{
        ok: boolean;
        status: number;
        data: any;
    }>;
    /** NOTE: DELETE returns `data: null` — the API typically returns no body on deletes. */
    del: (path: string, params?: Record<string, string>) => Promise<{
        ok: boolean;
        status: number;
        data: null;
    }>;
};
//# sourceMappingURL=client.d.ts.map