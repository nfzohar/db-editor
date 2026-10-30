<script setup>
defineProps({ tabs: Array, active: String });
</script>

<template>
	<nav class="mb-5 flex flex-wrap items-end gap-1 border-b border-neutral-300" aria-label="Views">
		<a
			v-for="tab in tabs"
			:key="tab.id"
			:href="tab.href"
			class="-mb-px rounded-t-md border border-neutral-300 px-4 py-2 hover:no-underline"
			:class="tab.id === active
				? 'border-b-white bg-white font-semibold text-brand'
				: 'bg-linear-to-b from-white to-neutral-200 text-neutral-700 hover:to-neutral-100 hover:text-brand'"
			:aria-current="tab.id === active ? 'page' : undefined"
		>{{ tab.label }}</a>
	</nav>
</template>
