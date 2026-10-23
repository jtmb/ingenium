import { createServer } from "node:http";
import {
  CanaryDispatcher,
  RealCanaryActions,
  assertCanaryPlan,
  type CanaryActionContext,
  type CanaryPlan,
  type CanaryRequest,
} from "./canary-dispatcher";

interface RunnerInput {
  plan: CanaryPlan;
  request: CanaryRequest;
  context: Omit<CanaryActionContext, "abort">;
}

const actionController = new AbortController();
const signalHandlers = new Map(["SIGINT", "SIGTERM"].map((signal) => [signal, () => {
  actionController.abort(new Error(`Canary action received ${signal}`));
}] as const));
for (const [signal, handler] of signalHandlers) process.once(signal, handler);

async function readInput(): Promise<RunnerInput> {
  let encoded = "";
  for await (const chunk of process.stdin) encoded += String(chunk);
  if (Buffer.byteLength(encoded, "utf8") > 128 * 1024) throw new Error("Canary action input is too large");
  const value: unknown = JSON.parse(encoded);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== "context,plan,request") throw new Error("Canary action input is invalid");
  const input = value as RunnerInput;
  assertCanaryPlan(input.plan);
  if (!input.context || typeof input.context.sessionId !== "string" || typeof input.context.messageId !== "string") {
    throw new Error("Canary action context is invalid");
  }
  return input;
}

async function main(): Promise<void> {
  const input = await readInput();
  if (process.env.INGENIUM_COORDINATION_HANG_ACTION_TEST === "1") {
    const port = Number(process.env.INGENIUM_COORDINATION_HANG_ACTION_PORT);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Hanging action test port is invalid");
    const server = createServer((_request, response) => response.end("hanging"));
    server.listen(port, "127.0.0.1");
    await new Promise<void>(() => {});
  }
  const dispatcher = new CanaryDispatcher(input.plan, new RealCanaryActions(input.plan));
  const result = await dispatcher.dispatch(input.request, { ...input.context, abort: actionController.signal });
  const encoded = Buffer.from(JSON.stringify({ result }), "utf8").toString("base64url");
  process.stdout.write(`\nINGENIUM_CANARY_RESULT:${encoded}\n`);
}

void main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(() => {
  for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
});
