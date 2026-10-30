<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref } from 'vue';
import { api } from '../api.js';
import { columnKind, fromEditor, toEditor } from '../columnTypes.js';
import { formatCount, formatSeconds, plural, quoteIdent } from '../format.js';
import { notify, store } from '../store.js';
import CellValue from './CellValue.vue';

const props = defineProps({ target: Object, structure: Object });

const PAGE_SIZES = [25, 50, 100, 250, 500];
// `where` / `orderBy` are what is typed in the clause bar; `applied` is what the shown rows were loaded with.
const state = reactive({ where: '', orderBy: '', limit: 50, page: 0 });
const applied = reactive({ where: '', orderBy: '' });
const result = ref(null);
const loading = ref(false);
const error = ref('');
const selected = ref(new Set());
// The cell being edited in place: { r, c, input, text, options, isNull, nullable } (see toEditor).
const cell = ref(null);
let cellEditor = null; // its <input> / <select> / <textarea>
const cellError = ref(''); // why the last edited value was not accepted

// Unapplied changes, written to the database by Apply. Keyed by the row array itself, so removing
// applied deletions from the page doesn't shift them.
const changes = reactive(new Map()); // row -> { [column index]: new value }
const deletions = reactive(new Set()); // rows marked for deletion
const applying = ref(false);

// Rows can only be changed when every primary key column is in the result.
const keyColumns = computed(() => props.structure.columns.filter((c) => c.primaryKey).map((c) => c.name));
const editable = computed(() => keyColumns.value.length > 0 && keyColumns.value.every((k) => result.value?.columns.includes(k)));
const pageCount = computed(() => Math.max(1, Math.ceil((result.value?.total ?? 0) / state.limit)));
const firstColumn = computed(() => props.structure.columns[0]?.name ?? 'id');
const columnInfo = computed(() => Object.fromEntries(props.structure.columns.map((c) => [c.name, c])));
const kinds = computed(() => result.value?.columns.map((name) => columnKind(columnInfo.value[name], store.session.driver)) ?? []);

const editedRows = computed(() => [...changes.keys()].filter((row) => !deletions.has(row)));
const pendingCount = computed(() => editedRows.value.length + deletions.size);
const pendingSummary = computed(() => [
	editedRows.value.length && `${plural(editedRows.value.length, 'row')} edited`,
	deletions.size && `${plural(deletions.size, 'row')} to delete`,
].filter(Boolean).join(', '));

async function load() {
	loading.value = true;
	error.value = '';
	try {
		result.value = await api('rows', {
			...props.target,
			where: applied.where,
			orderBy: applied.orderBy,
			limit: state.limit,
			offset: state.page * state.limit,
		});
		selected.value = new Set();
		revert();
	} catch (e) {
		error.value = e.message;
	} finally {
		loading.value = false;
	}
}
load();

function revert() {
	changes.clear();
	deletions.clear();
	cell.value = null;
	cellError.value = '';
}

/** Before anything that reloads the rows: true when there is nothing unapplied or the user drops it. */
function discardChanges() {
	if (pendingCount.value && !confirm(`Discard ${plural(pendingCount.value, 'unapplied change')}?`)) return false;
	revert();
	return true;
}

// Closing or reloading the browser tab with unapplied changes asks first.
const warnOnUnload = (event) => pendingCount.value && event.preventDefault();
window.addEventListener('beforeunload', warnOnUnload);
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnOnUnload));

function goTo(page) {
	if (!discardChanges()) return;
	state.page = page;
	load();
}

function setLimit(event) {
	if (!discardChanges()) {
		event.target.value = state.limit;
		return;
	}
	state.limit = Number(event.target.value);
	state.page = 0;
	load();
}

/** Load the clause bar's WHERE / ORDER BY from the first page. */
function runQuery() {
	if (!discardChanges()) return;
	applied.where = state.where.trim();
	applied.orderBy = state.orderBy.trim();
	state.page = 0;
	load();
}

/** 'asc' / 'desc' when the applied ORDER BY is just this column, as a header click writes it. */
function sortOf(column) {
	const [, expr, dir = 'ASC'] = /^(.+?)(?:\s+(ASC|DESC))?$/i.exec(applied.orderBy) ?? [];
	return expr === column || expr === quoteIdent(store.session.driver, column) ? dir.toLowerCase() : null;
}

// Header clicks cycle ascending → descending → unsorted by writing the ORDER BY text, like PhpStorm.
function sortBy(column) {
	if (!discardChanges()) return;
	const dir = sortOf(column);
	const ident = quoteIdent(store.session.driver, column);
	state.orderBy = dir === 'asc' ? `${ident} DESC` : dir === 'desc' ? '' : `${ident} ASC`;
	state.where = applied.where; // a header click applies only the new order, not a half-typed WHERE
	runQuery();
}

