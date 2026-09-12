import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteManager } from "../sqlite-manager.js";

test("supports the SQLite tool workflow with positional and named parameters", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-sqlite-tools-"));
  const manager = new SqliteManager();

  assert.equal(manager.open(join(directory, "app.db")).success, true);
  assert.deepEqual(manager.execute(
    "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)",
  ), { changes: 0, lastInsertRowid: 0 });
  assert.equal(manager.execute("INSERT INTO users (name) VALUES (?)", ["Ada"]).changes, 1);
  assert.equal(manager.execute("INSERT INTO users (name) VALUES (:name)", { name: "Grace" }).changes, 1);

  assert.deepEqual(manager.query("SELECT name FROM users WHERE id = ?", [1]), {
    columns: ["name"],
    rows: [["Ada"]],
    rowCount: 1,
  });
  assert.deepEqual(manager.listTables(), { tables: ["users"] });

  const description = manager.describeTable("users");
  assert.equal(description.rowCount, 2);
  assert.deepEqual(description.columns.map((column) => column.name), ["id", "name"]);
  assert.equal(manager.close().success, true);
});

test("requires a connection and keeps query and execute roles separate", () => {
  const manager = new SqliteManager();
  assert.throws(() => manager.query("SELECT 1"), /No database is currently open/);

  const directory = mkdtempSync(join(tmpdir(), "pi-sqlite-tools-"));
  manager.open(join(directory, "app.db"));
  assert.throws(() => manager.query("CREATE TABLE test (id INTEGER)"), /sqlite_query accepts only/);
  manager.execute("CREATE TABLE test (id INTEGER)");
  assert.throws(() => manager.execute("SELECT * FROM test"), /sqlite_execute does not accept/);
  manager.close();
});

test("quotes unusual table names safely", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-sqlite-tools-"));
  const manager = new SqliteManager();
  manager.open(join(directory, "app.db"));
  manager.execute('CREATE TABLE "odd""name" (value TEXT)');
  manager.execute('INSERT INTO "odd""name" (value) VALUES (?)', ["ok"]);

  assert.equal(manager.describeTable('odd"name').rowCount, 1);
  manager.close();
});
