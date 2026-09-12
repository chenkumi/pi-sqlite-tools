import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { SqliteManager, type SqlParams } from "./sqlite-manager.js";

const fixedDatabasePath = process.env.SQLITE_PATH?.trim();
const manual = `# SQLite tools

This extension is ported from \`easy-sqlite-mcp\` and maintains one SQLite connection per pi session.

## Lifecycle

- Without \`SQLITE_PATH\`, first call \`sqlite_open\` with an absolute or project-relative database path. Call \`sqlite_close\` when finished.
- With \`SQLITE_PATH\`, the extension opens that database for every session. \`sqlite_open\` and \`sqlite_close\` are unavailable, so the connection cannot be switched.

## SQL parameters

Both \`sqlite_query\` and \`sqlite_execute\` accept bindings in exactly one style per statement: use a positional array such as \`[42, "Ada"]\` only when every placeholder is \`?\`; or use a named object such as \`{ "id": 42 }\` for \`:id\`, \`@id\`, or \`$id\` placeholders. Do not mix positional and named placeholders in one statement. Pass values in \`bindings\`; \`params\` remains accepted for compatibility.

## Safety

Use \`sqlite_query\` only for statements that return rows; use \`sqlite_execute\` for writes or schema changes. Check \`sqlite_status\` before modifying data and use \`sqlite_list_tables\` or \`sqlite_describe_table\` to inspect an unfamiliar database. Query output is limited to 2,000 lines or 50 KB; use \`LIMIT\` for large results.`;

// Keep this as an unconstrained JSON value at the tool-schema boundary. Pi providers
// can otherwise coerce a TypeBox array/object union to an empty collection before
// execute() receives it. The runtime guard below narrows it before SQLite sees it.
const paramsSchema = Type.Optional(Type.Any({
  description: "Optional SQL bindings. Use an array only when every placeholder is ?, or an object only for :name/@name/$name placeholders. Do not mix both styles; object keys may omit the prefix.",
}));

const querySchema = Type.Object({
  sql: Type.String({ minLength: 1, description: "A single SQL statement that returns rows (normally SELECT)" }),
  bindings: paramsSchema,
  params: paramsSchema,
});

type QueryInput = Static<typeof querySchema>;

const executeSchema = Type.Object({
  sql: Type.String({ minLength: 1, description: "A single write or schema SQL statement (INSERT, UPDATE, DELETE, CREATE, etc.)" }),
  bindings: paramsSchema,
  params: paramsSchema,
});

type ExecuteInput = Static<typeof executeSchema>;

function normalizePath(input: string, cwd: string): string {
  const path = input.startsWith("@") ? input.slice(1) : input;
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}

function asParams(params: unknown): SqlParams | undefined {
  if (params === undefined) return undefined;
  if (Array.isArray(params)) return params;
  if (params !== null && typeof params === "object") return params as Record<string, unknown>;
  throw new Error("SQL bindings must be an array for positional placeholders or an object for named placeholders.");
}

function getBindings(input: QueryInput | ExecuteInput): SqlParams | undefined {
  // `bindings` avoids a transport-level `params` field collision in some tool clients.
  return asParams(input.bindings ?? input.params);
}

function json(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "bigint") return item.toString();
    if (item instanceof Uint8Array) return { type: "Buffer", data: [...item] };
    return item;
  }, 2);
}

