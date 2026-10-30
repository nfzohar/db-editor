<script setup>
import { computed, reactive, ref } from 'vue';
import { api } from '../api.js';
import { alterTableSql, canEdit, createTableSql, FEATURES, formColumn, joinStatements, newColumn, TYPES } from '../ddl.js';
import { link } from '../router.js';
import { loadTables, notify, store } from '../store.js';

/** Creates a table (no `table`), or edits the columns of `table` as described by `structure`. */
const props = defineProps({ db: String, schema: String, table: String, structure: Object });
const emit = defineEmits(['saved']);

const driver = store.session.driver;
const features = FEATURES[driver];
const creating = !props.table;

let nextId = 0;
const withId = (column) => ({ ...column, id: nextId++ });

const form = reactive({
	name: props.table ?? '',
	schema: props.schema ?? (creating && driver === 'postgres' ? 'public' : null),
	columns: creating
		? [withId({ ...newColumn(), name: 'id', type: TYPES[driver][0], nullable: false, primaryKey: true, autoIncrement: features.autoIncrement })]
		: props.structure.columns.map((c) => withId(formColumn(c))),
});

// SQLite tables in an attached database are qualified with its name; "main" is the default.
const qualifier = computed(() => (driver === 'sqlite' ? (props.db !== 'main' ? props.db : null) : form.schema || null));

const plan = computed(() => {
	try {
		const statements = creating
			? createTableSql(driver, { table: form.name, schema: qualifier.value, columns: form.columns })
			: alterTableSql(driver, {
				table: props.table,
				schema: qualifier.value,
				name: form.name,
				columns: form.columns,
				primaryKeyName: props.structure.indexes.find((i) => i.primary)?.name ?? null,
			});
		return { sql: joinStatements(statements), problem: '' };
	} catch (e) {
		return { sql: '', problem: e.message };
	}
});

const editable = (column, field) => !column.dropped && canEdit(driver, column, field, { creating });

function setPrimaryKey(column, on) {
	column.primaryKey = on;
	if (on) column.nullable = false;
}

function remove(column) {
	if (column.original) column.dropped = !column.dropped;
	else form.columns.splice(form.columns.indexOf(column), 1);
}

const busy = ref(false);
const error = ref('');
const cancelHref = creating ? link({ db: props.db }) : link({ db: props.db, schema: props.schema, table: props.table, tab: 'structure' });

async function save() {
	if (!plan.value.sql || busy.value) return;
	const dropped = form.columns.filter((c) => c.dropped).map((c) => c.original.name);
	if (dropped.length && !confirm(`Drop ${dropped.length === 1 ? 'column' : 'columns'} ${dropped.join(', ')}? Their data will be lost.`)) return;
	busy.value = true;
	error.value = '';
	try {
		const sql = plan.value.sql;
		const { results } = await api('sql', { db: props.db, sql, transaction: true });
		loadTables(props.db, { force: true }).catch(() => {});
		const failed = results.find((r) => r.error);
		if (failed) {
			error.value = failed.error.replace(/[^.]$/, '$&.') + (features.transactional ? ' Nothing was changed.' : '');
			return;
		}
		const target = { db: props.db, schema: form.schema, table: form.name.trim() };
		notify('success', `Table ${target.table} ${creating ? 'created' : 'changed'}.`, sql, link({ ...target, tab: 'structure' }));
		emit('saved', target);
	} catch (e) {
		error.value = e.message;
	} finally {
		busy.value = false;
	}
}
</script>

