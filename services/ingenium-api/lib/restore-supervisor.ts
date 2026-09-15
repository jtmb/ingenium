import { createConnection } from "node:net";

/** Fixed, non-user-controlled supervisor bridge for RESTORE-101 maintenance. */
const RESTORE_HANDOFF_SOCKET = "/run/ingenium-restore-handoff/request.sock";
const RESTORE_MAINTENANCE_PROGRAM = "restore-maintenance";

export async function startRestoreMaintenance(socketPath = RESTORE_HANDOFF_SOCKET): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection(socketPath);
    let response = "";
    const timeout = setTimeout(() => socket.destroy(new Error("RESTORE_SUPERVISOR_START_FAILED")), 5_000);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.end("1"));
    socket.on("data", (chunk) => {
      response += chunk;
      if (response.length > 5) socket.destroy(new Error("RESTORE_SUPERVISOR_START_FAILED"));
    });
    socket.on("error", () => {
      clearTimeout(timeout);
      reject(new Error("RESTORE_SUPERVISOR_START_FAILED"));
    });
    socket.on("close", () => {
      clearTimeout(timeout);
      if (response === "ok") resolve();
      else reject(new Error("RESTORE_SUPERVISOR_START_FAILED"));
    });
  });
}

export { RESTORE_HANDOFF_SOCKET, RESTORE_MAINTENANCE_PROGRAM };