async function formatResult(value: unknown) {
  const output = json(value);
  const truncation = truncateHead(output, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  if (!truncation.truncated) return { text: output, truncated: false };

  const directory = join(tmpdir(), "pi-sqlite-tools");
  const outputPath = join(directory, `${randomUUID()}.json`);
  await mkdir(directory, { recursive: true });
  await writeFile(outputPath, output, "utf8");

  return {
    text: `${truncation.content}\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${outputPath}]`,
    truncated: true,
  };
}

export default function sqliteExtension(pi: ExtensionAPI) {
  const manager = new SqliteManager();
  let fixedOpenError: string | undefined;

  function ensureFixedDatabaseAvailable(): void {
    if (fixedOpenError) throw new Error(`Could not open SQLITE_PATH: ${fixedOpenError}`);
  }

  async function result(value: unknown) {
    const output = await formatResult(value);
    return {
      content: [{ type: "text" as const, text: output.text }],
      details: { outputTruncated: output.truncated },
    };
  }

  if (!fixedDatabasePath) {
    pi.registerTool({
      name: "sqlite_open",
      label: "Open SQLite Database",
      description: "Open one SQLite database file. Replaces and closes the previously open database, if any.",
      promptSnippet: "Open an SQLite database for the sqlite_* tools",
      promptGuidelines: ["Use sqlite_open before other sqlite_* tools when SQLITE_PATH is not configured."],
      parameters: Type.Object({
        file_path: Type.String({ minLength: 1, description: "Absolute or project-relative SQLite database path" }),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const filePath = normalizePath(params.file_path, ctx.cwd);
        return result(manager.open(filePath));
      },
    });

    pi.registerTool({
      name: "sqlite_close",
      label: "Close SQLite Database",
      description: "Close the currently open SQLite database connection.",
      parameters: Type.Object({}),
      async execute() {
        return result(manager.close());
      },
    });
  }

  pi.registerTool({
    name: "sqlite_status",
    label: "SQLite Database Status",
    description: "Report whether a database is open, its resolved path, and its user-table count.",
    promptSnippet: "Check the active SQLite connection and database summary",
    parameters: Type.Object({}),
    async execute() {
      return result(manager.status());
    },
  });

  pi.registerTool({
    name: "sqlite_query",
    label: "Query SQLite Database",
    description: "Execute one SQL statement that returns rows, normally SELECT. Pass bindings as either an array for every ? placeholder or an object for every :name/@name/$name placeholder; never mix styles. Results are truncated to 2,000 lines or 50 KB.",
    promptSnippet: "Read rows from the active SQLite database",
    promptGuidelines: ["Use sqlite_query only for SQL that returns rows; use sqlite_execute for mutations."],
    parameters: querySchema,
    async execute(_id, params) {
      ensureFixedDatabaseAvailable();
      return result(manager.query(params.sql, getBindings(params)));
    },
  });

  pi.registerTool({
    name: "sqlite_execute",
    label: "Execute SQLite Statement",
    description: "Execute one non-row-returning SQLite write or schema statement (INSERT, UPDATE, DELETE, CREATE, etc.). Pass bindings as either an array for every ? placeholder or an object for every :name/@name/$name placeholder; never mix styles.",
    promptSnippet: "Modify data or schema in the active SQLite database",
    promptGuidelines: ["Use sqlite_execute only after confirming the active database with sqlite_status when the operation changes data or schema."],
    parameters: executeSchema,
    async execute(_id, params) {
      ensureFixedDatabaseAvailable();
      return result(manager.execute(params.sql, getBindings(params)));
    },
  });

  pi.registerTool({
    name: "sqlite_list_tables",
    label: "List SQLite Tables",
    description: "List non-system tables in the active SQLite database.",
    parameters: Type.Object({}),
    async execute() {
      ensureFixedDatabaseAvailable();
      return result(manager.listTables());
    },
  });

  pi.registerTool({
    name: "sqlite_describe_table",
    label: "Describe SQLite Table",
    description: "Show a table's columns, primary-key metadata, defaults, and row count.",
    parameters: Type.Object({
      table_name: Type.String({ minLength: 1, description: "Exact table name to inspect" }),
    }),
    async execute(_id, params) {
      ensureFixedDatabaseAvailable();
      return result(manager.describeTable(params.table_name));
    },
  });

  pi.registerTool({
    name: "sqlite_manual",
    label: "SQLite Tools Manual",
    description: "Explain the SQLite tool lifecycle, parameter binding, safety rules, and output limits.",
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: "text", text: manual }], details: {} };
    },
  });

  pi.on("session_start", (_event, ctx) => {
    if (!fixedDatabasePath) return;
    const opened = manager.open(normalizePath(fixedDatabasePath, ctx.cwd));
    fixedOpenError = opened.success ? undefined : opened.message;
    if (fixedOpenError && ctx.hasUI) ctx.ui.notify(fixedOpenError, "error");
  });

  pi.on("session_shutdown", () => {
    manager.close();
  });
}
