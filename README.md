# DB Editor

A small web-based database editor in the spirit of phpMyAdmin and Adminer, written in JavaScript.
It supports **MySQL/MariaDB**, **PostgreSQL** and **SQLite**, and builds to a single file you run with Node.js.

- Browse tables PhpStorm-style: type SQL into the `WHERE` and `ORDER BY` bar above the grid, or click a header to sort
- Edit cells inline with editors that fit the column type (dropdowns for boolean/enum, date and time pickers, checks for numbers, JSON, UUIDs and length) and mark rows for deletion, then Apply or Revert the changes together (tables with a primary key); the table SQL tab generates SELECT / INSERT / UPDATE / DELETE templates
- Inspect columns, indexes and foreign keys
- Run SQL scripts, with per-statement results and a query history
- phpMyAdmin-style layout: database tree on the left, breadcrumb bar, Browse / Structure / SQL tabs
- Light and dark themes: follows the system setting, or pick one with the theme button in the top bar
- The login page lists previous connections (kept in the browser, without passwords) to fill the form in one click

## Requirements

- Node.js **22.13 or newer** (SQLite uses the built-in `node:sqlite` module). With nvm: `nvm use` picks up `.nvmrc`.
- Yarn 4, through Corepack (bundled with Node 22): run `corepack enable` once. The exact Yarn version is pinned
  in `package.json` (`packageManager`), so everyone gets the same one.

## Use it

```sh
yarn install
yarn build             # -> dist/dbeditor.mjs (one self-contained file)
yarn start             # same as: node dist/dbeditor.mjs  -> http://127.0.0.1:8080/
```

`dist/dbeditor.mjs` contains the UI, the server and the MySQL/PostgreSQL drivers, so you can copy that one
file anywhere with Node 22+ and run it. Options:

```
--host 127.0.0.1   address to listen on (default: this machine only)
--port 8080        port to listen on
--allow-sqlite     allow SQLite when listening on a non-local address
```

## Develop

```sh
yarn dev      # Vite dev server with hot reload on http://127.0.0.1:5173/; the API runs inside it
yarn test     # server tests (SQL generation for all dialects + HTTP API against SQLite)
```

## Layout

```
server/
  main.js            CLI entry: parses options, starts the HTTP server
  app.js             HTTP routing, sessions, CSRF checks, security headers
  sql.js             dialect-aware SQL building (quoting, parameters, WHERE / ORDER BY checks) and script splitting
  drivers/           one class per database; base.js holds the shared row operations
src/                 Vue 3 UI (components/, tiny hash router, store, API client)
scripts/bundle.mjs   esbuild step that embeds the built UI into dist/dbeditor.mjs
test/                node:test suites
```

Adding a database means adding a driver in `server/drivers/` that implements the methods listed at the top of
`server/drivers/base.js`, plus a dialect entry in `server/sql.js` if its quoting or parameters differ.

## Security

This tool can read and change everything the database user can, so:

- It listens on **127.0.0.1** by default. Only use `--host` to expose it on a trusted network, ideally behind a
  VPN or a reverse proxy with its own authentication and HTTPS.
- Database credentials stay in server memory for the session; the browser only gets a random, `HttpOnly`,
  `SameSite=Strict` session cookie. Sessions end after 60 minutes idle or on logout.
- Every API call must carry an `X-DBEditor` header and a same-origin `Origin`, which blocks cross-site requests.
- The page is served with a strict Content-Security-Policy that only allows its own inline script and styles.
- SQLite opens files on the machine running the server, so it is disabled on non-local addresses unless you
  pass `--allow-sqlite`.
- Identifiers from the UI are checked against the table's real columns and quoted; values are always bound
  parameters. The browse view's `WHERE` / `ORDER BY` text is SQL you type, checked to be a single clause
  (no `;`, comments or unbalanced quotes and parentheses). The SQL tab runs whatever you type, as it should.

## Limitations

- Rows can only be edited or deleted in tables with a primary key; otherwise use the SQL tab.
- Binary values are shown as hex and can't be edited inline.
- No table/column creation forms yet: use the SQL tab for DDL.
- The MySQL and PostgreSQL drivers are covered by SQL-generation tests but have not yet been run against
  live servers; SQLite is tested end to end.
