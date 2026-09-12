import Database from "better-sqlite3";

export type SqlParams = readonly unknown[] | Record<string, unknown>;

export interface SqliteStatus {
  isOpen: boolean;
  filePath: string | null;
  tables: number | null;
}

/** Manages one synchronous SQLite connection for the current pi session. */
export class SqliteManager {
  private database: Database.Database | undefined;
  private currentPath: string | undefined;

  open(filePath: string): { success: boolean; message: string } {
    try {
      this.closeIfOpen();
      this.database = new Database(filePath);
      this.database.pragma("journal_mode = WAL");
      this.currentPath = filePath;
      return { success: true, message: `Database opened: ${filePath}` };
    } catch (error) {
      this.database = undefined;
      this.currentPath = undefined;
      return { success: false, message: `Failed to open database: ${errorMessage(error)}` };
    }
  }

  close(): { success: boolean; message: string } {
    if (!this.database) {
      return { success: false, message: "No database is currently open." };
    }

    try {
      const closedPath = this.currentPath;
      this.database.close();
      this.database = undefined;
      this.currentPath = undefined;
      return { success: true, message: `Database closed: ${closedPath}` };
    } catch (error) {
      return { success: false, message: `Failed to close database: ${errorMessage(error)}` };
    }
  }

  status(): SqliteStatus {
    const db = this.database;
    if (!db) return { isOpen: false, filePath: null, tables: null };

    let tables: number | null = null;
    try {
      tables = (db.prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      ).get() as { count: number }).count;
    } catch {
      // A status call should still succeed if SQLite cannot read its catalogue.
    }

    return { isOpen: true, filePath: this.currentPath ?? null, tables };
  }

  query(sql: string, params?: SqlParams): { columns: string[]; rows: unknown[][]; rowCount: number } {
    const statement = this.getDatabase().prepare(sql);
    if (!statement.reader) {
      throw new Error("sqlite_query accepts only statements that return rows. Use sqlite_execute for writes.");
    }

    const rows = this.bind(statement, params).all() as Record<string, unknown>[];
    const columns = rows.length === 0 ? [] : Object.keys(rows[0]);
    return {
      columns,
      rows: rows.map((row) => columns.map((column) => row[column])),
      rowCount: rows.length,
    };
  }

  execute(sql: string, params?: SqlParams): { changes: number; lastInsertRowid: number | bigint } {
    const statement = this.getDatabase().prepare(sql);
    if (statement.reader) {
      throw new Error("sqlite_execute does not accept statements that return rows. Use sqlite_query instead.");
    }

    const result = this.bind(statement, params).run();
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  }

  listTables(): { tables: string[] } {
    const rows = this.getDatabase().prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all() as { name: string }[];
    return { tables: rows.map((row) => row.name) };
  }

  describeTable(tableName: string): {
    name: string;
    columns: Array<{
      cid: number;
      name: string;
      type: string;
      notnull: boolean;
      defaultValue: unknown;
      pk: boolean;
    }>;
    rowCount: number;
  } {
    const db = this.getDatabase();
    const quotedName = quoteSqlString(tableName);
    const columns = db.prepare(`PRAGMA table_info(${quotedName})`).all() as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
      pk: number;
    }>;

    if (columns.length === 0) throw new Error(`Table '${tableName}' not found.`);

    const rowCount = (db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`).get() as {
      count: number;
    }).count;

    return {
      name: tableName,
      columns: columns.map((column) => ({
        cid: column.cid,
        name: column.name,
        type: column.type,
        notnull: column.notnull === 1,
        defaultValue: column.dflt_value,
        pk: column.pk === 1,
      })),
      rowCount,
    };
  }

  private getDatabase(): Database.Database {
    if (!this.database) {
      throw new Error("No database is currently open. Use sqlite_open to open a database first.");
    }
    return this.database;
  }

  private bind(statement: Database.Statement, params?: SqlParams): Database.Statement {
    return params === undefined ? statement : statement.bind(params as never);
  }

  private closeIfOpen(): void {
    if (!this.database) return;
    this.database.close();
    this.database = undefined;
    this.currentPath = undefined;
  }
}

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
