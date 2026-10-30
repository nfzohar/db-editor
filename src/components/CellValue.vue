<script setup>
defineProps({ value: null });
</script>

<template>
	<span v-if="value === null" class="text-neutral-400 italic">NULL</span>
	<span v-else-if="typeof value === 'number'" class="tabular-nums">{{ value }}</span>
	<span v-else-if="typeof value === 'boolean'">{{ value ? 'true' : 'false' }}</span>
	<span v-else class="block max-w-md truncate" :title="String(value).length > 60 ? String(value) : undefined">{{ value }}</span>
</template>
