import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildDelete, buildInsert, buildSelect, buildUpdate, clause, dialects, normalizeValue, parseEnumValues, splitSql, tableRef, UserError } from '../server/sql.js';

const columns = ['id', 'name', 'weird`"col'];

describe('identifier quoting', () => {
	test('escapes quote characters per dialect', () => {
		assert.equal(dialects.mysql.quote('a`b'), '`a``b`');
		assert.equal(dialects.postgres.quote('a"b'), '"a""b"');
		assert.equal(tableRef(dialects.mysql, 't', 'db'), '`db`.`t`');
		assert.equal(tableRef(dialects.sqlite, 't', null), '"t"');
	});
});

describe('buildSelect', () => {
	test('adds the WHERE and ORDER BY text with paging', () => {
		const { sql, params } = buildSelect(dialects.mysql, {
			ref: '`shop`.`users`', where: " name LIKE '%an%' AND id IS NOT NULL ", orderBy: '`id` DESC', limit: 25, offset: 50,
		});
		assert.equal(sql, "SELECT * FROM `shop`.`users` WHERE name LIKE '%an%' AND id IS NOT NULL ORDER BY `id` DESC LIMIT 25 OFFSET 50");
		assert.deepEqual(params, []);
	});

	test('leaves out empty clauses', () => {
		assert.equal(buildSelect(dialects.postgres, { ref: '"t"', where: '  ', orderBy: '' }).sql, 'SELECT * FROM "t" LIMIT 50 OFFSET 0');
	});

	test('clamps limit and rejects junk paging values', () => {
		assert.match(buildSelect(dialects.sqlite, { ref: '"t"', limit: 99999, offset: -5 }).sql, /LIMIT 1000 OFFSET 0$/);
		assert.match(buildSelect(dialects.sqlite, { ref: '"t"', limit: '1; DROP TABLE t' }).sql, /LIMIT 1 OFFSET 0$/);
	});
});

describe('clause', () => {
	test('allows quotes, parentheses and dialect strings containing special characters', () => {
		assert.equal(clause("(a = 'x;y' OR b = 'it''s') AND c <> '--'", 'sqlite', 'WHERE'), "(a = 'x;y' OR b = 'it''s') AND c <> '--'");
		assert.equal(clause("a = 'x\\';' AND `b;` = 1", 'mysql', 'WHERE'), "a = 'x\\';' AND `b;` = 1");
		assert.equal(clause('body = $tag$a;b$tag$', 'postgres', 'WHERE'), 'body = $tag$a;b$tag$');
	});

	test('rejects anything that could end the clause early', () => {
		for (const [text, dialect] of [
			['1=1; DROP TABLE t', 'sqlite'],
			['id DESC -- ', 'sqlite'],
			['id /* ', 'postgres'],
			['id # ', 'mysql'],
			["a = 'open", 'sqlite'],
			['a = $x$open', 'postgres'],
			['(a = 1', 'sqlite'],
			['a = 1) OR (1', 'sqlite'],
		]) {
			assert.throws(() => clause(text, dialect, 'WHERE'), UserError, text);
		}
	});
});

describe('row writes', () => {
	test('insert quotes columns and binds values', () => {
		const { sql, params } = buildInsert(dialects.postgres, { ref: '"public"."t"', columns, values: { name: 'Ana', 'weird`"col': null } });
		assert.equal(sql, 'INSERT INTO "public"."t" ("name", "weird`""col") VALUES ($1, $2)');
		assert.deepEqual(params, ['Ana', null]);
	});

	test('insert with no values uses the dialect default-row form', () => {
		assert.equal(buildInsert(dialects.mysql, { ref: '`t`', columns, values: {} }).sql, 'INSERT INTO `t` () VALUES ()');
		assert.equal(buildInsert(dialects.postgres, { ref: '"t"', columns, values: {} }).sql, 'INSERT INTO "t" DEFAULT VALUES');
	});

	test('update matches the key, using IS NULL for null key parts', () => {
		const { sql, params } = buildUpdate(dialects.postgres, { ref: '"t"', columns, key: { id: 7, name: null }, values: { name: 'x' } });
		assert.equal(sql, 'UPDATE "t" SET "name" = $1 WHERE "id" = $2 AND "name" IS NULL');
		assert.deepEqual(params, ['x', 7]);
	});

	test('delete requires a key', () => {
		assert.throws(() => buildDelete(dialects.mysql, { ref: '`t`', columns, key: {} }), UserError);
		assert.equal(buildDelete(dialects.mysql, { ref: '`t`', columns, key: { id: 1 } }).sql, 'DELETE FROM `t` WHERE `id` = ?');
	});
});

describe('splitSql', () => {
	test('splits on top-level semicolons only', () => {
		assert.deepEqual(splitSql("SELECT 'a;b'; SELECT \"c;d\" -- e;f\n; /* g;h */ SELECT 1;", 'sqlite'), [
			"SELECT 'a;b'",
			'SELECT "c;d" -- e;f',
			'/* g;h */ SELECT 1',
		]);
	});

	test('handles doubled quotes and mysql backslash escapes', () => {
		assert.deepEqual(splitSql("SELECT 'it''s;'; SELECT 'x\\';y'", 'mysql'), ["SELECT 'it''s;'", "SELECT 'x\\';y'"]);
		assert.deepEqual(splitSql('SELECT `a;b` FROM t # c;d\n; SELECT 2', 'mysql'), ['SELECT `a;b` FROM t # c;d', 'SELECT 2']);
	});

	test('keeps postgres dollar-quoted bodies together', () => {
		const fn = 'CREATE FUNCTION f() RETURNS int AS $body$ BEGIN RETURN 1; END; $body$ LANGUAGE plpgsql';
		assert.deepEqual(splitSql(`${fn}; SELECT $$a;b$$`, 'postgres'), [fn, 'SELECT $$a;b$$']);
	});
});

test('normalizeValue makes values JSON-safe', () => {
	assert.equal(normalizeValue(12n), '12');
	assert.equal(normalizeValue(new Uint8Array([1, 255])), '0x01ff');
	assert.equal(normalizeValue({ a: 1 }), '{"a":1}');
	assert.equal(normalizeValue(undefined), null);
});

describe('parseEnumValues', () => {
	test('reads MySQL enum column types', () => {
		assert.deepEqual(parseEnumValues("enum('small','it''s','')"), ['small', "it's", '']);
		assert.equal(parseEnumValues('varchar(10)'), null);
	});
});
