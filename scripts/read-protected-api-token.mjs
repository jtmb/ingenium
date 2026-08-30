#!/usr/bin/env node
import {
  closeSync,
  constants,
  fchmodSync,
  fchownSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

const [
  source,
  expectedUidText,
  expectedGidText,
  destination,
  kind = "installation-api",
  expectedParentUidText = "0",
  expectedParentGidText = "0",
  destinationUidText = expectedUidText,
  destinationGidText = expectedGidText,
  expectedParentModeText = "700",
] = process.argv.slice(2);
const expectedUid = Number(expectedUidText);
const expectedGid = Number(expectedGidText);
const expectedParentUid = Number(expectedParentUidText);
const expectedParentGid = Number(expectedParentGidText);
const destinationUid = Number(destinationUidText);
const destinationGid = Number(destinationGidText);
const expectedParentMode = Number.parseInt(expectedParentModeText, 8);
const patterns = {
  "installation-api": /^[A-Za-z0-9_-]{32,128}$/,
  "opencode-server": /^[A-Za-z0-9_-]{64}$/,
  "email-encryption": /^[A-Za-z0-9_-]{64}$/,
};
let sourceDescriptor;
let temporaryDescriptor;
let temporary;

function fail() {
  process.stderr.write("ERROR: protected deployment secret is missing or unsafe\n");
  process.exitCode = 1;
}

try {
  const pattern = patterns[kind];
  const opaque = kind === "opaque";
  if (
    !source ||
    !destination ||
    (!pattern && !opaque) ||
    !Number.isSafeInteger(expectedUid) ||
    !Number.isSafeInteger(expectedGid) ||
    !Number.isSafeInteger(expectedParentUid) ||
    !Number.isSafeInteger(expectedParentGid) ||
    !Number.isSafeInteger(destinationUid) ||
    !Number.isSafeInteger(destinationGid) ||
    !Number.isSafeInteger(expectedParentMode)
  ) throw new Error();
  const parent = lstatSync(dirname(source));
  if (
    !parent.isDirectory() ||
    parent.uid !== expectedParentUid ||
    parent.gid !== expectedParentGid ||
    (parent.mode & 0o777) !== expectedParentMode
  ) throw new Error();
  const destinationParent = lstatSync(dirname(destination));
  if (
    !destinationParent.isDirectory() ||
    destinationParent.uid !== destinationUid ||
    destinationParent.gid !== destinationGid ||
    (destinationParent.mode & 0o777) !== 0o700
  ) throw new Error();
  sourceDescriptor = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  const metadata = fstatSync(sourceDescriptor);
  const maximumSize = opaque ? 4096 : 129;
  if (!metadata.isFile() || metadata.uid !== expectedUid || metadata.gid !== expectedGid || (metadata.mode & 0o777) !== 0o600 || metadata.size > maximumSize) throw new Error();
  const contents = readFileSync(sourceDescriptor);
  if (opaque) {
    if (contents.length < 32) throw new Error();
  } else {
    const text = contents.toString("utf8");
    const token = text.endsWith("\n") ? text.slice(0, -1) : text;
    if (!pattern.test(token)) throw new Error();
  }

  temporary = join(dirname(destination), `.deployment-secret.${randomUUID()}`);
  temporaryDescriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  writeFileSync(temporaryDescriptor, opaque ? contents : Buffer.from(`${contents.toString("utf8").replace(/\n$/, "")}\n`, "utf8"));
  fsyncSync(temporaryDescriptor);
  fchownSync(temporaryDescriptor, destinationUid, destinationGid);
  fchmodSync(temporaryDescriptor, 0o600);
  closeSync(temporaryDescriptor);
  temporaryDescriptor = undefined;
  renameSync(temporary, destination);
  temporary = undefined;
} catch {
  fail();
} finally {
  if (sourceDescriptor !== undefined) closeSync(sourceDescriptor);
  if (temporaryDescriptor !== undefined) closeSync(temporaryDescriptor);
  if (temporary !== undefined) rmSync(temporary, { force: true });
}
