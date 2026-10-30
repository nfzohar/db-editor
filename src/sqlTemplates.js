import { qualifiedName, quoteIdent } from './format.js';

// Statement templates for the SQL tab, like phpMyAdmin's SELECT / INSERT / UPDATE / DELETE buttons.
// Values are '[column]' placeholders to overwrite; UPDATE and DELETE without a primary key get a
// `<condition>` placeholder, which is deliberately invalid so the template can't change every row.

const INDENT = '    ';

function parts(driver, table, schema, columns) {
	return {
		ref: qualifiedName(driver, table, schema),
		q: (name) => quoteIdent(driver, name),
		value: (name) => `'[${name.replaceAll("'", "''")}]'`,
		keys: columns.filter((c) => c.primaryKey),
	};
}

function whereKey({ q, value, keys }) {
	return keys.length ? keys.map((c) => `${q(c.name)} = ${value(c.name)}`).join(' AND ') : '<condition>';
}

export const TEMPLATES = [
	{
		id: 'select-all',
		label: 'SELECT *',
		build: (driver, table, schema) => `SELECT * FROM ${qualifiedName(driver, table, schema)} LIMIT 100;`,
	},
	{
		id: 'select',
		label: 'SELECT',
		build(driver, table, schema, columns) {
			const { ref, q } = parts(driver, table, schema, columns);
			return `SELECT ${columns.map((c) => q(c.name)).join(', ')}\nFROM ${ref}\nWHERE <condition>\nLIMIT 100;`;
		},
	},
	{
		id: 'insert',
		label: 'INSERT',
		writes: true,
		build(driver, table, schema, columns) {
			const { ref, q, value } = parts(driver, table, schema, columns);
			const names = columns.filter((c) => !c.autoIncrement).map((c) => c.name);
			if (!names.length) return driver === 'mysql' ? `INSERT INTO ${ref} () VALUES ();` : `INSERT INTO ${ref} DEFAULT VALUES;`;
			return `INSERT INTO ${ref} (${names.map(q).join(', ')})\nVALUES (${names.map(value).join(', ')});`;
		},
	},
	{
		id: 'update',
		label: 'UPDATE',
		writes: true,
		build(driver, table, schema, columns) {
			const p = parts(driver, table, schema, columns);
			const set = columns.filter((c) => !c.primaryKey);
			const assignments = (set.length ? set : columns).map((c) => `${p.q(c.name)} = ${p.value(c.name)}`).join(`,\n${INDENT}`);
			return `UPDATE ${p.ref}\nSET ${assignments}\nWHERE ${whereKey(p)};`;
		},
	},
	{
		id: 'delete',
		label: 'DELETE',
		writes: true,
		build(driver, table, schema, columns) {
			const p = parts(driver, table, schema, columns);
			return `DELETE FROM ${p.ref}\nWHERE ${whereKey(p)};`;
		},
	},
];
