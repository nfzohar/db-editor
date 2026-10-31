import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseConnectionUri } from '../src/connectionUri.js';

describe('parseConnectionUri', () => {
	test('reads a PostgreSQL service URI', () => {
		assert.deepEqual(parseConnectionUri(' postgres://avnadmin:s3cr%40t@pg-example.aivencloud.com:15132/defaultdb?sslmode=require '), {
			driver: 'postgres', host: 'pg-example.aivencloud.com', port: '15132', user: 'avnadmin', password: 's3cr@t',
			database: 'defaultdb', ssl: 'require', masked: false,
		});
		assert.equal(parseConnectionUri('postgresql://u@db.example.com/app').driver, 'postgres');
	});

	test('leaves out the user and password when the console hides them', () => {
		const fields = parseConnectionUri('postgres://CLICK_TO:REVEAL_PASSWORD@pg-example.aivencloud.com:15132/defaultdb?sslmode=require');
		assert.equal(fields.masked, true);
		assert.equal(fields.user, '');
		assert.equal(fields.password, '');
		assert.equal(fields.host, 'pg-example.aivencloud.com');
	});

	test('maps SSL modes of both systems', () => {
		const ssl = (query, scheme = 'postgres') => parseConnectionUri(`${scheme}://u@h/db?${query}`).ssl;
		assert.equal(ssl('sslmode=disable'), '');
		assert.equal(ssl('sslmode=prefer'), '');
		assert.equal(ssl('sslmode=verify-full'), 'verify');
		assert.equal(ssl('ssl-mode=REQUIRED', 'mysql'), 'require');
		assert.equal(ssl('ssl-mode=VERIFY_IDENTITY', 'mysql'), 'verify');
		assert.equal(ssl('ssl=true', 'mysql'), 'require');
		assert.equal(ssl(''), '');
		assert.throws(() => ssl('sslmode=maybe'), /Unknown SSL mode in the URL: maybe/);
	});

	test('reads MySQL and MariaDB URIs, with optional port and database', () => {
		assert.deepEqual(parseConnectionUri('mariadb://root@[::1]'), {
			driver: 'mysql', host: '::1', port: '', user: 'root', password: '', database: '', ssl: '', masked: false,
		});
		assert.equal(parseConnectionUri('mysql://u:p@localhost:3307/shop').port, '3307');
	});

	test('reads SQLite file paths', () => {
		assert.deepEqual(parseConnectionUri('sqlite:///home/ana/My%20Data/shop.db'), { driver: 'sqlite', file: '/home/ana/My Data/shop.db' });
		assert.equal(parseConnectionUri('sqlite://data/shop.db').file, 'data/shop.db');
		assert.equal(parseConnectionUri('sqlite:///C:/data/shop.db').file, 'C:/data/shop.db');
		assert.throws(() => parseConnectionUri('sqlite://'), /no database file path/);
	});

	test('rejects other schemes and text that is not a URI', () => {
		assert.throws(() => parseConnectionUri('mongodb://h/db'), /postgres:\/\/, mysql:\/\/ or sqlite:\/\//);
		assert.throws(() => parseConnectionUri('localhost'), /postgres:\/\//);
		assert.throws(() => parseConnectionUri('postgres://h:99999/db'), /could not be read/);
	});
});
