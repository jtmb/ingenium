#!/usr/bin/env node
import { runManagedTui } from "../tui-recovery.js";

process.exitCode = await runManagedTui();
