// Dialect-aware SQL building shared by all drivers.
// Identifiers are always quoted and every value goes through a bound parameter; the only raw SQL
// accepted is the WHERE / ORDER BY text typed in the browse view, checked by `clause()`.

export class UserError extends Error {}

export const dialects = {
	mysql: {
		name: 'mysql',
		quote: (id) => '`' + String(id).replaceAll('`', '``') + '`',
		param: () => '?',
		emptyInsert: ' () VALUES ()',
		transactionalDdl: false, // every CREATE / ALTER commits on its own
	},
	postgres: {
		name: 'postgres',
		quote: (id) => '"' + String(id).replaceAll('"', '""') + '"',
		param: (i) => '$' + i,
		emptyInsert: ' DEFAULT VALUES',
		transactionalDdl: true,
	},
	sqlite: {
		name: 'sqlite',
		quote: (id) => '"' + String(id).replaceAll('"', '""') + '"',
		param: () => '?',
		emptyInsert: ' DEFAULT VALUES',
		transactionalDdl: true,
	},
};

class Params {
	constructor(dialect) {
		this.dialect = dialect;
		this.values = [];
	}
	add(value) {
		this.values.push(value);
		return this.dialect.param(this.values.length);
	}
}

/** `schema`.`table`, or just `table` when there is no schema. */
export function tableRef(dialect, table, schema) {
	return (schema ? dialect.quote(schema) + '.' : '') + dialect.quote(table);
}

function checkColumn(columns, name) {
	if (!columns.includes(name)) throw new UserError(`Unknown column: ${name}`);
}

const DOLLAR_TAG = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/;

/**
 * A WHERE condition or ORDER BY list typed by the user, trimmed. It must stay a single clause:
 * no top-level `;`, no comments (which could hide the LIMIT after it), balanced quotes and parentheses.
 */
export function clause(text, dialectName, label) {
	const sql = String(text ?? '').trim();
	const fail = (why) => {
		throw new UserError(`${label}: ${why}`);
	};
	let depth = 0;
	let i = 0;
	while (i < sql.length) {
		const ch = sql[i];
		const next = sql[i + 1];
		if (ch === "'" || ch === '"' || (ch === '`' && dialectName === 'mysql')) {
			i++;
			while (true) {
				if (i >= sql.length) fail('unterminated quote.');
				if (sql[i] === '\\' && dialectName === 'mysql') i += 2;
				else if (sql[i] === ch && sql[i + 1] === ch) i += 2;
				else if (sql[i] === ch) break;
				else i++;
			}
			i++;
		} else if ((ch === '-' && next === '-') || (ch === '#' && dialectName === 'mysql') || (ch === '/' && next === '*')) {
			fail('comments are not allowed.');
		} else if (ch === '$' && dialectName === 'postgres' && DOLLAR_TAG.test(sql.slice(i))) {
			const tag = DOLLAR_TAG.exec(sql.slice(i))[0];
			const end = sql.indexOf(tag, i + tag.length);
			if (end < 0) fail('unterminated quote.');
			i = end + tag.length;
		} else if (ch === ';') {
			fail('only one clause is allowed (no ";").');
		} else {
			if (ch === '(') depth++;
			if (ch === ')' && --depth < 0) fail('unbalanced parentheses.');
			i++;
		}
	}
	if (depth) fail('unbalanced parentheses.');
	return sql;
}

function whereClause(dialect, where) {
	const sql = clause(where, dialect.name, 'WHERE');
	return sql ? ` WHERE ${sql}` : '';
}

/** WHERE clause matching one row by its key columns ({column: value}). */
function whereKey(dialect, params, key, columns) {
	const entries = Object.entries(key ?? {});
	if (!entries.length) throw new UserError('Missing row key.');
	return ' WHERE ' + entries.map(([column, value]) => {
		checkColumn(columns, column);
		return value === null ? `${dialect.quote(column)} IS NULL` : `${dialect.quote(column)} = ${params.add(value)}`;
	}).join(' AND ');
}

function toInt(value, fallback, max) {
	const n = Number.parseInt(value, 10);
	return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : fallback;
}

