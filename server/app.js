import { createHash, randomBytes } from 'node:crypto';
import { drivers } from './drivers/index.js';
import { UserError } from './sql.js';

const SESSION_COOKIE = 'dbeditor_sid';
const SESSION_IDLE_MS = 60 * 60 * 1000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

class HttpError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

/**
 * Creates the request handler.
 *   html          the built single-file UI (omit in dev, where Vite serves it)
 *   allowSqlite   whether the SQLite driver may be used (it opens files on this machine)
 */
export function createApp({ html = null, allowSqlite = true } = {}) {
	const sessions = new Map();

	const sweeper = setInterval(() => {
		const now = Date.now();
		for (const [id, session] of sessions) {
			if (now - session.lastUsed > SESSION_IDLE_MS) endSession(id);
		}
	}, 60 * 1000);
	sweeper.unref();

	function endSession(id) {
		const session = sessions.get(id);
		sessions.delete(id);
		session?.driver.close().catch(() => {});
	}

	function getSession(req) {
		const id = parseCookies(req.headers.cookie)[SESSION_COOKIE];
		const session = id && sessions.get(id);
		if (!session) throw new HttpError(401, 'Not logged in.');
		session.lastUsed = Date.now();
		return session;
	}

	const routes = {
		'GET /api/drivers': async () => {
			const list = [];
			for (const [id, d] of Object.entries(drivers)) {
				const available = (id !== 'sqlite' || allowSqlite) && (d.available ? await d.available() : true);
				list.push({ id, label: d.label, server: d.server, defaultPort: d.defaultPort ?? null, available });
			}
			return { drivers: list };
		},

		'POST /api/login': async (req, res, body) => {
			const driverInfo = drivers[body.driver];
			if (!driverInfo) throw new UserError('Unknown database system.');
			if (body.driver === 'sqlite' && !allowSqlite) throw new UserError('SQLite is disabled on this server (start with --allow-sqlite).');
			const driver = await driverInfo.connect({
				host: str(body.host), port: str(body.port), user: str(body.user), password: str(body.password),
				database: str(body.database), ssl: str(body.ssl), file: str(body.file),
			});
			const id = randomBytes(32).toString('hex');
			sessions.set(id, { driver, driverId: body.driver, lastUsed: Date.now() });
			res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/`);
			return sessionInfo(sessions.get(id));
		},

		'POST /api/logout': async (req, res) => {
			const id = parseCookies(req.headers.cookie)[SESSION_COOKIE];
			if (id) endSession(id);
			res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
			return { ok: true };
		},

		'GET /api/session': async (req) => sessionInfo(getSession(req)),

		'GET /api/databases': async (req) => ({ databases: await getSession(req).driver.listDatabases() }),

		'GET /api/tables': async (req, res, body, query) => ({ tables: await getSession(req).driver.listTables(required(query.db, 'db')) }),

		'GET /api/columns': async (req, res, body, query) => ({ tables: await getSession(req).driver.listColumns(required(query.db, 'db')) }),

		'GET /api/structure': async (req, res, body, query) => {
			const info = await getSession(req).driver.describeTable(required(query.db, 'db'), required(query.table, 'table'), query.schema || null);
			if (!info.columns.length) throw new HttpError(404, `Table not found: ${query.table}`);
			return info;
		},

		'POST /api/rows': async (req, res, body) => getSession(req).driver.selectRows(required(body.db, 'db'), required(body.table, 'table'), {
			schema: body.schema || null,
			where: str(body.where),
			orderBy: str(body.orderBy),
			limit: body.limit,
			offset: body.offset,
		}),

		'POST /api/rows/insert': async (req, res, body) => getSession(req).driver.insertRow(required(body.db, 'db'), required(body.table, 'table'), {
			schema: body.schema || null, values: plainObject(body.values),
		}),

		'POST /api/rows/update': async (req, res, body) => getSession(req).driver.updateRow(required(body.db, 'db'), required(body.table, 'table'), {
			schema: body.schema || null, key: plainObject(body.key), values: plainObject(body.values),
		}),

		'POST /api/rows/delete': async (req, res, body) => getSession(req).driver.deleteRow(required(body.db, 'db'), required(body.table, 'table'), {
			schema: body.schema || null, key: plainObject(body.key),
		}),

		'POST /api/sql': async (req, res, body) => ({ results: await getSession(req).driver.runSql(body.db || null, body.sql) }),
	};

	async function sessionInfo(session) {
		return { driver: session.driverId, label: session.driver.label(), ...(await session.driver.serverInfo()) };
	}

	async function handleApi(req, res, url) {
		// The custom header cannot be sent cross-site without a CORS preflight (which is never granted),
		// and SameSite=Strict keeps the cookie off cross-site requests: together they block CSRF.
		if (req.headers['x-dbeditor'] !== '1') throw new HttpError(403, 'Missing X-DBEditor header.');
		if (req.headers.origin && !sameOrigin(req.headers.origin, req.headers.host)) throw new HttpError(403, 'Cross-origin request refused.');
		const route = routes[`${req.method} ${url.pathname}`];
		if (!route) throw new HttpError(404, 'Not found.');
		const body = req.method === 'POST' ? await readJson(req) : {};
		return route(req, res, body, Object.fromEntries(url.searchParams));
	}

	// The single-file UI only has inline <script>/<style> blocks, so the CSP allows exactly their hashes.
	const contentSecurityPolicy = html && [
		"default-src 'none'",
		`script-src ${inlineHashes(html, 'script')}`,
		`style-src ${inlineHashes(html, 'style')}`,
		"style-src-attr 'unsafe-inline'",
		"img-src 'self' data:",
		"font-src 'self' data:",
		"connect-src 'self'",
		"base-uri 'none'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	].join('; ');

	function serveHtml(res) {
		res.writeHead(200, {
			'Content-Type': 'text/html; charset=utf-8',
			'Content-Security-Policy': contentSecurityPolicy,
			'X-Content-Type-Options': 'nosniff',
			'Referrer-Policy': 'no-referrer',
			'Cache-Control': 'no-store',
		});
		res.end(html);
	}

	const handler = async (req, res, next) => {
		const url = new URL(req.url, 'http://localhost');
		if (url.pathname.startsWith('/api/')) {
			try {
				sendJson(res, 200, await handleApi(req, res, url));
			} catch (error) {
				if (error instanceof HttpError) sendJson(res, error.status, { error: error.message });
				else if (error instanceof UserError || isDatabaseError(error)) sendJson(res, 400, { error: error.message });
				else {
					console.error(error);
					sendJson(res, 500, { error: 'Internal server error.' });
				}
			}
		} else if (next) {
			next();
		} else if (html && req.method === 'GET' && url.pathname === '/') {
			serveHtml(res);
		} else {
			res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
		}
	};
	handler.close = async () => {
		clearInterval(sweeper);
		await Promise.all([...sessions.keys()].map(endSession));
	};
	return handler;
}

function inlineHashes(html, tag) {
	const blocks = html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'));
	return [...blocks].map(([, body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`).join(' ') || "'none'";
}

function sameOrigin(origin, host) {
	try {
		return new URL(origin).host === host;
	} catch {
		return false; // e.g. "Origin: null" from sandboxed frames
	}
}

function isDatabaseError(error) {
	// mysql2 sets sqlMessage/errno, pg sets severity/code, node:sqlite sets errcode.
	return error && (error.sqlMessage !== undefined || error.severity !== undefined || error.errcode !== undefined || error.code === 'ERR_SQLITE_ERROR');
}

function sendJson(res, status, data) {
	res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
	res.end(JSON.stringify(data));
}

function readJson(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				reject(new HttpError(413, 'Request too large.'));
				req.destroy();
			} else chunks.push(chunk);
		});
		req.on('end', () => {
			try {
				const text = Buffer.concat(chunks).toString('utf8');
				resolve(text ? JSON.parse(text) : {});
			} catch {
				reject(new HttpError(400, 'Invalid JSON.'));
			}
		});
		req.on('error', reject);
	});
}

function parseCookies(header = '') {
	const cookies = {};
	for (const part of header.split(';')) {
		const index = part.indexOf('=');
		if (index > 0) cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
	}
	return cookies;
}

function str(value) {
	return value === undefined || value === null ? '' : String(value);
}

function required(value, name) {
	if (value === undefined || value === null || value === '') throw new UserError(`Missing parameter: ${name}`);
	return String(value);
}

function plainObject(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, v === null || typeof v !== 'object' ? v : JSON.stringify(v)]));
}
