<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { displayName, qualifiedName } from '../format.js';
import { link, navigate, route } from '../router.js';
import { store } from '../store.js';
import BrowseTab from './BrowseTab.vue';
import SqlConsole from './SqlConsole.vue';
import StructureTab from './StructureTab.vue';
import TableForm from './TableForm.vue';
import TabBar from './TabBar.vue';

const structure = ref(null);
const error = ref('');

const target = { db: route.db, schema: route.schema || null, table: route.table };

async function load() {
	const query = new URLSearchParams({ db: target.db, table: target.table, ...(target.schema ? { schema: target.schema } : {}) });
	try {
		structure.value = await api('structure?' + query);
	} catch (e) {
		error.value = e.message;
	}
}
onMounted(load);

/** After the structure form: a renamed table is a new view (see App.vue); otherwise reload this one. */
async function saved(next) {
	if (next.table === target.table) {
		structure.value = null;
		await load();
	}
	navigate({ ...next, tab: 'structure' });
}

const isView = computed(() => (store.tables[target.db] ?? []).find((t) => t.name === target.table && (t.schema ?? null) === target.schema)?.type === 'view');
const tab = computed(() => route.tab || 'browse');
const tabs = computed(() => [
	{ id: 'browse', label: 'Browse' },
	{ id: 'structure', label: 'Structure' },
	{ id: 'sql', label: 'SQL' },
].map((t) => ({ ...t, href: link({ ...target, tab: t.id }) })));
const activeTab = computed(() => (tab.value === 'alter' ? 'structure' : tab.value));

const defaultSql = computed(() => `SELECT * FROM ${qualifiedName(store.session.driver, target.table, target.schema)} LIMIT 100;`);
</script>

<template>
	<h1 class="mb-4 text-xl text-neutral-800">
		{{ isView ? 'View' : 'Table' }}: <span class="font-semibold">{{ displayName(target.table, target.schema) }}</span>
	</h1>
	<TabBar :tabs="tabs" :active="activeTab" />

	<p v-if="error" class="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-red-800" role="alert">{{ error }}</p>
	<p v-else-if="!structure" class="text-neutral-500">Loading…</p>
	<template v-else>
		<BrowseTab v-if="tab === 'browse'" :target="target" :structure="structure" />
		<StructureTab v-else-if="tab === 'structure'" :target="target" :structure="structure" :is-view="isView" />
		<TableForm v-else-if="tab === 'alter' && !isView" :db="target.db" :schema="target.schema" :table="target.table" :structure="structure" @saved="saved" />
		<SqlConsole v-else-if="tab === 'sql'" :db="target.db" :initial-sql="defaultSql" :table="{ name: target.table, schema: target.schema, columns: structure.columns, isView }" />
	</template>
</template>
