<script setup>
import { displayName } from '../format.js';
import { link } from '../router.js';

defineProps({ target: Object, structure: Object, isView: Boolean });
</script>

<template>
	<section class="mb-6">
		<div class="mb-2 flex items-center gap-3">
			<h2 class="font-semibold text-neutral-700">Columns</h2>
			<a v-if="!isView" :href="link({ ...target, tab: 'alter' })" class="btn btn-sm hover:no-underline">Edit structure</a>
		</div>
		<div class="overflow-x-auto">
			<table class="data-table">
				<thead>
					<tr><th>#</th><th>Name</th><th>Type</th><th>Null</th><th>Default</th><th>Extra</th><th>Comment</th></tr>
				</thead>
				<tbody>
					<tr v-for="(c, i) in structure.columns" :key="c.name">
						<td class="text-right text-neutral-500 tabular-nums">{{ i + 1 }}</td>
						<td class="font-medium" :class="{ underline: c.primaryKey }">{{ c.name }}</td>
						<td class="font-mono text-xs">{{ c.type }}</td>
						<td>{{ c.nullable ? 'Yes' : 'No' }}</td>
						<td class="font-mono text-xs"><span v-if="c.default === null || c.default === undefined" class="text-neutral-400 italic">{{ c.nullable ? 'NULL' : 'None' }}</span><template v-else>{{ c.default }}</template></td>
						<td class="text-xs">
							<span v-if="c.primaryKey" class="mr-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">PRIMARY</span>
							<span v-if="c.autoIncrement" class="rounded bg-sky-100 px-1.5 py-0.5 text-sky-800">AUTO_INCREMENT</span>
						</td>
						<td class="text-neutral-600">{{ c.comment }}</td>
					</tr>
				</tbody>
			</table>
		</div>
	</section>

	<section class="mb-6">
		<h2 class="mb-2 font-semibold text-neutral-700">Indexes</h2>
		<table v-if="structure.indexes.length" class="data-table">
			<thead><tr><th>Name</th><th>Type</th><th>Columns</th></tr></thead>
			<tbody>
				<tr v-for="index in structure.indexes" :key="index.name">
					<td class="font-medium">{{ index.name }}</td>
					<td>{{ index.primary ? 'PRIMARY' : index.unique ? 'UNIQUE' : 'INDEX' }}</td>
					<td class="font-mono text-xs">{{ index.columns.join(', ') }}</td>
				</tr>
			</tbody>
		</table>
		<p v-else class="text-neutral-500">No indexes.</p>
	</section>

	<section>
		<h2 class="mb-2 font-semibold text-neutral-700">Foreign keys</h2>
		<table v-if="structure.foreignKeys.length" class="data-table">
			<thead><tr><th>Name</th><th>Columns</th><th>References</th><th>On delete</th><th>On update</th></tr></thead>
			<tbody>
				<tr v-for="fk in structure.foreignKeys" :key="fk.name">
					<td class="font-medium">{{ fk.name }}</td>
					<td class="font-mono text-xs">{{ fk.columns.join(', ') }}</td>
					<td>
						<a :href="link({ db: target.db, schema: fk.refSchema ?? target.schema, table: fk.refTable })" class="link">{{ displayName(fk.refTable, fk.refSchema) }}</a>
						<span class="font-mono text-xs text-neutral-600"> ({{ fk.refColumns.join(', ') }})</span>
					</td>
					<td>{{ fk.onDelete }}</td>
					<td>{{ fk.onUpdate }}</td>
				</tr>
			</tbody>
		</table>
		<p v-else class="text-neutral-500">No foreign keys.</p>
	</section>
</template>
