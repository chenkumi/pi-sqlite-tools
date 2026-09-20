# AGENTS.md

## Project

`pi-sqlite-tools` is a TypeScript ESM package that adds SQLite tools to pi through the extension declared in `package.json` (`pi.extensions`). It uses Node's built-in `node:sqlite`; Node.js **22.5+** is required.

## Where to work

- `extensions/sqlite/index.ts` registers the pi tools, handles manual versus fixed (`SQLITE_PATH`) connection modes, and formats tool output.
- `extensions/sqlite/sqlite-manager.ts` owns the single synchronous `DatabaseSync` connection and SQL behavior.
- `extensions/sqlite/test/` contains Node built-in test-runner coverage.
- `README.md` is user-facing documentation; update it when tools, lifecycle, installation, or safety behavior changes.

## Behavior to preserve

- One database connection is maintained per pi session and closed on session shutdown.
- Without `SQLITE_PATH`, callers must use `sqlite_open`; with it, opening/closing tools are intentionally not registered so the database cannot be switched.
- Keep `sqlite_query` limited to row-returning statements and `sqlite_execute` limited to non-row-returning statements.
- SQL bindings accept either positional arrays or named objects, never a mix in one statement. Prefer the `bindings` field; `params` remains a compatibility alias.
- Do not interpolate user values into SQL. Quote identifiers and SQL string literals with the existing helpers when dynamic names are unavoidable.
- Tool output must remain JSON-safe and respect pi's 2,000-line / 50-KB truncation behavior.

## Development

```bash
npm test
npm run check
npm run pack:check
```

Run the relevant tests after a focused change; run all three commands before considering a release-facing change complete. `npm run pack:check` verifies the npm tarball contents, so keep `package.json`'s `files` list aligned with required runtime files.

## TypeScript conventions

- The project is strict TypeScript with `module`/`moduleResolution` set to `NodeNext`.
- Use `.js` in relative TypeScript import specifiers so emitted Node ESM imports resolve correctly.
- Keep extension code dependency-light: runtime dependencies are supplied by pi, Node, and peer dependencies.
