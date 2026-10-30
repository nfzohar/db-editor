import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { tableRef, UserError } from '../sql.js';
import { BaseDriver, groupColumns, groupForeignKeys, groupIndexes, normalizeRows } from './base.js';

const FK_ACTIONS = new Set(['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT']);

/** node:sqlite ships with Node.js 22.13+; it is loaded lazily so older Node can still run the other drivers. */
let sqliteModule;
export async function sqliteAvailable() {
	try {
		sqliteModule ??= await import('node:sqlite');
		return true;
	} catch {
		return false;
	}
}

export class SqliteDriver extends BaseDriver {
	static async connect({ file }) {
		if (!(await sqliteAvailable())) throw new UserError('SQLite needs Node.js 22.13 or newer.');
		if (!file) throw new UserError('Enter the path to a SQLite database file.');
		if (!existsSync(file)) throw new UserError(`File not found: ${file}`);
		return new SqliteDriver(new sqliteModule.DatabaseSync(file), file);
	}

	constructor(db, file) {
		super('sqlite');
		this.db = db;
		this.file = file;
		this.db.exec('PRAGMA foreign_keys = ON');
	}

	label() {
		return basename(this.file);
	}

	async serverInfo() {
		return { version: 'SQLite ' + this.db.prepare('SELECT sqlite_version() AS v').get().v, file: this.file };
	}

	async listDatabases() {
		return this.db.prepare('SELECT name FROM pragma_database_list WHERE name <> \'temp\' ORDER BY seq').all().map((r) => ({ name: r.name }));
	}

	ref(db, table) {
		return tableRef(this.dialect, table, db && db !== 'main' ? db : null);
	}

	schemaTable(db) {
		return (db && db !== 'main' ? this.dialect.quote(db) + '.' : '') + 'sqlite_master';
	}

	async listTables(db) {
		const rows = this.db.prepare(`SELECT name, type FROM ${this.schemaTable(db)} WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name`).all();
		return rows.map((r) => {
			let rowCount = null;
			if (r.type === 'table') rowCount = this.db.prepare(`SELECT COUNT(*) AS c FROM ${this.ref(db, r.name)}`).get().c;
			return { name: r.name, schema: null, type: r.type, rows: rowCount, size: null, comment: '' };
		});
	}

	async listColumns(db) {
		const rows = this.db.prepare(
			`SELECT m.name AS tbl, p.name AS col FROM ${this.schemaTable(db)} m JOIN pragma_table_info(m.name, ?) p
			WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, p.cid`).all(db || 'main');
		return groupColumns(rows.map((r) => ({ table: r.tbl, column: r.col })));
	}

	async describeTable(db, table) {
		const schema = db && db !== 'main' ? db : 'main';
		const columns = this.db.prepare('SELECT * FROM pragma_table_info(?, ?) ORDER BY cid').all(table, schema);
		const primaryCount = columns.filter((c) => c.pk).length;
		const indexRows = [];
		for (const index of this.db.prepare('SELECT * FROM pragma_index_list(?, ?)').all(table, schema)) {
			for (const col of this.db.prepare('SELECT name FROM pragma_index_info(?, ?) ORDER BY seqno').all(index.name, schema)) {
				indexRows.push({ name: index.name, column: col.name, unique: index.unique, primary: index.origin === 'pk' });
			}
		}
		// An INTEGER PRIMARY KEY is the rowid and has no index of its own.
		if (primaryCount && !indexRows.some((r) => r.primary)) {
			for (const c of columns.filter((c) => c.pk).sort((a, b) => a.pk - b.pk)) indexRows.unshift({ name: 'PRIMARY', column: c.name, unique: 1, primary: 1 });
		}
		const fkRows = this.db.prepare('SELECT * FROM pragma_foreign_key_list(?, ?) ORDER BY id, seq').all(table, schema).map((fk) => ({
			name: `fk_${fk.id}`, column: fk.from, refTable: fk.table, refColumn: fk.to,
			onDelete: FK_ACTIONS.has(fk.on_delete) ? fk.on_delete : 'NO ACTION',
			onUpdate: FK_ACTIONS.has(fk.on_update) ? fk.on_update : 'NO ACTION',
		}));
		return {
			columns: columns.map((c) => ({
				name: c.name,
				type: c.type || 'ANY',
				enumValues: null,
				nullable: !c.notnull && !c.pk,
				default: c.dflt_value,
				primaryKey: !!c.pk,
				autoIncrement: primaryCount === 1 && !!c.pk && /^integer$/i.test(c.type),
				comment: '',
			})),
			indexes: groupIndexes(indexRows),
			foreignKeys: groupForeignKeys(fkRows),
		};
	}

	prepare(sql) {
		const statement = this.db.prepare(sql);
		statement.setReturnArrays(true);
		return statement;
	}

	async query(db, sql, params = []) {
		const statement = this.prepare(sql);
		return { columns: statement.columns().map((c) => c.name), rows: normalizeRows(statement.all(...params)) };
	}

	async exec(db, sql, params = []) {
		const result = this.db.prepare(sql).run(...params);
		return { affected: Number(result.changes), insertId: Number(result.lastInsertRowid) || null };
	}

	async runStatement(db, sql) {
		const statement = this.prepare(sql);
		if (statement.columns().length) {
			return { columns: statement.columns().map((c) => c.name), rows: normalizeRows(statement.all()) };
		}
		const result = statement.run();
		return { affected: Number(result.changes) };
	}

	async close() {
		this.db.close();
	}
}
