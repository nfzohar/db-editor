<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api.js';
import { displayName } from '../format.js';
import { link, route } from '../router.js';
import { columnsKey, loadColumns, loadDatabases, loadTables, notify, resetData, store } from '../store.js';
import { setSidebarWidth, sidebarWidth } from '../sidebarWidth.js';
import { cycleTheme, theme } from '../theme.js';
import AppLogo from './AppLogo.vue';
import TableIcon from './TableIcon.vue';

const expanded = ref(new Set());
const filter = ref('');
const showSystem = ref(false);

/** Drag the right edge to resize; pointer capture keeps the drag going past the handle's bounds. */
function startResize(event) {
	event.preventDefault();
	const startX = event.clientX;
	const startWidth = sidebarWidth.value;
	const handle = event.currentTarget;
	handle.setPointerCapture(event.pointerId);
	document.body.style.cursor = 'col-resize';
	document.body.style.userSelect = 'none';

	function onMove(e) {
		setSidebarWidth(startWidth + (e.clientX - startX));
	}
	function onUp() {
		handle.removeEventListener('pointermove', onMove);
		handle.removeEventListener('pointerup', onUp);
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
	}
	handle.addEventListener('pointermove', onMove);
	handle.addEventListener('pointerup', onUp, { once: true });
}

const driverLabel = () => store.drivers.find((d) => d.id === store.session.driver)?.label ?? store.session.driver;

async function logout() {
	await api('logout', {}).catch(() => {});
	resetData();
	store.session = null;
	location.hash = '#/';
}

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
		class="fixed inset-y-0 left-0 z-40 flex flex-col border-r border-neutral-300 bg-neutral-100 transition-transform lg:translate-x-0"
		:class="store.sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
		:style="{ width: sidebarWidth + 'px' }"
		@click="(e) => e.target.closest('a') && (store.sidebarOpen = false)"
	>
		<div
			class="absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize touch-none hover:bg-brand/30 active:bg-brand/50"
			role="separator"
			aria-label="Resize sidebar"
			aria-orientation="vertical"
			@pointerdown="startResize"
		/>
		<div class="border-b border-neutral-300 bg-linear-to-b from-white to-neutral-100 px-4 py-3">
			<div class="flex items-center justify-between gap-2">
				<a :href="link()" class="min-w-0 truncate text-lg hover:no-underline"><AppLogo /></a>
				<div class="flex shrink-0 items-center gap-1">
					<button class="rounded px-1.5 py-1 text-neutral-500 hover:bg-white hover:text-brand" :title="`Theme: ${theme.label} (click to change)`" :aria-label="`Theme: ${theme.label}`" @click="cycleTheme">{{ theme.icon }}</button>
					<button class="rounded px-1.5 py-1 text-neutral-500 hover:bg-white hover:text-brand" title="Log out" aria-label="Log out" @click="logout">⏻</button>
				</div>
			</div>
			<div class="mt-1.5 truncate text-xs text-neutral-500">
				<a :href="link()" class="hover:text-brand hover:underline" :title="store.session.version">{{ driverLabel() }}: {{ store.session.label }}</a>
			</div>
			<div v-if="route.db" class="truncate text-xs text-neutral-400">
				<a :href="link({ db: route.db })" class="hover:text-brand hover:underline">{{ route.db }}</a>
			</div>
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
