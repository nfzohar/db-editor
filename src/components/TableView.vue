<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { displayName, qualifiedName } from '../format.js';
import { link, navigate } from '../router.js';
import { store } from '../store.js';
import { retarget } from '../tabs.js';
import BrowseTab from './BrowseTab.vue';
import SqlConsole from './SqlConsole.vue';
import StructureTab from './StructureTab.vue';
import TableForm from './TableForm.vue';
import TabBar from './TabBar.vue';

const props = defineProps({ tab: Object });

const structure = ref(null);
const error = ref('');
const browseTabRef = ref(null);

const target = { db: props.tab.db, schema: props.tab.schema, table: props.tab.table };

async function load() {
	const query = new URLSearchParams({ db: target.db, table: target.table, ...(target.schema ? { schema: target.schema } : {}) });
	try {
		structure.value = await api('structure?' + query);
	} catch (e) {
		error.value = e.message;
	}
}
onMounted(load);

/** After the structure form: a renamed table retargets this tab in place; otherwise reload it. */
async function saved(next) {
	if (next.table === target.table && next.schema === target.schema) {
		structure.value = null;
		await load();
	}
	retarget(props.tab.id, next, 'structure');
	navigate({ ...next, tab: 'structure' });
}

const isView = computed(() => (store.tables[target.db] ?? []).find((t) => t.name === target.table && (t.schema ?? null) === target.schema)?.type === 'view');
const viewTab = computed(() => props.tab.view || 'browse');
const tabs = computed(() => [
	{ id: 'browse', label: 'Browse' },
	{ id: 'structure', label: 'Structure' },
	{ id: 'sql', label: 'SQL' },
].map((t) => ({ ...t, href: link({ ...target, tab: t.id }) })));
const activeTab = computed(() => (viewTab.value === 'alter' ? 'structure' : viewTab.value));

const defaultSql = computed(() => `SELECT * FROM ${qualifiedName(store.session.driver, target.table, target.schema)} LIMIT 100;`);

defineExpose({ discardChanges: () => browseTabRef.value?.discardChanges?.() ?? true });
</script>

<template>
	<div>
		<h1 class="mb-4 shrink-0 text-xl text-neutral-800">
			{{ isView ? 'View' : 'Table' }}: <span class="font-semibold">{{ displayName(target.table, target.schema) }}</span>
		</h1>
		<TabBar class="shrink-0" :tabs="tabs" :active="activeTab" />

		<div class="min-h-0 flex-1">
			<p v-if="error" class="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-red-800" role="alert">{{ error }}</p>
			<p v-else-if="!structure" class="text-neutral-500">Loading…</p>
			<template v-else>
				<BrowseTab v-if="viewTab === 'browse'" ref="browseTabRef" class="h-full" :target="target" :structure="structure" />
				<StructureTab v-else-if="viewTab === 'structure'" :target="target" :structure="structure" :is-view="isView" />
				<TableForm v-else-if="viewTab === 'alter' && !isView" :db="target.db" :schema="target.schema" :table="target.table" :structure="structure" @saved="saved" />
				<SqlConsole v-else-if="viewTab === 'sql'" :db="target.db" :initial-sql="defaultSql" :table="{ name: target.table, schema: target.schema, columns: structure.columns, isView }" />
			</template>
		</div>
	</div>
</template>
