import { reactive } from 'vue';
import { api } from './api.js';

export const store = reactive({
	session: null,
	drivers: [],
	databases: [],
	tables: {}, // db name -> table list
	columns: {}, // db name -> { [JSON [schema, table]]: column names }, for the sidebar filter
	notice: null,
	sidebarOpen: false,
});

const NOTICE_SECONDS = 10;
let noticeTimer;
/**
 * Shows a message above the page content. Errors stay, across pages too, until dismissed or
 * replaced by another message. Other messages belong to one page (`hash`, by default the current
 * one): they disappear after NOTICE_SECONDS or on navigating elsewhere.
 */
export function notify(type, text, sql = null, hash = location.hash) {
	clearTimeout(noticeTimer);
	store.notice = { type, text, sql, hash };
	if (type !== 'error') noticeTimer = setTimeout(() => (store.notice = null), NOTICE_SECONDS * 1000);
}

export async function loadDatabases() {
	store.databases = (await api('databases')).databases;
}

export async function loadTables(db, { force = false } = {}) {
	if (!force && store.tables[db]) return store.tables[db];
	const { tables } = await api('tables?db=' + encodeURIComponent(db));
	store.tables[db] = tables;
	if (force) delete store.columns[db]; // tables may have changed; refetch columns when next needed
	return tables;
}

export const columnsKey = (schema, table) => JSON.stringify([schema ?? null, table]);

/** Every column name in a database, fetched once (and again after a forced table reload). */
export async function loadColumns(db) {
	if (store.columns[db]) return store.columns[db];
	const { tables } = await api('columns?db=' + encodeURIComponent(db));
	store.columns[db] = Object.fromEntries(tables.map((t) => [columnsKey(t.schema, t.table), t.columns]));
	return store.columns[db];
}

export function resetData() {
	store.databases = [];
	store.tables = {};
	store.columns = {};
	store.notice = null;
}
