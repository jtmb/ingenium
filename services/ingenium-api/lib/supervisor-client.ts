import { request, type RequestOptions } from "node:http";

export const GET_ALL_PROCESS_INFO_XML = "<?xml version=\"1.0\"?><methodCall><methodName>supervisor.getAllProcessInfo</methodName></methodCall>";

const DEFAULT_SERVER_URL = "unix:///run/ingenium-supervisor/supervisor.sock";
const RPC_PATH = "/RPC2";
const MAX_RESPONSE_BYTES = 1024 * 1024;

export interface SupervisorProcess {
  name: string;
  statename: string;
  start: number;
  now: number;
  spawnerr: string;
  pid: number;
  exitstatus: number;
  stop: number;
}

export class SupervisorUnavailableError extends Error {
  constructor() {
    super("Supervisor RPC unavailable");
    this.name = "SupervisorUnavailableError";
  }
}

function requestOptions(configuredUrl = process.env.SUPERVISOR_SERVER_URL?.trim()): RequestOptions {
  const raw = configuredUrl || DEFAULT_SERVER_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SupervisorUnavailableError();
  }

  if (url.protocol === "unix:") {
    if (!url.pathname.startsWith("/") || url.hostname || url.search || url.hash) {
      throw new SupervisorUnavailableError();
    }
    return { socketPath: url.pathname, path: RPC_PATH };
  }

  if (
    !configuredUrl
    || url.protocol !== "http:"
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || Boolean(url.username || url.password || url.search || url.hash)
    || !["/", RPC_PATH].includes(url.pathname)
  ) {
    throw new SupervisorUnavailableError();
  }
  return {
    hostname: url.hostname === "[::1]" ? "::1" : url.hostname,
    port: url.port || "80",
    path: url.pathname === "/" ? RPC_PATH : url.pathname,
  };
}

export async function supervisorRpc(xmlBody: string, timeoutMs = 5_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      if (error) reject(new SupervisorUnavailableError());
      else resolve(value ?? "");
    };

    let options: RequestOptions;
    try {
      options = requestOptions();
    } catch {
      finish(new SupervisorUnavailableError());
      return;
    }

    const req = request({
      ...options,
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
        "Content-Length": Buffer.byteLength(xmlBody),
      },
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        finish(new SupervisorUnavailableError());
        return;
      }
      response.setEncoding("utf8");
      let body = "";
      response.on("data", (chunk: string) => {
        body += chunk;
        if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) req.destroy(new SupervisorUnavailableError());
      });
      response.on("end", () => finish(undefined, body));
    });
    const timeout = setTimeout(() => req.destroy(new SupervisorUnavailableError()), timeoutMs);
    req.on("error", () => finish(new SupervisorUnavailableError()));
    req.on("close", () => clearTimeout(timeout));
    req.end(xmlBody);
  });
}

export function escapeSupervisorXml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&apos;",
    "\"": "&quot;",
  })[character]!);
}

function unescapeXml(value: string): string {
  return value.replace(/&(amp|lt|gt|apos|quot);/g, (_match, entity: string) => ({
    amp: "&",
    lt: "<",
    gt: ">",
    apos: "'",
    quot: "\"",
  })[entity]!);
}

export function extractSupervisorMember(struct: string, memberName: string): string {
  const regex = new RegExp(
    `<member>\\s*<name>${memberName}</name>\\s*<value>\\s*(<string>(.*?)</string>|<int>(.*?)</int>|<i4>(.*?)</i4>)\\s*</value>\\s*</member>`,
    "s",
  );
  const match = struct.match(regex);
  return unescapeXml(match?.[2] ?? match?.[3] ?? match?.[4] ?? "");
}

function assertResponseEnvelope(xml: string): void {
  if (!xml.includes("<methodResponse>") || !xml.includes("</methodResponse>") || xml.includes("<fault>")) {
    throw new SupervisorUnavailableError();
  }
}

export function parseSupervisorProcesses(xml: string): SupervisorProcess[] {
  assertResponseEnvelope(xml);
  const results: SupervisorProcess[] = [];
  const structRegex = /<struct>(.*?)<\/struct>/gs;
  let match: RegExpExecArray | null;
  while ((match = structRegex.exec(xml)) !== null) {
    const struct = match[1];
    if (!struct) continue;
    const name = extractSupervisorMember(struct, "name");
    const statename = extractSupervisorMember(struct, "statename");
    if (!name || !statename) throw new SupervisorUnavailableError();
    results.push({
      name,
      statename,
      start: Number.parseInt(extractSupervisorMember(struct, "start"), 10) || 0,
      now: Number.parseInt(extractSupervisorMember(struct, "now"), 10) || 0,
      spawnerr: extractSupervisorMember(struct, "spawnerr"),
      pid: Number.parseInt(extractSupervisorMember(struct, "pid"), 10) || 0,
      exitstatus: Number.parseInt(extractSupervisorMember(struct, "exitstatus"), 10) || 0,
      stop: Number.parseInt(extractSupervisorMember(struct, "stop"), 10) || 0,
    });
  }
  return results;
}

export function parseSupervisorProcessInfo(xml: string): Record<string, string> {
  assertResponseEnvelope(xml);
  const struct = xml.match(/<struct>([\s\S]*?)<\/struct>/)?.[1];
  if (!struct) throw new SupervisorUnavailableError();
  return Object.fromEntries([
    "name", "group", "start", "stop", "now", "statename", "spawnerr", "exitstatus",
    "logfile", "stdout_logfile", "stderr_logfile", "pid", "description",
  ].map((field) => [field, extractSupervisorMember(struct, field)]));
}

export function parseSupervisorString(xml: string): string {
  assertResponseEnvelope(xml);
  const match = xml.match(/<string>(.*?)<\/string>/s);
  if (!match) throw new SupervisorUnavailableError();
  return unescapeXml(match[1] ?? "");
}
