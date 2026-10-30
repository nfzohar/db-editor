import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TEMPLATES } from '../src/sqlTemplates.js';

const build = (id, driver, columns, schema = null) => TEMPLATES.find((t) => t.id === id).build(driver, 'users', schema, columns);

const columns = [
	{ name: 'id', primaryKey: true, autoIncrement: true },
	{ name: 'name' },
	{ name: "it's" },
];

describe('SQL templates', () => {
	test('INSERT skips auto-increment columns and quotes per driver', () => {
		assert.equal(build('insert', 'mysql', columns), "INSERT INTO `users` (`name`, `it's`)\nVALUES ('[name]', '[it''s]');");
		assert.equal(build('insert', 'postgres', columns, 'app'), `INSERT INTO "app"."users" ("name", "it's")\nVALUES ('[name]', '[it''s]');`);
	});

	test('INSERT with only generated columns uses the default-row form', () => {
		assert.equal(build('insert', 'mysql', columns.slice(0, 1)), 'INSERT INTO `users` () VALUES ();');
		assert.equal(build('insert', 'sqlite', columns.slice(0, 1)), 'INSERT INTO "users" DEFAULT VALUES;');
	});

	test('UPDATE sets non-key columns and matches the primary key', () => {
		assert.equal(build('update', 'sqlite', columns), `UPDATE "users"\nSET "name" = '[name]',\n    "it's" = '[it''s]'\nWHERE "id" = '[id]';`);
	});

	test('UPDATE and DELETE without a primary key need a condition filled in', () => {
		const plain = [{ name: 'a' }, { name: 'b' }];
		assert.match(build('update', 'sqlite', plain), /\nWHERE <condition>;$/);
		assert.equal(build('delete', 'sqlite', plain), 'DELETE FROM "users"\nWHERE <condition>;');
	});

	test('SELECT lists columns; PostgreSQL public schema is left implied', () => {
		assert.equal(build('select', 'postgres', columns, 'public'), `SELECT "id", "name", "it's"\nFROM "users"\nWHERE <condition>\nLIMIT 100;`);
		assert.equal(build('select-all', 'mysql', columns), 'SELECT * FROM `users` LIMIT 100;');
	});
});
