<script setup>
import { store } from '../store.js';
</script>

<template>
	<div
		v-if="store.notice"
		class="mb-4 flex items-start gap-3 rounded-md border px-4 py-2"
		:class="store.notice.type === 'error' ? 'border-red-300 bg-red-50 text-red-800' : 'border-green-300 bg-green-50 text-green-800'"
		:role="store.notice.type === 'error' ? 'alert' : 'status'"
	>
		<div class="min-w-0 flex-1">
			<div>{{ store.notice.text }}</div>
			<code v-if="store.notice.sql" class="mt-1 block truncate font-mono text-xs opacity-80">{{ store.notice.sql }}</code>
		</div>
		<button class="opacity-60 hover:opacity-100" aria-label="Dismiss" @click="store.notice = null">✕</button>
	</div>
</template>
