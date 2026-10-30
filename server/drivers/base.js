import { buildCount, buildDelete, buildInsert, buildSelect, buildUpdate, dialects, normalizeValue, splitSql, UserError } from '../sql.js';

/**
 * Common driver behaviour. Subclasses implement:
 *   serverInfo(), listDatabases(), listTables(db), listColumns(db), describeTable(db, table, schema),
 *   ref(db, table, schema), query(db, sql, params) -> {columns, rows},
 *   exec(db, sql, params) -> {affected, insertId}, runStatement(db, sql, conn), close()
 * and optionally withConnection(db, fn) for running a script on one connection.
 */
export class BaseDriver {
	constructor(dialectName) {
		this.dialectName = dialectName;
		this.dialect = dialects[dialectName];
	}

	async columnsOf(db, table, schema) {
		const { columns } = await this.describeTable(db, table, schema);
		if (!columns.length) throw new UserError(`Table not found: ${table}`);
		return columns;
	}

	async selectRows(db, table, { schema, where, orderBy, limit, offset } = {}) {
		await this.columnsOf(db, table, schema); // a clear "Table not found" instead of an SQL error
		const ref = this.ref(db, table, schema);
		const select = buildSelect(this.dialect, { ref, where, orderBy, limit, offset });
		const count = buildCount(this.dialect, { ref, where });
		const started = performance.now();
		const result = await this.query(db, select.sql, select.params);
		const time = performance.now() - started;
		const total = await this.query(db, count.sql, count.params);
		return { ...result, total: Number(total.rows[0][0]), sql: select.sql, time };
	}

	async insertRow(db, table, { schema, values }) {
		const columns = (await this.columnsOf(db, table, schema)).map((c) => c.name);
		const { sql, params } = buildInsert(this.dialect, { ref: this.ref(db, table, schema), columns, values });
		return { ...(await this.exec(db, sql, params)), sql };
	}

	async updateRow(db, table, { schema, key, values }) {
		const columns = (await this.columnsOf(db, table, schema)).map((c) => c.name);
		const { sql, params } = buildUpdate(this.dialect, { ref: this.ref(db, table, schema), columns, key, values });
		const result = await this.exec(db, sql, params);
		if (!result.affected) throw new UserError('No row was updated; it may have been changed or deleted.');
		return { ...result, sql };
	}

	async deleteRow(db, table, { schema, key }) {
		const columns = (await this.columnsOf(db, table, schema)).map((c) => c.name);
		const { sql, params } = buildDelete(this.dialect, { ref: this.ref(db, table, schema), columns, key });
		return { ...(await this.exec(db, sql, params)), sql };
	}

	/** Run a user script statement by statement, stopping at the first error. */
	async runSql(db, script) {
		const statements = splitSql(String(script ?? ''), this.dialectName);
		if (!statements.length) throw new UserError('Enter an SQL statement.');
		const results = [];
		await this.withConnection(db, async (conn) => {
			for (const sql of statements) {
				const started = performance.now();
				try {
					const result = await this.runStatement(db, sql, conn);
					results.push({ sql, ...result, time: performance.now() - started });
				} catch (error) {
					results.push({ sql, error: error.message, time: performance.now() - started });
					break;
				}
			}
		});
		return results;
	}

	async withConnection(db, fn) {
		return fn(null);
	}
}

/** Rows of { schema, table, column } in table order → [{ schema, table, columns: [names] }]. */
export function groupColumns(rows) {
	const tables = new Map();
	for (const { schema = null, table, column } of rows) {
		const key = JSON.stringify([schema, table]);
		if (!tables.has(key)) tables.set(key, { schema, table, columns: [] });
		tables.get(key).columns.push(column);
	}
	return [...tables.values()];
}

export function normalizeRows(rows) {
	return rows.map((row) => row.map(normalizeValue));
}

/** Group index rows ({name, column, unique, primary}) into one entry per index. */
export function groupIndexes(rows) {
	const byName = new Map();
	for (const row of rows) {
		if (!byName.has(row.name)) byName.set(row.name, { name: row.name, columns: [], unique: !!row.unique, primary: !!row.primary });
		byName.get(row.name).columns.push(row.column);
	}
	return [...byName.values()];
}

/** Group foreign key rows ({name, column, refTable, refColumn, ...}) into one entry per constraint. */
export function groupForeignKeys(rows) {
	const byName = new Map();
	for (const row of rows) {
		if (!byName.has(row.name)) {
			byName.set(row.name, { name: row.name, columns: [], refSchema: row.refSchema ?? null, refTable: row.refTable, refColumns: [], onDelete: row.onDelete, onUpdate: row.onUpdate });
		}
		const fk = byName.get(row.name);
		fk.columns.push(row.column);
		fk.refColumns.push(row.refColumn);
	}
	return [...byName.values()];
}

/**
 * TLS options for the mysql2 / pg drivers from the login form's SSL mode:
 * '' = no encryption, 'require' = encrypt without checking the certificate, 'verify' = encrypt and verify it.
 */
export function sslOptions(mode) {
	if (!mode) return undefined;
	if (mode === 'require') return { rejectUnauthorized: false };
	if (mode === 'verify') return { rejectUnauthorized: true };
	throw new UserError(`Unknown SSL mode: ${mode}`);
}
