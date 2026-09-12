# pi-sqlite-tools

`pi-sqlite-tools` 是可由 [pi](https://github.com/earendil-works/pi-mono) 安裝的 package，提供以 `better-sqlite3` 實作的 SQLite tools。它由 `easy-sqlite-mcp` 移植而來，但不需要 MCP server 或 stdio transport。

## 安裝

發佈至 npm 後：

```bash
pi install npm:pi-sqlite-tools
```

安裝目前的本機 package 以測試：

```bash
pi install . -l
```

`-l` 會寫入專案的 `.pi/settings.json`。也可省略 `-l`，安裝到使用者層級。重新啟動 pi 或執行 `/reload` 後生效。

## 提供的 tools

- `sqlite_open`：開啟 SQLite 檔案（manual mode）
- `sqlite_close`：關閉目前連線（manual mode）
- `sqlite_status`：檢查目前連線與資料表數量
- `sqlite_query`：執行回傳資料列的 SQL（通常為 `SELECT`）
- `sqlite_execute`：執行寫入或 schema SQL
- `sqlite_list_tables`：列出非系統資料表
- `sqlite_describe_table`：檢查資料表欄位與列數
- `sqlite_manual`：回傳工具的生命週期、參數與安全規則

同一 pi session 一次只保持一個資料庫連線，session 關閉或重載時會自動關閉。

## 使用模式

預設為 manual mode。先呼叫 `sqlite_open`，再使用其他 SQLite tools。資料庫路徑可以是絕對路徑或相對 pi 專案根目錄的路徑。

設定 `SQLITE_PATH` 可改為 fixed mode：

```bash
SQLITE_PATH=./data/app.sqlite pi
```

fixed mode 會在 session 開始時自動開啟該資料庫，且不提供 `sqlite_open`、`sqlite_close`，避免 agent 切換連線。

`sqlite_query` 與 `sqlite_execute` 同時支援 positional bindings（`[1, "Ada"]`）與 named bindings（`{ "id": 1 }`）。請以 `bindings` 欄位傳遞；每一個 statement 只能使用一種風格：全部使用 `?` 時傳 array，全部使用 `:name`／`@name`／`$name` 時傳 object，**不可混用**。`params` 保留作相容用途。查詢輸出限制為 2,000 行或 50 KB；對大結果請使用 SQL `LIMIT`。

## 發佈

```bash
npm install
npm test
npm run check
npm run pack:check
npm login
npm publish
```

目前 npm registry 中 `pi-sqlite-tools` 尚無公開套件。發佈前請確認登入帳號有該 package name 的發布權限；若名稱被占用，修改 `package.json` 的 `name`（例如 `@your-scope/pi-sqlite-tools`）後再發布。

## 開發

Extension entrypoint 為 [`extensions/sqlite/index.ts`](extensions/sqlite/index.ts)，由 package manifest 的 `pi.extensions` 宣告。Pi 安裝 package 時會載入這個 entrypoint。

此專案包含 `easy-sqlite-mcp` 的 MIT 授權移植程式碼，詳見 [LICENSE](LICENSE)。
