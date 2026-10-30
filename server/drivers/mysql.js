import mysql from 'mysql2/promise';
import { parseEnumValues, tableRef, UserError } from '../sql.js';
import { BaseDriver, groupColumns, groupForeignKeys, groupIndexes, normalizeRows, sslOptions } from './base.js';

const SYSTEM_DATABASES = new Set(['information_schema', 'performance_schema', 'mysql', 'sys']);

/**
 * COLUMN_DEFAULT as SQL, the way PostgreSQL and SQLite report defaults. MySQL lists literals unquoted
 * and expressions without their parentheses; MariaDB already reports SQL (and the text NULL for none).
 */
export function defaultSql(value, extra, mariadb) {
	if (value === null || value === undefined) return null;
	if (mariadb) return value === 'NULL' ? null : value;
	if (/^current_timestamp(\(\d*\))?$/i.test(value) || /^-?\d+(\.\d+)?$/.test(value) || /^b'[01]*'$/.test(value)) return value;
	if (/\bDEFAULT_GENERATED\b/i.test(extra)) return `(${value})`;
	return "'" + value.replaceAll('\\', '\\\\').replaceAll("'", "''") + "'";
}

export class MysqlDriver extends BaseDriver {
	static async connect({ host, port, user, password, database, ssl }) {
		const pool = mysql.createPool({
			host: host || 'localhost',
			port: Number(port) || 3306,
			user,
			password,
			ssl: sslOptions(ssl),
			database: database || undefined,
			charset: 'utf8mb4',
			dateStrings: true,
			supportBigNumbers: true,
			bigNumberStrings: true,
			multipleStatements: false,
			connectionLimit: 4,
			connectTimeout: 10000,
		});
		try {
			const [rows] = await pool.query('SELECT VERSION() AS version');
			return new MysqlDriver(pool, `${user || ''}@${host || 'localhost'}`, rows[0].version);
		} catch (error) {
			await pool.end().catch(() => {});
			throw new UserError(error.message);
		}
	}

	constructor(pool, label, version) {
		super('mysql');
		this.pool = pool;
		this._label = label;
		this.version = version;
	}

	label() {
		return this._label;
	}

	async serverInfo() {
		return { version: (/mariadb/i.test(this.version) ? 'MariaDB ' : 'MySQL ') + this.version };
	}

	ref(db, table) {
		return tableRef(this.dialect, table, db);
	}

	async rows(sql, params) {
		const [rows] = await this.pool.query(sql, params);
		return rows;
	}

	async listDatabases() {
		const rows = await this.rows('SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME');
		return rows.map((r) => ({ name: r.name, system: SYSTEM_DATABASES.has(r.name) }));
	}

	async listTables(db) {
		const rows = await this.rows(
			`SELECT TABLE_NAME AS name, TABLE_TYPE AS table_type, TABLE_ROWS AS row_estimate,
				DATA_LENGTH + INDEX_LENGTH AS size, TABLE_COMMENT AS comment, ENGINE AS engine
			FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`, [db]);
		return rows.map((r) => ({
			name: r.name,
			schema: null,
			type: r.table_type === 'VIEW' ? 'view' : 'table',
			rows: r.row_estimate === null ? null : Number(r.row_estimate),
			rowsApproximate: r.engine === 'InnoDB',
			size: r.size === null ? null : Number(r.size),
			comment: r.table_type === 'VIEW' ? '' : r.comment,
		}));
	}

	async listColumns(db) {
		const rows = await this.rows(
			`SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col FROM information_schema.COLUMNS
			WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`, [db]);
		return groupColumns(rows.map((r) => ({ table: r.tbl, column: r.col })));
	}

	async describeTable(db, table) {
		const columns = await this.rows(
			`SELECT COLUMN_NAME AS name, COLUMN_TYPE AS column_type, IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS default_value,
				COLUMN_KEY AS column_key, EXTRA AS extra, COLUMN_COMMENT AS comment, COLLATION_NAME AS collation_name
			FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`, [db, table]);
		const indexes = await this.rows(
			`SELECT INDEX_NAME AS name, COLUMN_NAME AS col, NON_UNIQUE AS non_unique
			FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
			ORDER BY INDEX_NAME = 'PRIMARY' DESC, INDEX_NAME, SEQ_IN_INDEX`, [db, table]);
		const foreignKeys = await this.rows(
			`SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS col, k.REFERENCED_TABLE_SCHEMA AS ref_schema,
				k.REFERENCED_TABLE_NAME AS ref_table, k.REFERENCED_COLUMN_NAME AS ref_column,
				r.DELETE_RULE AS on_delete, r.UPDATE_RULE AS on_update
			FROM information_schema.KEY_COLUMN_USAGE k
			JOIN information_schema.REFERENTIAL_CONSTRAINTS r
				ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
			WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
			ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`, [db, table]);
		return {
			columns: columns.map((c) => ({
				name: c.name,
				type: c.column_type,
				enumValues: parseEnumValues(c.column_type),
				nullable: c.is_nullable === 'YES',
				default: defaultSql(c.default_value, c.extra, /mariadb/i.test(this.version)),
				primaryKey: c.column_key === 'PRI',
				autoIncrement: /auto_increment/i.test(c.extra),
				comment: c.comment,
				// Kept so the structure form can rewrite a column definition without losing them.
				onUpdate: /\bon update (\S+)/i.exec(c.extra)?.[1] ?? null,
				collation: c.collation_name,
				generated: /\b(VIRTUAL|STORED) GENERATED\b/i.test(c.extra),
			})),
			indexes: groupIndexes(indexes.map((i) => ({ name: i.name, column: i.col, unique: !Number(i.non_unique), primary: i.name === 'PRIMARY' }))),
			foreignKeys: groupForeignKeys(foreignKeys.map((f) => ({
				name: f.name, column: f.col, refSchema: f.ref_schema === db ? null : f.ref_schema, refTable: f.ref_table,
				refColumn: f.ref_column, onDelete: f.on_delete, onUpdate: f.on_update,
			}))),
		};
	}

	async query(db, sql, params = []) {
		const [rows, fields] = await this.pool.query({ sql, values: params, rowsAsArray: true });
		return { columns: fields.map((f) => f.name), rows: normalizeRows(rows) };
	}

	async exec(db, sql, params = []) {
		const [result] = await this.pool.query(sql, params);
		return { affected: result.affectedRows, insertId: result.insertId || null };
	}

	/** Scripts run on one connection so USE and session variables carry across statements. */
	async withConnection(db, fn) {
		const conn = await this.pool.getConnection();
		try {
			if (db) await conn.query('USE ' + this.dialect.quote(db));
			return await fn(conn);
		} finally {
			conn.release();
		}
	}

	async runStatement(db, sql, conn) {
		const [rows, fields] = await conn.query({ sql, rowsAsArray: true });
		if (Array.isArray(rows) && fields) return { columns: fields.map((f) => f.name), rows: normalizeRows(rows) };
		return { affected: rows.affectedRows, insertId: rows.insertId || null };
	}

	async close() {
		await this.pool.end();
	}
}
