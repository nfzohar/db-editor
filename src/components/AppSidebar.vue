<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { displayName } from '../format.js';
import { link, route } from '../router.js';
import { columnsKey, loadColumns, loadDatabases, loadTables, notify, store } from '../store.js';
import AppLogo from './AppLogo.vue';
import TableIcon from './TableIcon.vue';

const expanded = ref(new Set());
const filter = ref('');
const showSystem = ref(false);

onMounted(async () => {
	try {
		await loadDatabases();
		// SQLite has a single database, so open it straight away.
		if (store.databases.length === 1) toggle(store.databases[0].name, true);
	} catch (e) {
		notify('error', e.message);
	}
});

// Keep the current database expanded when navigating.
watch(() => route.db, (db) => db && toggle(db, true), { immediate: true });

async function toggle(db, open = !expanded.value.has(db)) {
	const next = new Set(expanded.value);
	if (open) next.add(db);
	else next.delete(db);
	expanded.value = next;
	if (open) {
		try {
			await loadTables(db);
		} catch (e) {
			notify('error', e.message);
		}
	}
}

async function refresh() {
	try {
		await loadDatabases();
		await Promise.all([...expanded.value].map((db) => loadTables(db, { force: true })));
	} catch (e) {
		notify('error', e.message);
	}
}

// Searching also matches column names, so fetch those for the open databases once there is a search.
watch([() => filter.value.trim() !== '', expanded], ([searching]) => {
	if (!searching) return;
	for (const db of expanded.value) {
		if (!store.columns[db]) loadColumns(db).catch((e) => notify('error', e.message));
	}
});

const visibleDatabases = computed(() => store.databases.filter((d) => showSystem.value || !d.system || d.name === route.db));
const hasSystem = computed(() => store.databases.some((d) => d.system));

/** The tables to list: all of them, or those whose name or a column name contains the search text (with those columns). */
function tablesOf(db) {
	const needle = filter.value.trim().toLowerCase();
	const tables = store.tables[db] ?? [];
	if (!needle) return tables.map((table) => ({ table, columns: [] }));
	return tables
		.map((table) => ({
			table,
			nameMatches: displayName(table.name, table.schema).toLowerCase().includes(needle),
			columns: (store.columns[db]?.[columnsKey(table.schema, table.name)] ?? []).filter((c) => c.toLowerCase().includes(needle)),
		}))
		.filter((m) => m.nameMatches || m.columns.length);
}

function isActive(db, table) {
	return route.db === db && route.table === table.name && (route.schema || null) === (table.schema || null);
}
</script>

<template>
	<div v-if="store.sidebarOpen" class="fixed inset-0 z-30 bg-black/30 lg:hidden" @click="store.sidebarOpen = false" />
	<aside
		class="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-neutral-300 bg-neutral-100 transition-transform lg:translate-x-0"
		:class="store.sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
		@click="(e) => e.target.closest('a') && (store.sidebarOpen = false)"
	>
		<div class="border-b border-neutral-300 bg-linear-to-b from-white to-neutral-100 px-4 py-3">
			<a :href="link()" class="text-lg hover:no-underline"><AppLogo /></a>
			<div class="mt-0.5 truncate text-xs text-neutral-500" :title="store.session.version">{{ store.session.version }}</div>
		</div>

		<div class="flex gap-1 border-b border-neutral-300 px-2 py-2">
			<a :href="link()" class="flex-1 rounded px-2 py-1 text-center text-brand hover:bg-white" :class="{ 'bg-white font-semibold': !route.db && !route.tab }">Home</a>
			<a :href="link({ db: route.db, tab: 'sql' })" class="flex-1 rounded px-2 py-1 text-center text-brand hover:bg-white" :class="{ 'bg-white font-semibold': route.tab === 'sql' && !route.table }">SQL</a>
			<button class="rounded px-2 py-1 text-neutral-500 hover:bg-white hover:text-brand" title="Reload databases and tables" @click="refresh">↻</button>
		</div>

		<div class="border-b border-neutral-300 px-2 py-2">
			<input v-model="filter" type="search" class="input w-full py-1 text-xs" placeholder="Filter tables and columns…" aria-label="Filter tables and columns">
		</div>

		<nav class="flex-1 overflow-y-auto px-1 py-2" aria-label="Databases">
			<ul>
				<li v-for="db in visibleDatabases" :key="db.name">
					<div class="flex items-center rounded hover:bg-white" :class="{ 'bg-white': route.db === db.name && !route.table }">
						<button class="w-6 shrink-0 py-1 text-xs text-neutral-500" :aria-expanded="expanded.has(db.name)" :aria-label="(expanded.has(db.name) ? 'Collapse ' : 'Expand ') + db.name" @click="toggle(db.name)">
							{{ expanded.has(db.name) ? '▾' : '▸' }}
						</button>
						<a :href="link({ db: db.name })" class="flex-1 truncate py-1 pr-2 font-medium text-neutral-800" :class="{ 'text-neutral-400': db.system, 'text-brand': route.db === db.name }">{{ db.name }}</a>
					</div>
					<ul v-if="expanded.has(db.name)" class="mb-1 ml-4 border-l border-neutral-300 pl-1">
						<li v-if="!store.tables[db.name]" class="px-2 py-1 text-xs text-neutral-400">Loading…</li>
						<li v-else-if="!tablesOf(db.name).length" class="px-2 py-1 text-xs text-neutral-400">{{ filter ? 'No matches' : 'No tables' }}</li>
						<li v-for="{ table: t, columns } in tablesOf(db.name)" :key="(t.schema ?? '') + '.' + t.name">
							<a
								:href="link({ db: db.name, schema: t.schema, table: t.name })"
								class="block rounded px-2 py-1 text-neutral-800 hover:bg-white hover:no-underline"
								:class="{ 'bg-brand-light font-semibold text-brand': isActive(db.name, t) }"
								:title="displayName(t.name, t.schema) + (columns.length ? '\nColumns: ' + columns.join(', ') : '')"
							>
								<span class="flex items-center gap-2">
									<TableIcon :view="t.type === 'view'" />
									<span class="truncate" :class="{ italic: t.type === 'view' }">{{ displayName(t.name, t.schema) }}</span>
								</span>
								<span v-if="columns.length" class="block truncate pl-6 font-mono text-[0.7rem] font-normal text-neutral-500">{{ columns.join(', ') }}</span>
							</a>
						</li>
					</ul>
				</li>
			</ul>
			<button v-if="hasSystem" class="mt-2 px-2 text-xs text-neutral-500 hover:text-brand" @click="showSystem = !showSystem">
				{{ showSystem ? 'Hide' : 'Show' }} system databases
			</button>
		</nav>
	</aside>
</template>
