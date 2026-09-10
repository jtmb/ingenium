#!/usr/bin/env node
import { runCoordinationResetCli } from "../coordination-reset.js";

process.exitCode = await runCoordinationResetCli();
