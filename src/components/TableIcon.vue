<script setup>
defineProps({ view: Boolean });
</script>

<template>
	<svg viewBox="0 0 16 16" class="h-4 w-4 shrink-0" :class="view ? 'text-purple-500' : 'text-neutral-500'" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
		<path v-if="view" d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
		<path v-else d="M1.5 2.5h13v11h-13zM1.5 6h13M1.5 9.75h13M6 6v7.5" />
	</svg>
</template>
