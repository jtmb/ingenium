# Kaban → Ingenium Migration

## Overview

This skill documents the procedure for replacing Kaban MCP dependencies with native Ingenium tools.

## Tool Mapping

| Kaban Tool | Ingenium Equivalent |
|-----------|-------------------|
| kaban_get_next_task | ingenium_task_next |
| kaban_complete_task | ingenium_task_complete |
| kaban_move_task | ingenium_task_move |
| kaban_create_task | ingenium_task_create |
| kaban_task_board | ingenium_task_list |
| kaban_board_update | ingenium_task_move |

## Procedure

1. Search all agent files for `kaban_*` references
2. Replace each with the corresponding `ingenium_*` tool
3. Remove `kaban-board` from agent skill lists
4. Remove kaban-board from MCP permission sections
5. Remove kaban MCP server entry from opencode.json
6. Update any skill files referencing kaban tools
7. Run full test suite to verify no kaban references remain

## 🔴 HARD RULE

After completing a kaban→ingenium migration, run `grep -r "kaban" .opencode/` and `grep -r "kaban" .agents/` to verify zero references remain.
