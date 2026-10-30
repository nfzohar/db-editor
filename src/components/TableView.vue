<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { displayName, qualifiedName } from '../format.js';
import { link, route } from '../router.js';
import { store } from '../store.js';
import BrowseTab from './BrowseTab.vue';
import SqlConsole from './SqlConsole.vue';
import StructureTab from './StructureTab.vue';
import TabBar from './TabBar.vue';

const structure = ref(null);
const error = ref('');

const target = { db: route.db, schema: route.schema || null, table: route.table };

onMounted(async () => {
	const query = new URLSearchParams({ db: target.db, table: target.table, ...(target.schema ? { schema: target.schema } : {}) });
	try {
		structure.value = await api('structure?' + query);
	} catch (e) {
		error.value = e.message;
	}
});

const isView = computed(() => (store.tables[target.db] ?? []).find((t) => t.name === target.table && (t.schema ?? null) === target.schema)?.type === 'view');
const tab = computed(() => route.tab || 'browse');
const tabs = computed(() => [
	{ id: 'browse', label: 'Browse' },
	{ id: 'structure', label: 'Structure' },
	{ id: 'sql', label: 'SQL' },
].map((t) => ({ ...t, href: link({ ...target, tab: t.id }) })));

const defaultSql = computed(() => `SELECT * FROM ${qualifiedName(store.session.driver, target.table, target.schema)} LIMIT 100;`);
</script>

<template>
	<h1 class="mb-4 text-xl text-neutral-800">
		{{ isView ? 'View' : 'Table' }}: <span class="font-semibold">{{ displayName(target.table, target.schema) }}</span>
	</h1>
	<TabBar :tabs="tabs" :active="tab" />

	<p v-if="error" class="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-red-800" role="alert">{{ error }}</p>
	<p v-else-if="!structure" class="text-neutral-500">Loading…</p>
	<template v-else>
		<BrowseTab v-if="tab === 'browse'" :target="target" :structure="structure" />
		<StructureTab v-else-if="tab === 'structure'" :target="target" :structure="structure" />
		<SqlConsole v-else-if="tab === 'sql'" :db="target.db" :initial-sql="defaultSql" :table="{ name: target.table, schema: target.schema, columns: structure.columns, isView }" />
	</template>
</template>
