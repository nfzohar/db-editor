import pg from 'pg';
import { tableRef, UserError } from '../sql.js';
import { BaseDriver, groupColumns, groupForeignKeys, groupIndexes, normalizeRows, sslOptions } from './base.js';

// Keep dates and times as the server's text instead of converting through JS Date (time zone shifts).
for (const oid of [1082, 1083, 1114, 1184, 1266]) pg.types.setTypeParser(oid, (value) => value);

const FK_ACTIONS = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };

const RELATION_OID = `(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2)`;

export class PostgresDriver extends BaseDriver {
	static async connect({ host, port, user, password, database, ssl }) {
		const config = {
			host: host || 'localhost',
			port: Number(port) || 5432,
			user,
			password,
			ssl: sslOptions(ssl),
			connectionTimeoutMillis: 10000,
			max: 3,
		};
		const driver = new PostgresDriver(config, database || 'postgres');
		try {
			const { rows } = await driver.pool(driver.defaultDb).query('SELECT version() AS version');
			driver.version = rows[0].version;
			return driver;
		} catch (error) {
			await driver.close();
			throw new UserError(error.message);
		}
	}

	constructor(config, defaultDb) {
		super('postgres');
		this.config = config;
		this.defaultDb = defaultDb;
		this.pools = new Map();
	}

	/** PostgreSQL connections are bound to one database, so keep a small pool per database. */
	pool(db) {
		const name = db || this.defaultDb;
		if (!this.pools.has(name)) {
			const pool = new pg.Pool({ ...this.config, database: name });
			pool.on('error', () => {}); // idle client errors must not crash the server
			this.pools.set(name, pool);
		}
		return this.pools.get(name);
	}

	label() {
		return `${this.config.user || ''}@${this.config.host}`;
	}

	async serverInfo() {
		return { version: this.version.replace(/ on .*/, '') };
	}

	ref(db, table, schema) {
		return tableRef(this.dialect, table, schema || 'public');
	}

	async listDatabases() {
		const { rows } = await this.pool().query('SELECT datname AS name FROM pg_database WHERE NOT datistemplate AND datallowconn ORDER BY datname');
		return rows.map((r) => ({ name: r.name, system: false }));
	}

	async listTables(db) {
		const { rows } = await this.pool(db).query(
			`SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind, c.reltuples::bigint AS row_estimate,
				pg_total_relation_size(c.oid) AS size, obj_description(c.oid, 'pg_class') AS comment
			FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
				AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_toast%'
			ORDER BY n.nspname <> 'public', n.nspname, c.relname`);
		return rows.map((r) => ({
			name: r.name,
			schema: r.schema,
			type: ['v', 'm'].includes(r.kind) ? 'view' : 'table',
			rows: r.row_estimate === null || Number(r.row_estimate) < 0 ? null : Number(r.row_estimate),
			rowsApproximate: true,
			size: r.size === null ? null : Number(r.size),
			comment: r.comment ?? '',
		}));
	}

	async listColumns(db) {
		const { rows } = await this.pool(db).query(
			`SELECT n.nspname AS schema, c.relname AS tbl, a.attname AS col
			FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND a.attnum > 0 AND NOT a.attisdropped
				AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_toast%'
			ORDER BY n.nspname, c.relname, a.attnum`);
		return groupColumns(rows.map((r) => ({ schema: r.schema, table: r.tbl, column: r.col })));
	}

	async describeTable(db, table, schema) {
		const pool = this.pool(db);
		const args = [schema || 'public', table];
		const columns = await pool.query(
			`SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable,
				pg_get_expr(d.adbin, d.adrelid) AS default_value, a.attidentity <> '' AS is_identity,
				col_description(a.attrelid, a.attnum) AS comment,
				(SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = a.atttypid) AS enum_values
			FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
			WHERE a.attrelid = ${RELATION_OID} AND a.attnum > 0 AND NOT a.attisdropped
			ORDER BY a.attnum`, args);
		const indexes = await pool.query(
			`SELECT i.relname AS name, a.attname AS col, ix.indisunique AS is_unique, ix.indisprimary AS is_primary
			FROM pg_index ix
			JOIN pg_class i ON i.oid = ix.indexrelid
			CROSS JOIN LATERAL unnest(ix.indkey::smallint[]) WITH ORDINALITY AS k(attnum, ord)
			JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
			WHERE ix.indrelid = ${RELATION_OID}
			ORDER BY ix.indisprimary DESC, i.relname, k.ord`, args);
		const foreignKeys = await pool.query(
			`SELECT con.conname AS name, a.attname AS col, fn.nspname AS ref_schema, fc.relname AS ref_table,
				fa.attname AS ref_column, con.confdeltype AS on_delete, con.confupdtype AS on_update
			FROM pg_constraint con
			CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(attnum, ref_attnum, ord)
			JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
			JOIN pg_class fc ON fc.oid = con.confrelid
			JOIN pg_namespace fn ON fn.oid = fc.relnamespace
			JOIN pg_attribute fa ON fa.attrelid = con.confrelid AND fa.attnum = k.ref_attnum
			WHERE con.contype = 'f' AND con.conrelid = ${RELATION_OID}
			ORDER BY con.conname, k.ord`, args);
		const primary = new Set(indexes.rows.filter((i) => i.is_primary).map((i) => i.col));
		return {
			columns: columns.rows.map((c) => ({
				name: c.name,
				type: c.type,
				enumValues: c.enum_values,
				nullable: c.nullable,
				default: c.default_value,
				primaryKey: primary.has(c.name),
				autoIncrement: c.is_identity || /^nextval\(/.test(c.default_value ?? ''),
				comment: c.comment ?? '',
			})),
			indexes: groupIndexes(indexes.rows.map((i) => ({ name: i.name, column: i.col, unique: i.is_unique, primary: i.is_primary }))),
			foreignKeys: groupForeignKeys(foreignKeys.rows.map((f) => ({
				name: f.name, column: f.col, refSchema: f.ref_schema, refTable: f.ref_table, refColumn: f.ref_column,
				onDelete: FK_ACTIONS[f.on_delete], onUpdate: FK_ACTIONS[f.on_update],
			}))),
		};
	}

	async query(db, sql, params = []) {
		const result = await this.pool(db).query({ text: sql, values: params, rowMode: 'array' });
		return { columns: result.fields.map((f) => f.name), rows: normalizeRows(result.rows) };
	}

	async exec(db, sql, params = []) {
		const result = await this.pool(db).query(sql, params);
		return { affected: result.rowCount ?? 0, insertId: null };
	}

	async withConnection(db, fn) {
		const client = await this.pool(db).connect();
		try {
			return await fn(client);
		} finally {
			client.release();
		}
	}

	async runStatement(db, sql, client) {
		const result = await client.query({ text: sql, rowMode: 'array' });
		const last = Array.isArray(result) ? result.at(-1) : result;
		if (last.fields?.length) return { columns: last.fields.map((f) => f.name), rows: normalizeRows(last.rows) };
		return { affected: last.rowCount ?? 0 };
	}

	async close() {
		await Promise.all([...this.pools.values()].map((pool) => pool.end().catch(() => {})));
		this.pools.clear();
	}
}
