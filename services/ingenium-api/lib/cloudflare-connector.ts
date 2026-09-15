import {
  GET_ALL_PROCESS_INFO_XML,
  parseSupervisorProcesses,
  supervisorRpc,
} from "./supervisor-client.js";

export const CLOUDFLARE_CONNECTOR_PROGRAM = "cloudflare-tunnel";

export type CloudflareConnectorState = "absent" | "stopped" | "starting" | "running" | "error" | "unavailable";

export interface CloudflareConnectorStatus {
  state: CloudflareConnectorState;
  observedAt: string;
}

export class CloudflareConnectorUnavailableError extends Error {
  constructor() {
    super("Cloudflare connector lifecycle is unavailable");
    this.name = "CloudflareConnectorUnavailableError";
  }
}

function mapState(value: string): CloudflareConnectorState {
  if (value === "RUNNING") return "running";
  if (value === "STARTING") return "starting";
  if (value === "STOPPED" || value === "EXITED") return "stopped";
  return "error";
}

export async function getCloudflareConnectorStatus(): Promise<CloudflareConnectorStatus> {
  const observedAt = new Date().toISOString();
  try {
    const process = parseSupervisorProcesses(await supervisorRpc(GET_ALL_PROCESS_INFO_XML, 3_000))
      .find(({ name }) => name === CLOUDFLARE_CONNECTOR_PROGRAM);
    return { state: process ? mapState(process.statename) : "absent", observedAt };
  } catch {
    return { state: "unavailable", observedAt };
  }
}

async function controlConnector(action: "startProcess" | "stopProcess"): Promise<CloudflareConnectorStatus> {
  const current = await getCloudflareConnectorStatus();
  if (current.state === "absent" || current.state === "unavailable") throw new CloudflareConnectorUnavailableError();
  if ((action === "startProcess" && current.state === "running")
    || (action === "stopProcess" && current.state === "stopped")) return current;

  await supervisorRpc(
    `<?xml version="1.0"?><methodCall><methodName>supervisor.${action}</methodName><params><param><value><string>${CLOUDFLARE_CONNECTOR_PROGRAM}</string></value></param><param><value><boolean>1</boolean></value></param></params></methodCall>`,
    5_000,
  );
  return getCloudflareConnectorStatus();
}

export function startCloudflareConnector(): Promise<CloudflareConnectorStatus> {
  return controlConnector("startProcess");
}

export function stopCloudflareConnector(): Promise<CloudflareConnectorStatus> {
  return controlConnector("stopProcess");
}
