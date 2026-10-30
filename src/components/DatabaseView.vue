<script setup>
import { computed, onMounted, ref } from 'vue';
import { displayName, formatBytes, formatCount, plural } from '../format.js';
import { link, navigate, route } from '../router.js';
import { loadTables, notify, store } from '../store.js';
import TableForm from './TableForm.vue';
import TabBar from './TabBar.vue';
import TableIcon from './TableIcon.vue';

const loading = ref(true);
const filter = ref('');

onMounted(async () => {
	try {
		await loadTables(route.db, { force: true });
	} catch (e) {
		notify('error', e.message);
	} finally {
		loading.value = false;
	}
});

const tables = computed(() => {
	const needle = filter.value.trim().toLowerCase();
	return (store.tables[route.db] ?? []).filter((t) => !needle || displayName(t.name, t.schema).toLowerCase().includes(needle));
});
const totals = computed(() => ({
	rows: tables.value.reduce((sum, t) => sum + (t.rows ?? 0), 0),
	size: tables.value.reduce((sum, t) => sum + (t.size ?? 0), 0),
	hasSize: tables.value.some((t) => t.size !== null),
}));

const tabs = computed(() => [
	{ id: 'tables', label: 'Tables', href: link({ db: route.db }) },
	{ id: 'sql', label: 'SQL', href: link({ db: route.db, tab: 'sql' }) },
	{ id: 'create', label: 'Create table', href: link({ db: route.db, tab: 'create' }) },
]);

const tableLink = (t, tab) => link({ db: route.db, schema: t.schema, table: t.name, tab });
</script>

<template>
	<h1 class="mb-4 text-xl text-neutral-800">Database: <span class="font-semibold">{{ route.db }}</span></h1>
	<TabBar :tabs="tabs" :active="route.tab === 'create' ? 'create' : 'tables'" />

	<TableForm v-if="route.tab === 'create'" :db="route.db" @saved="(target) => navigate({ ...target, tab: 'structure' })" />
	<template v-else>
		<div class="mb-3 flex items-center gap-3">
			<input v-model="filter" type="search" class="input w-64" placeholder="Filter tables…" aria-label="Filter tables">
			<span class="text-neutral-500">{{ loading ? 'Loading…' : plural(tables.length, 'table') }}</span>
		</div>

		<div class="overflow-x-auto">
			<table v-if="tables.length" class="data-table min-w-full">
				<thead>
					<tr>
						<th>Table</th>
						<th>Action</th>
						<th>Type</th>
						<th class="text-right">Rows</th>
						<th v-if="totals.hasSize" class="text-right">Size</th>
						<th>Comment</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="t in tables" :key="(t.schema ?? '') + '.' + t.name">
						<td>
							<a :href="tableLink(t, 'browse')" class="link inline-flex items-center gap-2 font-medium">
								<TableIcon :view="t.type === 'view'" />{{ displayName(t.name, t.schema) }}
							</a>
						</td>
						<td class="whitespace-nowrap">
							<a :href="tableLink(t, 'browse')" class="link mr-3">Browse</a>
							<a :href="tableLink(t, 'structure')" class="link mr-3">Structure</a>
							<a :href="tableLink(t, 'sql')" class="link">SQL</a>
						</td>
						<td :class="{ 'text-purple-700': t.type === 'view' }">{{ t.type }}</td>
						<td class="text-right tabular-nums">
							<template v-if="t.rows !== null">{{ t.rowsApproximate ? '~' : '' }}{{ formatCount(t.rows) }}</template>
							<span v-else class="text-neutral-400">–</span>
						</td>
						<td v-if="totals.hasSize" class="text-right tabular-nums">{{ formatBytes(t.size) }}</td>
						<td class="text-neutral-600">{{ t.comment }}</td>
					</tr>
				</tbody>
				<tfoot>
					<tr class="font-semibold">
						<td class="border-r border-b border-l border-neutral-200 bg-neutral-100 px-3 py-1.5">{{ plural(tables.length, 'table') }}</td>
						<td class="border-r border-b border-neutral-200 bg-neutral-100" colspan="2" />
						<td class="border-r border-b border-neutral-200 bg-neutral-100 px-3 py-1.5 text-right tabular-nums">{{ formatCount(totals.rows) }}</td>
						<td v-if="totals.hasSize" class="border-r border-b border-neutral-200 bg-neutral-100 px-3 py-1.5 text-right tabular-nums">{{ formatBytes(totals.size) }}</td>
						<td class="border-r border-b border-neutral-200 bg-neutral-100" />
					</tr>
				</tfoot>
			</table>
			<p v-else-if="!loading" class="text-neutral-500">{{ filter ? 'No tables match the filter.' : 'This database has no tables.' }} <a :href="link({ db: route.db, tab: 'create' })" class="link">Create one</a>.</p>
		</div>
	</template>
</template>
