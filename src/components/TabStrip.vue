<script setup>
import { displayName } from '../format.js';
import { link } from '../router.js';

defineProps({ tabs: Array, activeId: String });
defineEmits(['close']);
</script>

<template>
	<nav class="flex gap-1 overflow-x-auto border-b border-neutral-300 px-4 sm:px-6" aria-label="Open tables">
		<a
			v-for="t in tabs"
			:key="t.id"
			:href="link({ db: t.db, schema: t.schema, table: t.table, tab: t.view })"
			class="group -mb-px flex shrink-0 items-center gap-2 rounded-t-md border border-neutral-300 py-2 pl-4 pr-2 hover:no-underline"
			:class="t.id === activeId
				? 'border-b-white bg-white font-semibold text-brand'
				: 'bg-linear-to-b from-white to-neutral-200 text-neutral-700 hover:to-neutral-100 hover:text-brand'"
			:aria-current="t.id === activeId ? 'page' : undefined"
		>
			<span class="truncate">{{ displayName(t.table, t.schema) }}</span>
			<button
				type="button"
				class="shrink-0 rounded px-1 text-neutral-400 opacity-0 hover:bg-neutral-200 hover:text-neutral-800 group-hover:opacity-100"
				:class="{ 'opacity-100': t.id === activeId }"
				:aria-label="`Close ${displayName(t.table, t.schema)}`"
				@click.stop.prevent="$emit('close', t.id)"
			>×</button>
		</a>
	</nav>
</template>