export function buildSelect(dialect, { ref, where, orderBy, limit, offset }) {
	let sql = `SELECT * FROM ${ref}` + whereClause(dialect, where);
	const order = clause(orderBy, dialect.name, 'ORDER BY');
	if (order) sql += ` ORDER BY ${order}`;
	sql += ` LIMIT ${toInt(limit, 50, 1000)} OFFSET ${toInt(offset, 0, Number.MAX_SAFE_INTEGER)}`;
	return { sql, params: [] };
}

export function buildCount(dialect, { ref, where }) {
	return { sql: `SELECT COUNT(*) AS count FROM ${ref}` + whereClause(dialect, where), params: [] };
}

export function buildInsert(dialect, { ref, columns, values }) {
	const params = new Params(dialect);
	const names = Object.keys(values ?? {});
	if (!names.length) return { sql: `INSERT INTO ${ref}` + dialect.emptyInsert, params: [] };
	names.forEach((name) => checkColumn(columns, name));
	const placeholders = names.map((name) => params.add(values[name]));
	const sql = `INSERT INTO ${ref} (${names.map(dialect.quote).join(', ')}) VALUES (${placeholders.join(', ')})`;
	return { sql, params: params.values };
}

export function buildUpdate(dialect, { ref, columns, key, values }) {
	const params = new Params(dialect);
	const names = Object.keys(values ?? {});
	if (!names.length) throw new UserError('Nothing to update.');
	const sets = names.map((name) => {
		checkColumn(columns, name);
		return `${dialect.quote(name)} = ${params.add(values[name])}`;
	});
	const sql = `UPDATE ${ref} SET ${sets.join(', ')}` + whereKey(dialect, params, key, columns);
	return { sql, params: params.values };
}

export function buildDelete(dialect, { ref, columns, key }) {
	const params = new Params(dialect);
	const sql = `DELETE FROM ${ref}` + whereKey(dialect, params, key, columns);
	return { sql, params: params.values };
}

/**
 * Split a script into statements on top-level semicolons, skipping over
 * quoted strings, identifiers, comments and PostgreSQL dollar-quoted bodies.
 */
export function splitSql(script, dialectName) {
	const statements = [];
	let start = 0;
	let i = 0;
	const n = script.length;
	const push = (end) => {
		const statement = script.slice(start, end).trim();
		if (statement) statements.push(statement);
	};
	while (i < n) {
		const ch = script[i];
		const next = script[i + 1];
		if (ch === "'" || ch === '"' || (ch === '`' && dialectName === 'mysql')) {
			i++;
			while (i < n) {
				if (script[i] === '\\' && dialectName === 'mysql') i += 2;
				else if (script[i] === ch && script[i + 1] === ch) i += 2;
				else if (script[i] === ch) break;
				else i++;
			}
			i++;
		} else if ((ch === '-' && next === '-') || (ch === '#' && dialectName === 'mysql')) {
			while (i < n && script[i] !== '\n') i++;
		} else if (ch === '/' && next === '*') {
			const end = script.indexOf('*/', i + 2);
			i = end < 0 ? n : end + 2;
		} else if (ch === '$' && dialectName === 'postgres') {
			const tag = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(script.slice(i));
			if (tag) {
				const end = script.indexOf(tag[0], i + tag[0].length);
				i = end < 0 ? n : end + tag[0].length;
			} else i++;
		} else if (ch === ';') {
			push(i);
			start = ++i;
		} else i++;
	}
	push(n);
	return statements;
}

/** The allowed values of a MySQL `enum('a','b')` column type, or null for other types. */
export function parseEnumValues(columnType) {
	const match = /^enum\((.*)\)$/is.exec(String(columnType ?? ''));
	if (!match) return null;
	return [...match[1].matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replaceAll("''", "'"));
}

/** Make driver values JSON-safe and readable in the grid. */
export function normalizeValue(value) {
	if (value === null || value === undefined) return null;
	if (typeof value === 'bigint') return value.toString();
	if (value instanceof Uint8Array) return '0x' + Buffer.from(value).toString('hex');
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'object') return JSON.stringify(value);
	return value;
}
