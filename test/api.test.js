// End-to-end tests of the HTTP API against a real SQLite database.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';

let dir, file, server, app, base;

function seed(path) {
	const db = new DatabaseSync(path);
	db.exec(`
		CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE, country TEXT DEFAULT 'SI');
		CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE, total REAL, note BLOB);
		CREATE TABLE tags (a TEXT, b TEXT);
		CREATE VIEW big_orders AS SELECT * FROM orders WHERE total > 100;
		CREATE INDEX orders_customer ON orders (customer_id);
		INSERT INTO customers (name, email, country) VALUES ('Ana', 'ana@example.com', 'SI'), ('Luka', 'luka@example.com', 'HR'), ('Maja', NULL, 'SI');
		INSERT INTO orders (customer_id, total, note) VALUES (1, 49.9, x'0102'), (2, 120, NULL), (1, 310.25, NULL);
	`);
	db.close();
}

async function call(path, { method = 'GET', body, cookie = jar, headers = {} } = {}) {
	const res = await fetch(base + path, {
		method,
		headers: { 'x-dbeditor': '1', 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const setCookie = res.headers.get('set-cookie');
	return { status: res.status, data: await res.json(), setCookie };
}
let jar = null;
const escape = (text) => text.replace(/[+/]/g, '\\$&');

before(async () => {
	dir = mkdtempSync(join(tmpdir(), 'dbeditor-test-'));
	file = join(dir, 'shop.db');
	seed(file);
	app = createApp({ html: '<!doctype html><script type="module">1</script><style>a{}</style>', allowSqlite: true });
	server = createServer((req, res) => app(req, res));
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
	await app.close();
	server.close();
	rmSync(dir, { recursive: true, force: true });
});

describe('security', () => {
	test('API calls without the X-DBEditor header are refused', async () => {
		const res = await fetch(base + '/api/drivers');
		assert.equal(res.status, 403);
	});

	test('cross-origin API calls are refused', async () => {
		const { status } = await call('/api/drivers', { headers: { origin: 'http://evil.example' } });
		assert.equal(status, 403);
		assert.equal((await call('/api/drivers', { headers: { origin: 'null' } })).status, 403);
	});

	test('data endpoints need a session', async () => {
		assert.equal((await call('/api/databases', { cookie: null })).status, 401);
		assert.equal((await call('/api/databases', { cookie: 'dbeditor_sid=forged' })).status, 401);
	});

	test('the page is served with a hash-based CSP covering its inline blocks', async () => {
		const res = await fetch(base + '/');
		const csp = res.headers.get('content-security-policy');
		const sha = (text) => createHash('sha256').update(text).digest('base64');
		assert.match(csp, new RegExp(`script-src 'sha256-${escape(sha('1'))}'`));
		assert.match(csp, new RegExp(`style-src 'sha256-${escape(sha('a{}'))}'`));
		assert.match(csp, /default-src 'none'/);
		assert.match(csp, /frame-ancestors 'none'/);
	});

	test('SQLite can be disabled', async () => {
		const locked = createApp({ allowSqlite: false });
		const srv = createServer((req, res) => locked(req, res));
		await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
		const url = `http://127.0.0.1:${srv.address().port}`;
		const res = await fetch(url + '/api/login', { method: 'POST', headers: { 'x-dbeditor': '1' }, body: JSON.stringify({ driver: 'sqlite', file }) });
		assert.equal(res.status, 400);
		assert.match((await res.json()).error, /disabled/);
		srv.close();
		await locked.close();
	});
});

describe('session', () => {
	test('lists drivers with SQLite available', async () => {
		const { data } = await call('/api/drivers');
		assert.deepEqual(data.drivers.map((d) => d.id), ['mysql', 'postgres', 'sqlite']);
		assert.equal(data.drivers.find((d) => d.id === 'sqlite').available, true);
	});

	test('rejects a missing file', async () => {
		const { status, data } = await call('/api/login', { method: 'POST', body: { driver: 'sqlite', file: join(dir, 'missing.db') } });
		assert.equal(status, 400);
		assert.match(data.error, /File not found/);
	});

	test('logs in and sets an HttpOnly SameSite cookie', async () => {
		const { status, data, setCookie } = await call('/api/login', { method: 'POST', body: { driver: 'sqlite', file } });
		assert.equal(status, 200);
		assert.match(data.version, /^SQLite 3\./);
		assert.match(setCookie, /HttpOnly; SameSite=Strict/);
		jar = setCookie.split(';')[0];
		assert.equal((await call('/api/session')).data.driver, 'sqlite');
	});
});

describe('browsing', () => {
	test('lists databases and tables', async () => {
		assert.deepEqual((await call('/api/databases')).data.databases, [{ name: 'main' }]);
		const { tables } = (await call('/api/tables?db=main')).data;
		assert.deepEqual(tables.map((t) => [t.name, t.type, t.rows]), [['big_orders', 'view', null], ['customers', 'table', 3], ['orders', 'table', 3], ['tags', 'table', 0]]);
	});

	test('lists every column name for the sidebar search', async () => {
		const { tables } = (await call('/api/columns?db=main')).data;
		assert.deepEqual(tables.find((t) => t.table === 'orders'), { schema: null, table: 'orders', columns: ['id', 'customer_id', 'total', 'note'] });
		assert.ok(tables.some((t) => t.table === 'big_orders'), 'views are included');
	});

	test('describes columns, indexes and foreign keys', async () => {
		const { data } = await call('/api/structure?db=main&table=orders');
		assert.deepEqual(data.columns.map((c) => [c.name, c.type, c.nullable, c.primaryKey, c.autoIncrement]), [
			['id', 'INTEGER', false, true, true],
			['customer_id', 'INTEGER', false, false, false],
			['total', 'REAL', true, false, false],
			['note', 'BLOB', true, false, false],
		]);
		assert.deepEqual(data.indexes.map((i) => [i.name, i.columns, i.primary]), [['PRIMARY', ['id'], true], ['orders_customer', ['customer_id'], false]]);
		assert.deepEqual(data.foreignKeys.map((f) => [f.columns, f.refTable, f.refColumns, f.onDelete]), [[['customer_id'], 'customers', ['id'], 'CASCADE']]);
		assert.equal((await call('/api/structure?db=main&table=nope')).status, 404);
	});

	test('selects with WHERE, ORDER BY and paging', async () => {
		const { data } = await call('/api/rows', { method: 'POST', body: {
			db: 'main', table: 'customers', where: "country = 'SI'", orderBy: 'name DESC', limit: 1, offset: 0,
		} });
		assert.deepEqual(data.columns, ['id', 'name', 'email', 'country']);
		assert.deepEqual(data.rows, [[3, 'Maja', null, 'SI']]);
		assert.equal(data.total, 2);
	});

	test('returns blobs as hex', async () => {
		const { data } = await call('/api/rows', { method: 'POST', body: { db: 'main', table: 'orders', orderBy: 'id' } });
		assert.equal(data.rows[0][3], '0x0102');
	});

	test('rejects a second statement in ORDER BY', async () => {
		const { status } = await call('/api/rows', { method: 'POST', body: { db: 'main', table: 'customers', orderBy: 'id; DROP TABLE customers' } });
		assert.equal(status, 400);
	});

	test('reports SQL errors in the WHERE text', async () => {
		const { status, data } = await call('/api/rows', { method: 'POST', body: { db: 'main', table: 'customers', where: 'nope = 1' } });
		assert.equal(status, 400);
		assert.match(data.error, /nope/);
	});
});

describe('editing', () => {
	test('inserts, updates and deletes a row', async () => {
		const inserted = await call('/api/rows/insert', { method: 'POST', body: { db: 'main', table: 'customers', values: { name: 'Eva', email: 'eva@example.com' } } });
		assert.equal(inserted.status, 200);
		assert.equal(inserted.data.affected, 1);
		const id = inserted.data.insertId;

		const updated = await call('/api/rows/update', { method: 'POST', body: { db: 'main', table: 'customers', key: { id }, values: { country: null } } });
		assert.equal(updated.data.affected, 1);

		const { data } = await call('/api/rows', { method: 'POST', body: { db: 'main', table: 'customers', where: `id = ${id}` } });
		assert.deepEqual(data.rows, [[id, 'Eva', 'eva@example.com', null]]);

		assert.equal((await call('/api/rows/delete', { method: 'POST', body: { db: 'main', table: 'customers', key: { id } } })).data.affected, 1);
	});

	test('reports constraint errors from the database', async () => {
		const { status, data } = await call('/api/rows/insert', { method: 'POST', body: { db: 'main', table: 'customers', values: { email: 'x@example.com' } } });
		assert.equal(status, 400);
		assert.match(data.error, /NOT NULL/);
	});

	test('updating a row that no longer exists is an error', async () => {
		const { status, data } = await call('/api/rows/update', { method: 'POST', body: { db: 'main', table: 'customers', key: { id: 999 }, values: { name: 'x' } } });
		assert.equal(status, 400);
		assert.match(data.error, /No row was updated/);
	});
});

describe('SQL console', () => {
	test('runs several statements and returns each result', async () => {
		const { data } = await call('/api/sql', { method: 'POST', body: { db: 'main', sql: "UPDATE customers SET country = 'AT' WHERE id = 2; SELECT c.id, o.id FROM customers c JOIN orders o ON o.customer_id = c.id WHERE c.id = 2" } });
		assert.equal(data.results.length, 2);
		assert.equal(data.results[0].affected, 1);
		assert.deepEqual(data.results[1].columns, ['id', 'id']);
		assert.deepEqual(data.results[1].rows, [[2, 2]]);
	});

	test('stops at the first failing statement', async () => {
		const { data } = await call('/api/sql', { method: 'POST', body: { db: 'main', sql: 'SELECT 1; SELECT * FROM nope; SELECT 3' } });
		assert.equal(data.results.length, 2);
		assert.match(data.results[1].error, /no such table/);
	});

	test('logout ends the session', async () => {
		await call('/api/logout', { method: 'POST' });
		assert.equal((await call('/api/session')).status, 401);
	});
});
