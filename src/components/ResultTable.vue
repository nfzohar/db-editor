<script setup>
import CellValue from './CellValue.vue';

defineProps({ columns: Array, rows: Array });
</script>

<template>
	<div class="max-h-[60vh] overflow-auto">
		<table class="data-table">
			<thead>
				<tr><th v-for="(column, i) in columns" :key="i">{{ column }}</th></tr>
			</thead>
			<tbody>
				<tr v-for="(row, r) in rows" :key="r">
					<td v-for="(value, c) in row" :key="c" :class="{ 'text-right': typeof value === 'number' }"><CellValue :value="value" /></td>
				</tr>
				<tr v-if="!rows.length"><td :colspan="columns.length || 1" class="text-neutral-500">No rows.</td></tr>
			</tbody>
		</table>
	</div>
</template>
