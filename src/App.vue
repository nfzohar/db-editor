<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from './api.js';
import AppSidebar from './components/AppSidebar.vue';
import DatabaseView from './components/DatabaseView.vue';
import LoginView from './components/LoginView.vue';
import NoticeBar from './components/NoticeBar.vue';
import ServerView from './components/ServerView.vue';
import SqlConsole from './components/SqlConsole.vue';
import TableView from './components/TableView.vue';
import TopBar from './components/TopBar.vue';
import { route } from './router.js';
import { store } from './store.js';

const checking = ref(true);

onMounted(async () => {
	try {
		const meta = await api('drivers');
		store.drivers = meta.drivers;
		store.session = await api('session');
	} catch {
		store.session = null;
	} finally {
		checking.value = false;
	}
});

// Re-create views when the target changes so each one loads fresh data.
const tableKey = computed(() => [route.db, route.schema, route.table].join('\u0000'));
</script>

<template>
	<div v-if="checking" class="flex min-h-screen items-center justify-center text-neutral-400">Loading…</div>
	<LoginView v-else-if="!store.session" />
	<div v-else class="min-h-screen">
		<AppSidebar />
		<div class="lg:pl-64">
			<TopBar />
			<main class="px-4 py-5 sm:px-6">
				<NoticeBar />
				<TableView v-if="route.table" :key="tableKey" />
				<SqlConsole v-else-if="route.tab === 'sql'" :key="'sql:' + (route.db || '')" :db="route.db || null" heading />
				<DatabaseView v-else-if="route.db" :key="'db:' + route.db" />
				<ServerView v-else />
			</main>
		</div>
	</div>
</template>
