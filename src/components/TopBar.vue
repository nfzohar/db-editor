<script setup>
import { api } from '../api.js';
import { displayName } from '../format.js';
import { link, route } from '../router.js';
import { resetData, store } from '../store.js';
import { cycleTheme, theme } from '../theme.js';

const driverLabel = () => store.drivers.find((d) => d.id === store.session.driver)?.label ?? store.session.driver;

async function logout() {
	await api('logout', {}).catch(() => {});
	resetData();
	store.session = null;
	location.hash = '#/';
}
</script>

<template>
	<header class="sticky top-0 z-20 flex h-11 items-center gap-2 border-b border-neutral-300 bg-linear-to-b from-white to-neutral-200 px-3 text-neutral-600">
		<button class="rounded px-2 py-1 hover:bg-white lg:hidden" aria-label="Open navigation" @click="store.sidebarOpen = true">☰</button>
		<nav class="flex min-w-0 flex-1 items-center gap-1.5 truncate" aria-label="Breadcrumb">
			<a :href="link()" class="link truncate" :title="driverLabel()">{{ driverLabel() }}: {{ store.session.label }}</a>
			<template v-if="route.db">
				<span class="text-neutral-400">›</span>
				<a :href="link({ db: route.db })" class="link truncate">{{ route.db }}</a>
			</template>
			<template v-if="route.table">
				<span class="text-neutral-400">›</span>
				<span class="truncate font-medium text-neutral-800">{{ displayName(route.table, route.schema) }}</span>
			</template>
			<template v-else-if="route.tab === 'sql'">
				<span class="text-neutral-400">›</span>
				<span class="font-medium text-neutral-800">SQL</span>
			</template>
		</nav>
		<button class="btn btn-sm" :title="`Theme: ${theme.label} (click to change)`" :aria-label="`Theme: ${theme.label}`" @click="cycleTheme">{{ theme.icon }}<span class="hidden sm:inline">{{ theme.label }}</span></button>
		<button class="btn btn-sm" @click="logout">Log out</button>
	</header>
</template>
