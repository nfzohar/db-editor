<script setup>
import { computed } from 'vue';
import { link } from '../router.js';
import { store } from '../store.js';

const driverLabel = computed(() => store.drivers.find((d) => d.id === store.session.driver)?.label ?? store.session.driver);
const userDatabases = computed(() => store.databases.filter((d) => !d.system));
const systemDatabases = computed(() => store.databases.filter((d) => d.system));
</script>

<template>
	<h1 class="mb-4 text-xl text-neutral-800">Server</h1>
	<div class="grid gap-5 xl:grid-cols-[1fr_22rem]">
		<section class="panel overflow-hidden bg-white">
			<div class="panel-title">Databases</div>
			<table class="data-table w-full">
				<thead>
					<tr><th class="border-t-0 first:border-l-0">Database</th><th class="w-px border-t-0 border-r-0">Actions</th></tr>
				</thead>
				<tbody>
					<tr v-for="db in [...userDatabases, ...systemDatabases]" :key="db.name">
						<td class="first:border-l-0">
							<a :href="link({ db: db.name })" class="link font-medium" :class="{ 'text-neutral-500': db.system }">{{ db.name }}</a>
							<span v-if="db.system" class="ml-2 rounded bg-neutral-200 px-1.5 text-xs text-neutral-600">system</span>
						</td>
						<td class="border-r-0 whitespace-nowrap">
							<a :href="link({ db: db.name })" class="link mr-3">Tables</a>
							<a :href="link({ db: db.name, tab: 'sql' })" class="link">SQL</a>
						</td>
					</tr>
					<tr v-if="!store.databases.length"><td colspan="2" class="border-x-0 text-neutral-500">No databases.</td></tr>
				</tbody>
			</table>
		</section>
		<section class="panel self-start overflow-hidden">
			<div class="panel-title">Connection</div>
			<dl class="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 p-4">
				<dt class="text-neutral-500">System</dt><dd>{{ driverLabel }}</dd>
				<template v-if="store.session.file">
					<dt class="text-neutral-500">File</dt><dd class="font-mono text-xs break-all">{{ store.session.file }}</dd>
				</template>
				<template v-else>
					<dt class="text-neutral-500">Server</dt><dd class="break-all">{{ store.session.label }}</dd>
				</template>
				<dt class="text-neutral-500">Version</dt><dd class="break-all">{{ store.session.version }}</dd>
				<dt class="text-neutral-500">Databases</dt><dd>{{ store.databases.length }}</dd>
			</dl>
		</section>
	</div>
</template>
