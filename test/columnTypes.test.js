import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { columnKind, fromEditor, toEditor } from '../src/columnTypes.js';

const kindOf = (type, driver = 'postgres', extra = {}) => columnKind({ type, ...extra }, driver);

describe('columnKind', () => {
	test('recognises type names from each database', () => {
		const cases = [
			['integer', 'postgres', 'integer'], ['bigint', 'postgres', 'integer'], ['int(10) unsigned', 'mysql', 'integer'], ['INTEGER', 'sqlite', 'integer'],
			['numeric(10,2)', 'postgres', 'decimal'], ['double precision', 'postgres', 'decimal'], ['REAL', 'sqlite', 'decimal'],
			['boolean', 'postgres', 'boolean'], ['tinyint(1)', 'mysql', 'boolean'], ['tinyint(4)', 'mysql', 'integer'],
			['date', 'mysql', 'date'], ['datetime', 'mysql', 'datetime'], ['timestamp without time zone', 'postgres', 'datetime'],
			['timestamp with time zone', 'postgres', 'string'], ['time', 'mysql', 'time'],
			['jsonb', 'postgres', 'json'], ['uuid', 'postgres', 'uuid'], ['bytea', 'postgres', 'binary'], ['BLOB', 'sqlite', 'binary'],
			['longtext', 'mysql', 'text'], ['text', 'postgres', 'string'], ['character varying(255)', 'postgres', 'string'],
		];
		for (const [type, driver, kind] of cases) assert.equal(kindOf(type, driver).kind, kind, `${driver} ${type}`);
	});

	test('enums use the listed values; strings know their length limit', () => {
		assert.deepEqual(kindOf("enum('a','b')", 'mysql', { enumValues: ['a', 'b'] }).options, ['a', 'b']);
		assert.equal(kindOf('varchar(20)', 'mysql').maxLength, 20);
		assert.equal(kindOf('int unsigned', 'mysql').unsigned, true);
		assert.equal(kindOf('integer').numeric, true);
	});
});

describe('toEditor', () => {
	test('picks native pickers and dropdowns', () => {
		assert.deepEqual(toEditor(kindOf('boolean'), true), { input: 'select', options: ['true', 'false'], text: 'true' });
		assert.equal(toEditor(kindOf('tinyint(1)', 'mysql'), 0).text, 'false');
		assert.deepEqual(toEditor(kindOf('datetime', 'mysql'), '2026-01-10 10:20:30'), { input: 'datetime-local', text: '2026-01-10T10:20:30' });
		assert.equal(toEditor(kindOf('date'), null).input, 'date');
		assert.equal(toEditor(kindOf('jsonb'), '{}').input, 'textarea');
	});

	test('falls back to text for values the pickers cannot show', () => {
		assert.equal(toEditor(kindOf('date', 'mysql'), '0000-00-00 junk').input, 'text');
		assert.equal(toEditor(kindOf('tinyint(1)', 'mysql'), 5).input, 'text');
		assert.equal(toEditor(kindOf('text'), 'x'.repeat(100)).input, 'textarea');
	});
});

describe('fromEditor', () => {
	test('converts to the driver form', () => {
		assert.deepEqual(fromEditor(kindOf('boolean'), 'false', true, 'postgres'), { value: false });
		assert.deepEqual(fromEditor(kindOf('tinyint(1)', 'mysql'), 'true', 0, 'mysql'), { value: 1 });
		assert.deepEqual(fromEditor(kindOf('integer'), ' 42 ', 1, 'postgres'), { value: 42 });
		assert.deepEqual(fromEditor(kindOf('bigint'), '9007199254740993', '1', 'postgres'), { value: '9007199254740993' });
		assert.deepEqual(fromEditor(kindOf('numeric(10,2)'), '1.50', '1.00', 'postgres'), { value: '1.50' });
		assert.deepEqual(fromEditor(kindOf('real'), '1.5', 1, 'postgres'), { value: 1.5 });
		assert.deepEqual(fromEditor(kindOf('datetime', 'mysql'), '2026-01-10T10:20', null, 'mysql'), { value: '2026-01-10 10:20:00' });
		assert.deepEqual(fromEditor(kindOf('time'), '08:15', null, 'postgres'), { value: '08:15:00' });
		assert.deepEqual(fromEditor(kindOf('uuid'), '123E4567-E89B-12D3-A456-426614174000', null, 'postgres'), { value: '123e4567-e89b-12d3-a456-426614174000' });
	});

	test('rejects values that do not fit the type', () => {
		const bad = [
			[kindOf('integer'), '1.5'], [kindOf('integer'), ''], [kindOf('int unsigned', 'mysql'), '-1'], [kindOf('numeric'), 'abc'],
			[kindOf('date'), ''], [kindOf('jsonb'), '{oops'], [kindOf('uuid'), 'nope'], [kindOf('varchar(3)', 'mysql'), 'abcd'],
		];
		for (const [kind, text] of bad) assert.ok(fromEditor(kind, text, null, 'postgres').error, `${kind.kind} ${JSON.stringify(text)}`);
	});
});
