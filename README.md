# DB Editor

A small web-based database editor in the spirit of phpMyAdmin and Adminer, written in JavaScript.
It supports **MySQL/MariaDB**, **PostgreSQL** and **SQLite**, and builds to a single file you run with Node.js.

- Browse tables PhpStorm-style: type SQL into the `WHERE` and `ORDER BY` bar above the grid, or click a header to sort
- Edit cells inline with editors that fit the column type (dropdowns for boolean/enum, date and time pickers, checks for numbers, JSON, UUIDs and length) and mark rows for deletion, then Apply or Revert the changes together (tables with a primary key); the table SQL tab generates SELECT / INSERT / UPDATE / DELETE templates
- Inspect columns, indexes and foreign keys; create tables and edit their columns with a form that shows the SQL
  before it runs
- Run SQL scripts, with per-statement results and a query history
- phpMyAdmin-style layout: database tree on the left, breadcrumb bar, Tables / SQL / Create table tabs on a
  database and Browse / Structure / SQL tabs on a table
- Light and dark themes: follows the system setting, or pick one with the theme button in the top bar
- The login page lists previous connections (kept in the browser, without passwords) to fill the form in one click

## Requirements

- Node.js **22.13 or newer** (SQLite uses the built-in `node:sqlite` module). With nvm: `nvm use` picks up `.nvmrc`.
- Yarn 4, through Corepack (bundled with Node 22): run `corepack enable` once. The exact Yarn version is pinned
  in `package.json` (`packageManager`), so everyone gets the same one.

## Use it

There are two builds of the same editor: a single file run with Node.js, and a desktop app (below).

```sh
yarn install
yarn build:cli         # -> dist/dbeditor.mjs (one self-contained file)
yarn build:desktop     # -> the desktop app in release/ (see Desktop app)
yarn build             # both: the two bundles are built in parallel, then the desktop app is packaged
yarn start             # same as: node dist/dbeditor.mjs  -> http://127.0.0.1:8080/
```

`dist/dbeditor.mjs` contains the UI, the server and the MySQL/PostgreSQL drivers, so you can copy that one
file anywhere with Node 22.13+ and run it. Options:

```
--host 127.0.0.1   address to listen on (default: this machine only)
--port 8080        port to listen on
--allow-sqlite     allow SQLite when listening on a non-local address
-h, --help         show these options
```

## Desktop app

The same editor also runs as a desktop app (Electron), packaged as one executable file:

```sh
yarn desktop               # build and open it from this checkout, without packaging
yarn build:desktop         # -> release/dbeditor-<version>-x86_64.AppImage on Linux
yarn build:desktop --win   # -> release/dbeditor-<version>-x64.exe, a portable .exe (also builds on Linux)
```

macOS builds (`--mac`, a `.dmg`) have to be made on a Mac. The files are not code-signed, so Windows
SmartScreen and macOS Gatekeeper warn before the first start.

The app starts the server inside itself on `127.0.0.1` and shows the UI in its own window. Only that window
can use the server: its requests carry a key made at each start, and anything else gets `403`. SQLite is
always available. The port is kept between runs (in `settings.json` in the app's data folder, e.g.
`~/.config/DB Editor/` on Linux) so that saved connections, query history and the theme are kept too.

## Using the UI

1. **Log in.** Pick the system (MySQL/MariaDB, PostgreSQL or SQLite). For MySQL and PostgreSQL, enter the
   server, port, username and password; the database is optional (PostgreSQL defaults to `postgres`). For
   SQLite, enter the path to the database file on the machine running the server. Earlier connections are
   listed under the form: click one to fill it in again (you still type the password).
2. **Find a table.** The left sidebar lists the databases; expand one to see its tables and their columns.
   The filter box above it matches table and column names. ↻ reloads the list after you change the schema.
   Clicking a database opens its table list with row counts and links to each table.
