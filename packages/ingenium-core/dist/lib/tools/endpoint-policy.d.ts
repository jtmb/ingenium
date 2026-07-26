export { isIP } from "node:net";
export interface EndpointPolicyOptions {
    allowPrivateNetwork: boolean;
    timeoutMs?: number;
}
export declare function isPrivateAddress(address: string): boolean;
export declare function validateEndpointUrl(endpoint: string, allowPrivate: boolean): Promise<void>;
export declare function safeLlmFetch(url: string, init: RequestInit, policy: EndpointPolicyOptions): Promise<Response>;
//# sourceMappingURL=endpoint-policy.d.ts.map