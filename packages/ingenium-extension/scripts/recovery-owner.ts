#!/usr/bin/env node
import { runDetachedRecoveryOwner } from "../tui-recovery.js";

if (process.argv.length !== 3) throw new Error("Recovery owner requires one payload");
await runDetachedRecoveryOwner(process.argv[2]!);
