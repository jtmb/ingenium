import { lookup } from "node:dns";
import { isIP } from "node:net";
import { promisify } from "node:util";

const lookupAsync = promisify(lookup);

export { isIP } from "node:net";

export interface EndpointPolicyOptions {
  allowPrivateNetwork: boolean;
  timeoutMs?: number;
}

export function isPrivateAddress(address: string): boolean {
  const addressType = isIP(address);
  if (addressType === 4) {
    const [first = -1, second = -1] = address.split(".").map(Number);
    return first === 0
      || first === 10
      || first === 127
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && (second === 0 || second === 168))
      || (first === 198 && (second === 18 || second === 19 || second === 51))
      || (first === 203 && second === 0)
      || first >= 224;
  }
  if (addressType !== 6) return false;

  const normalized = address.toLowerCase();
  return normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe80:")
    || normalized.startsWith("::ffff:127.")
    || normalized.startsWith("::ffff:10.")
    || normalized.startsWith("::ffff:192.168.")
    || /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(normalized);
}

export async function validateEndpointUrl(endpoint: string, allowPrivate: boolean): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("endpoint must be a valid HTTP(S) URL");
  }

  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
    throw new Error("endpoint must be an HTTP(S) URL without embedded credentials");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!allowPrivate && (hostname === "localhost" || hostname.endsWith(".localhost") || isPrivateAddress(hostname))) {
    throw new Error("endpoint points to an internal/private network address");
  }

  try {
    const addresses = await lookupAsync(hostname, { all: true, verbatim: true });
    if (!allowPrivate && addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new Error("endpoint points to an internal/private network address");
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("internal/private")) throw err;
  }
}

export async function safeLlmFetch(url: string, init: RequestInit, policy: EndpointPolicyOptions): Promise<Response> {
  const timeout = AbortSignal.timeout(policy.timeoutMs ?? 60_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetchFollowingAllowedRedirects(url, { ...init, redirect: "manual", signal }, policy, 0);
}

async function fetchFollowingAllowedRedirects(
  url: string,
  init: RequestInit,
  policy: EndpointPolicyOptions,
  redirects: number,
): Promise<Response> {
  await validateEndpointUrl(url, policy.allowPrivateNetwork);
  const response = await fetch(url, init);
  if (response.status < 300 || response.status >= 400) return response;
  if (redirects >= 10) throw new Error("endpoint redirected too many times");

  const location = response.headers.get("location");
  if (!location) return response;
  const nextUrl = new URL(location, url).toString();
  await validateEndpointUrl(nextUrl, policy.allowPrivateNetwork);
  await response.body?.cancel();
  return fetchFollowingAllowedRedirects(nextUrl, init, policy, redirects + 1);
}