function rowKey(row) {
	return Object.fromEntries(keyColumns.value.map((k) => [k, row[result.value.columns.indexOf(k)]]));
}

function toggleRow(index) {
	const next = new Set(selected.value);
	next.has(index) ? next.delete(index) : next.add(index);
	selected.value = next;
}

function toggleAll() {
	selected.value = selected.value.size === result.value.rows.length ? new Set() : new Set(result.value.rows.map((_, i) => i));
}

// When every selected row is already marked for deletion, the toolbar button restores them instead.
const selectionMarked = computed(() => [...selected.value].every((r) => deletions.has(result.value.rows[r])));

function toggleDeleteSelected() {
	const restore = selectionMarked.value;
	for (const r of selected.value) {
		const row = result.value.rows[r];
		restore ? deletions.delete(row) : deletions.add(row);
	}
	selected.value = new Set();
	cell.value = null;
}

const hasChange = (row, c) => Object.hasOwn(changes.get(row) ?? {}, c);
const valueOf = (row, c) => (hasChange(row, c) ? changes.get(row)[c] : row[c]);
const sameValue = (a, b) => a === b || (a !== null && b !== null && String(a) === String(b));
const isEditing = (r, c) => cell.value?.r === r && cell.value?.c === c;

// Binary values arrive as 0x… hex and can't be written back as text.
const canEdit = (row, c) => editable.value && !applying.value && !deletions.has(row) && kinds.value[c].kind !== 'binary';

function startEdit(r, c) {
	const row = result.value.rows[r];
	if (isEditing(r, c) || !canEdit(row, c)) return;
	const value = valueOf(row, c);
	const column = columnInfo.value[result.value.columns[c]];
	cell.value = { r, c, ...toEditor(kinds.value[c], value), isNull: value === null, nullable: !!column?.nullable };
	nextTick(() => {
		cellEditor?.focus();
		cellEditor?.select?.(); // text-like inputs only
	});
}

function cancelEdit() {
	cell.value = null; // the editor's blur then finds nothing to keep
	cellError.value = '';
}

/**
 * Keep the edited value as a pending change (or drop it if it is back to the original), then optionally
 * move `step` cells along. A value that doesn't fit the column type keeps the editor open; on blur it is dropped.
 */
function commitCell(step = 0, { blur = false } = {}) {
	const edit = cell.value;
	if (!edit) return;
	const row = result.value.rows[edit.r];
	const original = row[edit.c];
	let value = null;
	if (!edit.isNull) {
		const parsed = fromEditor(kinds.value[edit.c], edit.text, original, store.session.driver);
		if (parsed.error) {
			cellError.value = `${result.value.columns[edit.c]} ${parsed.error}.` + (blur ? ' The edit was not kept.' : '');
			if (blur) cell.value = null;
			else nextTick(() => cellEditor?.focus());
			return;
		}
		value = parsed.value;
	}
	cell.value = null;
	cellError.value = '';
	const rowChanges = changes.get(row) ?? {};
	if (sameValue(value, original)) delete rowChanges[edit.c];
	else rowChanges[edit.c] = value;
	if (Object.keys(rowChanges).length) changes.set(row, rowChanges);
	else changes.delete(row);
	const next = edit.c + step;
	if (step && next >= 0 && next < result.value.columns.length) startEdit(edit.r, next);
}

function setNull() {
	cell.value.isNull = true;
	cell.value.text = '';
	commitCell();
}

function onCellKeydown(event) {
	if (event.key === 'Escape') {
		event.preventDefault();
		cancelEdit();
	} else if (event.key === 'Enter' && !(cell.value.input === 'textarea' && event.shiftKey)) {
		event.preventDefault();
		commitCell();
	} else if (event.key === 'Tab') {
		event.preventDefault();
		commitCell(event.shiftKey ? -1 : 1);
	}
}

/** Write the pending edits (one UPDATE per row) and deletions; on an error the rest stay pending. */
async function applyChanges() {
	if (!pendingCount.value || applying.value) return;
	if (deletions.size && !confirm(`Delete ${plural(deletions.size, 'row')}? This cannot be undone.`)) return;
	applying.value = true;
	error.value = '';
	selected.value = new Set();
	let updated = 0;
	let deleted = 0;
	try {
		for (const row of [...editedRows.value]) {
			const rowChanges = changes.get(row);
			const values = Object.fromEntries(Object.entries(rowChanges).map(([c, value]) => [result.value.columns[c], value]));
			await api('rows/update', { ...props.target, key: rowKey(row), values });
			for (const [c, value] of Object.entries(rowChanges)) row[c] = value;
			changes.delete(row);
			updated++;
		}
		for (const row of [...deletions]) {
			await api('rows/delete', { ...props.target, key: rowKey(row) });
			result.value.rows.splice(result.value.rows.indexOf(row), 1);
			deletions.delete(row);
			changes.delete(row);
			deleted++;
		}
	} catch (e) {
		error.value = e.message;
	} finally {
		applying.value = false;
	}
	const done = [updated && `${plural(updated, 'row')} updated`, deleted && `${plural(deleted, 'row')} deleted`].filter(Boolean).join(', ');
	if (error.value) {
		if (done) error.value = `${done}, then: ${error.value}`;
	} else {
		notify('success', done + '.');
		await load();
	}
}