<template>
	<div class="space-y-4">
		<section class="panel overflow-hidden">
			<div class="panel-title">{{ creating ? 'Create table' : 'Edit table structure' }}</div>
			<div class="flex flex-wrap items-center gap-x-5 gap-y-2 p-3">
				<label v-if="creating && driver === 'postgres'" class="flex items-center gap-2">
					<span class="text-neutral-600">Schema</span>
					<input v-model="form.schema" class="input w-40" autocapitalize="off" spellcheck="false">
				</label>
				<label class="flex items-center gap-2">
					<span class="text-neutral-600">Table name</span>
					<input v-model="form.name" class="input w-64" autocapitalize="off" spellcheck="false">
				</label>
			</div>

			<div class="overflow-x-auto border-t border-neutral-300 bg-white">
				<table class="data-table w-full">
					<thead>
						<tr>
							<th class="border-t-0 first:border-l-0">Name</th>
							<th class="border-t-0">Type</th>
							<th class="border-t-0" title="Allows NULL">Null</th>
							<th class="border-t-0" title="SQL expression, e.g. 0, 'text' or CURRENT_TIMESTAMP">Default</th>
							<th class="border-t-0" title="Primary key">Primary</th>
							<th v-if="features.autoIncrement" class="border-t-0">Auto increment</th>
							<th v-if="features.comments" class="border-t-0">Comment</th>
							<th class="w-px border-t-0 border-r-0"><span class="sr-only">Remove</span></th>
						</tr>
					</thead>
					<tbody>
						<tr
							v-for="c in form.columns"
							:key="c.id"
							:class="{ 'opacity-50': c.dropped }"
							:title="c.original?.generated ? 'Generated column: only the name can be changed here.' : undefined"
						>
							<td class="first:border-l-0">
								<input v-model="c.name" class="input w-full min-w-32 py-1 font-mono text-xs" :class="{ 'line-through': c.dropped }" :disabled="!editable(c, 'name')" aria-label="Column name" autocapitalize="off" spellcheck="false">
							</td>
							<td>
								<input v-model="c.type" class="input w-full min-w-32 py-1 font-mono text-xs" :list="'column-types-' + driver" :disabled="!editable(c, 'type')" aria-label="Type" autocapitalize="off" spellcheck="false">
							</td>
							<td class="text-center">
								<input v-model="c.nullable" type="checkbox" class="mt-2" :disabled="c.primaryKey || !editable(c, 'nullable')" aria-label="Allows NULL">
							</td>
							<td>
								<input v-model="c.default" class="input w-full min-w-28 py-1 font-mono text-xs" placeholder="none" :disabled="!editable(c, 'default')" aria-label="Default" autocapitalize="off" spellcheck="false">
							</td>
							<td class="text-center">
								<input :checked="c.primaryKey" type="checkbox" class="mt-2" :disabled="!editable(c, 'primaryKey')" aria-label="Primary key" @change="setPrimaryKey(c, $event.target.checked)">
							</td>
							<td v-if="features.autoIncrement" class="text-center">
								<input v-model="c.autoIncrement" type="checkbox" class="mt-2" :disabled="!editable(c, 'autoIncrement')" aria-label="Auto increment">
							</td>
							<td v-if="features.comments">
								<input v-model="c.comment" class="input w-full min-w-32 py-1 text-xs" :disabled="!editable(c, 'comment')" aria-label="Comment">
							</td>
							<td class="border-r-0 whitespace-nowrap">
								<button class="btn btn-sm" :class="{ 'btn-danger': !c.dropped }" :title="c.dropped ? 'Keep this column' : 'Remove this column'" @click="remove(c)">{{ c.dropped ? 'Restore' : 'Remove' }}</button>
							</td>
						</tr>
					</tbody>
				</table>
				<datalist :id="'column-types-' + driver">
					<option v-for="type in TYPES[driver]" :key="type" :value="type" />
				</datalist>
			</div>

			<div class="space-y-2 border-t border-neutral-300 p-3">
				<button class="btn btn-sm" @click="form.columns.push(withId(newColumn()))">+ Add column</button>
				<p v-if="driver === 'sqlite' && !creating" class="text-xs text-neutral-500">
					SQLite can only rename, add and drop the columns of an existing table. To change a type, NULL, default or the
					primary key, rebuild the table from the SQL tab.
				</p>
				<p v-if="driver === 'sqlite'" class="text-xs text-neutral-500">An INTEGER primary key column numbers new rows automatically.</p>
			</div>
		</section>

		<section class="panel overflow-hidden">
			<div class="panel-title">SQL to run</div>
			<pre v-if="plan.sql" class="overflow-x-auto bg-white p-3 font-mono text-xs leading-relaxed">{{ plan.sql }}</pre>
			<p v-else-if="plan.problem" class="bg-amber-50 px-3 py-2 text-amber-900">{{ plan.problem }}</p>
			<p v-else class="bg-white px-3 py-2 text-neutral-500">No changes yet.</p>
		</section>

		<p v-if="error" class="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-red-800" role="alert">{{ error }}</p>

		<div class="flex items-center gap-2">
			<button class="btn btn-primary" :disabled="busy || !plan.sql" @click="save">{{ busy ? 'Saving…' : creating ? 'Create table' : 'Save changes' }}</button>
			<a :href="cancelHref" class="btn hover:no-underline">Cancel</a>
		</div>
	</div>
</template>