3. **Browse and edit rows** (Browse tab):
   - Type a condition into `WHERE` or `ORDER BY` above the grid and press Enter. Clicking a column header
     cycles ascending → descending → unsorted.
   - Click a cell to edit it. Enter keeps the value, Tab / Shift+Tab move to the next / previous cell,
     Esc cancels, and the NULL button sets the value to NULL.
   - Tick rows and press **Delete selected** to mark them for deletion.
   - Changes are only pending (highlighted) until you press **Apply**; **Revert** discards them. Rows are
     written one at a time, so if one fails, the ones before it are saved and the rest stay pending.
   - Tables without a primary key are read-only here; change them from the SQL tab.
4. **Structure tab:** columns, indexes and foreign keys of the table. On tables (not views), **Edit structure**
   opens a form to rename the table and rename, add, remove or change columns (type, NULL, default, primary
   key, auto increment, comment). Remove marks a column to be dropped; Restore takes that back.
   - The SQL it will run is shown below the form and updates as you type. Nothing changes until you press
     **Save changes**, and dropping columns asks for confirmation first.
   - Types and defaults are written as SQL: `varchar(255)`, `'text'`, `0`, `CURRENT_TIMESTAMP`. Leave the
     default empty for none.
   - On PostgreSQL and SQLite the changes are applied together or not at all. On MySQL they are one
     `ALTER TABLE` statement.
   - SQLite can only rename, add and drop the columns of an existing table, so the other fields are disabled
     there; make those changes from the SQL tab.
5. **Create a table** from the **Create table** tab of a database: the same form, starting with an `id`
   primary key column. On PostgreSQL, set the schema next to the table name (default `public`).
6. **SQL tab:** run one or more statements separated by `;` with **Go** or Ctrl+Enter. Each statement gets
   its own result. On a table, the Generate buttons write a SELECT / INSERT / UPDATE / DELETE to start from.
   Recent queries are listed under History (kept in this browser); click one to load it.

The theme button in the top bar switches between system, light and dark. **Log out** ends the session;
sessions also end after 60 minutes idle.

## Develop

```sh
yarn dev      # Vite dev server with hot reload on http://127.0.0.1:5173/; the API runs inside it
yarn test     # SQL generation for all dialects (queries, structure form, templates) + HTTP API against SQLite
```

## Layout

```
server/
  main.js            CLI entry: parses options, starts the HTTP server
  app.js             HTTP routing, sessions, CSRF checks, security headers
  sql.js             dialect-aware SQL building (quoting, parameters, WHERE / ORDER BY checks) and script splitting
  drivers/           one class per database; base.js holds the shared row operations
src/                 Vue 3 UI (components/, tiny hash router, store, API client)
  ddl.js             CREATE / ALTER TABLE statements for the structure form
scripts/bundle.mjs   esbuild step that embeds the built UI into dist/dbeditor.mjs and dist/desktop/ (--cli / --desktop for one)
desktop/main.js      Electron entry: starts the server and opens the window; icon.svg is the source of icon.png
electron-builder.yml packaging of the desktop app
test/                node:test suites
```

Adding a database means adding a driver in `server/drivers/` that implements the methods listed at the top of
`server/drivers/base.js`, plus a dialect entry in `server/sql.js` if its quoting or parameters differ. For the
structure form, add its supported changes and common types to `FEATURES` and `TYPES` in `src/ddl.js`, and its
ALTER TABLE syntax to `alterTableSql`.

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
- The structure form quotes table and column names. Types and defaults are SQL you type, used as written,
  and the whole script is shown before it runs.

## Limitations

- Rows can only be edited or deleted in tables with a primary key; otherwise use the SQL tab.
- Binary values are shown as hex and can't be edited inline.
- The structure form covers columns and the primary key. Indexes, foreign keys and column order are changed
  from the SQL tab, as are SQLite column changes other than rename, add and drop.
- Renaming a MySQL column without changing anything else uses `RENAME COLUMN`, which needs MySQL 8.0 or
  MariaDB 10.5.2 or newer.
- The MySQL and PostgreSQL drivers are covered by SQL-generation tests but have not yet been run against
  live servers; SQLite is tested end to end.
