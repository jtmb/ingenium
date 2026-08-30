#!/usr/bin/env node
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const scheme = process.env.INGENIUM_RUNTIME_SCHEME;
const rootDomain = process.env.INGENIUM_RUNTIME_ROOT_DOMAIN;
const port = Number(process.env.INGENIUM_RUNTIME_GATEWAY_PORT);

if ((scheme !== "http" && scheme !== "https") || !rootDomain || !Number.isSafeInteger(port)) process.exit(1);

const hostname = `health.${rootDomain}`;
const request = (scheme === "https" ? httpsRequest : httpRequest)({
  hostname: "127.0.0.1",
  port,
  path: "/__ingenium/health",
  method: "GET",
  headers: { Host: hostname },
  servername: hostname,
  timeout: 2_000,
}, (response) => {
  response.resume();
  if (response.statusCode !== 421) process.exitCode = 1;
});
request.on("timeout", () => request.destroy(new Error("timeout")));
request.on("error", () => { process.exitCode = 1; });
request.end();
