<script setup>
import { computed, nextTick, ref } from 'vue';
import { api } from '../api.js';
import { formatSeconds, plural } from '../format.js';
import { link } from '../router.js';
import { TEMPLATES } from '../sqlTemplates.js';
import { loadTables, store } from '../store.js';
import ResultTable from './ResultTable.vue';
import TabBar from './TabBar.vue';

// `table` ({ name, schema, columns, isView }) adds buttons that write statement templates for it.
const props = defineProps({ db: String, initialSql: String, heading: Boolean, table: Object });

const HISTORY_KEY = 'dbeditor.sqlHistory';
const HISTORY_SIZE = 25;

function loadHistory() {
	try {
		return JSON.parse(localStorage.getItem(HISTORY_KEY)) ?? [];
	} catch {
		return [];
	}
}

const sql = ref(props.initialSql ?? '');
const results = ref(null);
const busy = ref(false);
const error = ref('');
const history = ref(loadHistory());
const editor = ref(null);

const templates = computed(() => props.table ? TEMPLATES.filter((t) => !t.writes || !props.table.isView) : []);

/**
 * Put a template in the editor: it replaces an empty or untouched query, otherwise it goes in at the
 * cursor on its own lines. The first placeholder is then selected so you can type over it.
 */
function generate(template) {
	const { name, schema, columns } = props.table;
	const text = template.build(store.session.driver, name, schema, columns);
	let at = 0;
	if (!sql.value.trim() || sql.value === props.initialSql) {
		sql.value = text;
	} else {
		const { selectionStart: start, selectionEnd: end } = editor.value;
		const before = sql.value.slice(0, start);
		const after = sql.value.slice(end);
		const lead = !before.trim() || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
		sql.value = before + lead + text + (after && !after.startsWith('\n') ? '\n' : '') + after;
		at = start + lead.length;
	}
	const placeholder = /'\[[^\]]*\]'|<condition>/.exec(text);
	const [from, to] = placeholder ? [at + placeholder.index, at + placeholder.index + placeholder[0].length] : [at + text.length, at + text.length];
	nextTick(() => {
		editor.value.focus();
		editor.value.setSelectionRange(from, to);
	});
}

const tabs = computed(() => props.db ? [
	{ id: 'tables', label: 'Tables', href: link({ db: props.db }) },
	{ id: 'sql', label: 'SQL', href: link({ db: props.db, tab: 'sql' }) },
] : []);

function remember(text) {
	history.value = [text, ...history.value.filter((h) => h !== text)].slice(0, HISTORY_SIZE);
	try {
		localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value));
	} catch {}
}

async function run() {
	const text = sql.value.trim();
	if (!text || busy.value) return;
	busy.value = true;
	error.value = '';
	try {
		results.value = (await api('sql', { db: props.db, sql: text })).results;
		remember(text);
		// Statements may have created or dropped tables; refresh the sidebar.
		if (props.db && results.value.some((r) => !r.columns)) loadTables(props.db, { force: true }).catch(() => {});
	} catch (e) {
		error.value = e.message;
		results.value = null;
	} finally {
		busy.value = false;
	}
}

function onKeydown(event) {
	if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
		event.preventDefault();
		run();
	}
}
</script>

<template>
	<template v-if="heading">
		<h1 class="mb-4 text-xl text-neutral-800">
			<template v-if="db">Database: <span class="font-semibold">{{ db }}</span></template>
			<template v-else>SQL</template>
		</h1>
		<TabBar v-if="db" :tabs="tabs" active="sql" />
	</template>

	<div class="grid gap-4 xl:grid-cols-[1fr_18rem]">
		<section class="panel overflow-hidden">
			<div class="panel-title">Run SQL query on {{ db ? `database “${db}”` : 'the server' }}</div>
			<div class="p-3">
				<div v-if="templates.length" class="mb-2 flex flex-wrap items-center gap-1">
					<span class="mr-1 text-xs text-neutral-500">Generate:</span>
					<button v-for="t in templates" :key="t.id" class="btn btn-sm font-mono" :title="`Write a ${t.label} statement for ${table.name}`" @click="generate(t)">{{ t.label }}</button>
				</div>
				<textarea
					ref="editor"
					v-model="sql"
					rows="9"
					class="input w-full resize-y font-mono text-[13px] leading-relaxed"
					spellcheck="false"
					placeholder="SELECT …"
					aria-label="SQL query"
					autofocus
					@keydown="onKeydown"
				/>
				<div class="mt-2 flex items-center gap-2">
					<button class="btn btn-primary" :disabled="busy || !sql.trim()" @click="run">{{ busy ? 'Running…' : 'Go' }}</button>
					<button class="btn" :disabled="!sql" @click="sql = ''">Clear</button>
					<span class="ml-auto text-xs text-neutral-500">Ctrl+Enter to run · separate statements with “;”</span>
				</div>
			</div>
		</section>
		<section class="panel self-start overflow-hidden">
			<div class="panel-title">History</div>
			<ul v-if="history.length" class="max-h-64 overflow-y-auto">
				<li v-for="(item, i) in history" :key="i" class="border-b border-neutral-200 last:border-0">
					<button class="block w-full truncate px-3 py-1.5 text-left font-mono text-xs hover:bg-white" :title="item" @click="sql = item">{{ item }}</button>
				</li>
			</ul>
			<p v-else class="px-3 py-2 text-neutral-500">Queries you run appear here.</p>
		</section>
	</div>

	<p v-if="error" class="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-2 text-red-800" role="alert">{{ error }}</p>

	<div v-if="results" class="mt-4 space-y-5">
		<section v-for="(r, i) in results" :key="i">
			<div
				class="mb-2 rounded-md border px-4 py-2"
				:class="r.error ? 'border-red-300 bg-red-50 text-red-800' : 'border-green-300 bg-green-50 text-green-900'"
			>
				<template v-if="r.error">Error: {{ r.error }}</template>
				<template v-else-if="r.columns">{{ plural(r.rows.length, 'row') }} returned (query took {{ formatSeconds(r.time) }})</template>
				<template v-else>{{ plural(r.affected, 'row') }} affected (query took {{ formatSeconds(r.time) }})</template>
				<code class="mt-1 block font-mono text-xs whitespace-pre-wrap opacity-80">{{ r.sql }}</code>
			</div>
			<ResultTable v-if="r.columns" :columns="r.columns" :rows="r.rows" />
		</section>
	</div>
</template>
