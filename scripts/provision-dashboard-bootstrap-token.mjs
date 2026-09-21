#!/usr/bin/env node
import { randomBytes, randomUUID } from "node:crypto";
import { closeSync, constants, fchmodSync, fchownSync, fsyncSync, lstatSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [apiPath, apiUidText, apiGidText, dashboardPath, dashboardUidText, dashboardGidText] = process.argv.slice(2);
const targets = [
  { path: apiPath, uid: Number(apiUidText), gid: Number(apiGidText) },
  { path: dashboardPath, uid: Number(dashboardUidText), gid: Number(dashboardGidText) },
];
const token = randomBytes(48).toString("base64url");
const temporaryPaths = [];

try {
  for (const target of targets) {
    if (!target.path || !Number.isSafeInteger(target.uid) || !Number.isSafeInteger(target.gid)) throw new Error();
    const parent = lstatSync(dirname(target.path));
    if (!parent.isDirectory() || parent.uid !== target.uid || parent.gid !== target.gid || (parent.mode & 0o777) !== 0o700) throw new Error();
    const temporary = join(dirname(target.path), `.dashboard-bootstrap.${randomUUID()}`);
    temporaryPaths.push(temporary);
    const descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      writeFileSync(descriptor, `${token}\n`, "utf8");
      fsyncSync(descriptor);
      fchownSync(descriptor, target.uid, target.gid);
      fchmodSync(descriptor, 0o600);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, target.path);
    temporaryPaths.pop();
  }
} catch {
  process.stderr.write("ERROR: dashboard bootstrap credential provisioning failed\n");
  process.exitCode = 1;
} finally {
  for (const temporary of temporaryPaths) rmSync(temporary, { force: true });
}