</script>

<template>
	<div class="overflow-hidden rounded-md border border-neutral-300 bg-white">
		<!-- Toolbar: paging and page size; selection, pending changes and reload on the right -->
		<div class="flex flex-wrap items-center gap-1 border-b border-neutral-300 bg-neutral-50 px-2 py-1">
			<button class="btn btn-sm" title="First page" aria-label="First page" :disabled="state.page === 0 || loading" @click="goTo(0)">«</button>
			<button class="btn btn-sm" title="Previous page" aria-label="Previous page" :disabled="state.page === 0 || loading" @click="goTo(state.page - 1)">‹</button>
			<span class="min-w-24 px-1 text-center text-xs text-neutral-600 tabular-nums">
				<template v-if="result?.total">{{ formatCount(state.page * state.limit + 1) }}–{{ formatCount(state.page * state.limit + result.rows.length) }} of {{ formatCount(result.total) }}</template>
				<template v-else-if="result">0 rows</template>
			</span>
			<button class="btn btn-sm" title="Next page" aria-label="Next page" :disabled="state.page >= pageCount - 1 || loading" @click="goTo(state.page + 1)">›</button>
			<button class="btn btn-sm" title="Last page" aria-label="Last page" :disabled="state.page >= pageCount - 1 || loading" @click="goTo(pageCount - 1)">»</button>
			<select :value="state.limit" class="input ml-1 py-0 text-xs" title="Rows per page" aria-label="Rows per page" @change="setLimit">
				<option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }}</option>
			</select>
			<span v-if="loading" class="ml-1 text-xs text-neutral-400">Loading…</span>
			<div class="ml-auto flex flex-wrap items-center gap-1">
				<template v-if="editable && selected.size">
					<span class="text-xs text-neutral-600">{{ plural(selected.size, 'row') }} selected</span>
					<button v-if="selectionMarked" class="btn btn-sm mr-2" :disabled="applying" @click="toggleDeleteSelected">Restore selected</button>
					<button v-else class="btn btn-sm btn-danger mr-2" :disabled="applying" @click="toggleDeleteSelected">Delete selected</button>
				</template>
				<template v-if="pendingCount">
					<span class="mr-1 text-xs font-medium text-sky-800">{{ pendingSummary }}</span>
					<button class="btn btn-sm" title="Drop all unapplied changes" :disabled="applying" @click="revert">Revert</button>
					<button class="btn btn-sm btn-primary mr-2" title="Write the changes to the database" :disabled="applying" @click="applyChanges">{{ applying ? 'Applying…' : 'Apply' }}</button>
				</template>
				<button class="btn btn-sm" title="Reload, applying WHERE and ORDER BY" :disabled="loading || applying" @click="runQuery">⟳ Reload</button>
			</div>
		</div>

		<!-- Clause bar: free SQL for the WHERE and ORDER BY of the query, applied with Enter -->
		<form class="flex flex-wrap gap-px border-b border-neutral-300 bg-neutral-300 font-mono text-xs" @submit.prevent="runQuery">
			<label class="flex min-w-0 flex-[2_1_16rem] items-center gap-3 bg-white px-4 focus-within:bg-brand-light">
				<span class="font-semibold text-brand">WHERE</span>
				<input v-model="state.where" class="min-w-0 flex-1 bg-transparent py-2.5 focus:outline-none" :placeholder="`e.g. ${firstColumn} > 10`" autocapitalize="off" spellcheck="false">
			</label>
			<label class="flex min-w-0 flex-[1_1_12rem] items-center gap-3 bg-white px-4 focus-within:bg-brand-light">
				<span class="font-semibold whitespace-nowrap text-brand">ORDER BY</span>
				<input v-model="state.orderBy" class="min-w-0 flex-1 bg-transparent py-2.5 focus:outline-none" :placeholder="`e.g. ${firstColumn} DESC`" autocapitalize="off" spellcheck="false">
			</label>
			<button class="sr-only">Apply</button>
		</form>

		<p v-if="error" class="border-b border-red-300 bg-red-50 px-3 py-1.5 text-red-800" role="alert">{{ error }}</p>
		<p v-if="cellError" class="border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-900" role="alert">{{ cellError }}</p>
		<p v-if="result && keyColumns.length === 0" class="border-b border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-900">
			There is no primary key here, so rows are read-only in this view. Use the SQL tab to change them.
		</p>

		<template v-if="result">
			<!-- Data -->
			<div class="max-h-[65vh] overflow-auto">
				<table class="data-table compact">
					<thead>
						<tr>
							<th class="w-px" aria-label="Row number"></th>
							<th v-if="editable" class="w-px">
								<input type="checkbox" :checked="result.rows.length > 0 && selected.size === result.rows.length" aria-label="Select all rows on this page" @change="toggleAll">
							</th>
							<th v-for="column in result.columns" :key="column" :aria-sort="sortOf(column) === 'asc' ? 'ascending' : sortOf(column) === 'desc' ? 'descending' : undefined">
								<button class="inline-flex items-center gap-1 font-semibold hover:text-brand" :title="`Sort by ${column}`" @click="sortBy(column)">
									{{ column }}
									<span class="text-[0.6rem]" :class="sortOf(column) ? 'text-brand' : 'text-transparent'">{{ sortOf(column) === 'desc' ? '▼' : '▲' }}</span>
								</button>
							</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="(row, r) in result.rows" :key="r" :class="{ selected: selected.has(r), deleted: deletions.has(row) }">
							<td class="text-right text-neutral-400 tabular-nums select-none">{{ state.page * state.limit + r + 1 }}</td>
							<td v-if="editable"><input type="checkbox" :checked="selected.has(r)" :aria-label="'Select row ' + (r + 1)" @change="toggleRow(r)"></td>
							<td
								v-for="(_, c) in row"
								:key="c"
								:class="isEditing(r, c) ? 'editing' : { changed: hasChange(row, c), 'text-right': kinds[c].numeric, 'cursor-text': canEdit(row, c) }"
								@click="startEdit(r, c)"
							>
								<div v-if="isEditing(r, c)" class="flex items-center gap-1.5">
									<select
										v-if="cell.input === 'select'"
										:ref="(el) => (cellEditor = el)"
										v-model="cell.text"
										class="min-w-[6ch] flex-1 bg-transparent focus:outline-none"
										title="Enter to keep, Tab for the next cell, Esc to cancel"
										:aria-label="result.columns[c]"
										@change="cell.isNull = false"
										@keydown="onCellKeydown"
										@blur="commitCell(0, { blur: true })"
									>
										<option v-if="cell.isNull" value="" disabled>NULL</option>
										<option v-for="option in cell.options" :key="option" :value="option">{{ option }}</option>
									</select>
									<textarea
										v-else-if="cell.input === 'textarea'"
										:ref="(el) => (cellEditor = el)"
										v-model="cell.text"
										rows="4"
										title="Enter to keep, Shift+Enter for a new line, Esc to cancel"
										class="w-96 flex-1 resize bg-transparent focus:outline-none"
										:placeholder="cell.isNull ? 'NULL' : ''"
										:aria-label="result.columns[c]"
										@input="cell.isNull = false"
										@keydown="onCellKeydown"
										@blur="commitCell(0, { blur: true })"
									/>
									<input
										v-else
										:ref="(el) => (cellEditor = el)"
										v-model="cell.text"
										:type="cell.input"
										:step="cell.input === 'text' ? undefined : 1"
										:inputmode="kinds[c].numeric ? 'decimal' : undefined"
										:maxlength="kinds[c].maxLength || undefined"
										class="field-sizing-content min-w-[4ch] flex-1 bg-transparent focus:outline-none"
										title="Enter to keep, Tab for the next cell, Esc to cancel"
										:placeholder="cell.isNull ? 'NULL' : ''"
										:aria-label="result.columns[c]"
										@input="cell.isNull = false"
										@keydown="onCellKeydown"
										@blur="commitCell(0, { blur: true })"
									>
									<button v-if="cell.nullable" class="shrink-0 cursor-pointer rounded border border-neutral-300 px-1 font-sans text-[0.6rem] text-neutral-500 hover:border-brand hover:text-brand" title="Set to NULL" @mousedown.prevent @click.stop="setNull">NULL</button>
								</div>
								<CellValue v-else :value="valueOf(row, c)" />
							</td>
						</tr>
						<tr v-if="!result.rows.length"><td :colspan="result.columns.length + (editable ? 2 : 1)" class="font-sans text-neutral-500">No rows.</td></tr>
					</tbody>
				</table>
			</div>

			<!-- Status bar: the query that produced these rows -->
			<div class="flex items-center gap-3 border-t border-neutral-300 bg-neutral-50 px-2 py-1 text-xs text-neutral-500">
				<code class="min-w-0 flex-1 truncate font-mono" :title="result.sql">{{ result.sql }}</code>
				<span class="whitespace-nowrap tabular-nums">{{ formatSeconds(result.time) }}</span>
			</div>
		</template>
	</div>
</template>
