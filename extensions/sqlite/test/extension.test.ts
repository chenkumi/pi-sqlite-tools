import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import sqliteExtension from "../index.js";

test("registers the manual-mode SQLite tool set", () => {
  const toolNames: string[] = [];
  const api = {
    registerTool: (tool: { name: string }) => toolNames.push(tool.name),
    on: () => undefined,
  } as unknown as ExtensionAPI;

  sqliteExtension(api);

  assert.deepEqual(toolNames, [
    "sqlite_open",
    "sqlite_close",
    "sqlite_status",
    "sqlite_query",
    "sqlite_execute",
    "sqlite_list_tables",
    "sqlite_describe_table",
    "sqlite_manual",
  ]);
});
