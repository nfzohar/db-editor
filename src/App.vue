<script setup>
import { onMounted, ref, watch } from 'vue';
import { api } from './api.js';
import AppSidebar from './components/AppSidebar.vue';
import DatabaseView from './components/DatabaseView.vue';
import LoginView from './components/LoginView.vue';
import NoticeBar from './components/NoticeBar.vue';
import ServerView from './components/ServerView.vue';
import SqlConsole from './components/SqlConsole.vue';
import TableView from './components/TableView.vue';
import TabStrip from './components/TabStrip.vue';
import TopBar from './components/TopBar.vue';
import { navigate, route } from './router.js';
import { sidebarWidth } from './sidebarWidth.js';
import { store } from './store.js';
import { closeTab, openTab, setView, tabKey, tabState } from './tabs.js';

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

// Keep the open tabs in sync with the URL: a table in the hash is always reflected by a tab
// (opening or re-activating one as needed). Navigating away from a table (Home/db/SQL) just
// hides the table views without closing their tabs, like a browser's new-tab page.
watch(
	() => [route.db, route.schema, route.table, route.tab],
	() => {
		if (!route.table) {
			tabState.activeId = null;
			return;
		}
		const target = { db: route.db, schema: route.schema || null, table: route.table };
		const view = route.tab || 'browse';
		if (tabKey(target) === tabState.activeId) setView(tabState.activeId, view);
		else openTab({ ...target, view });
	},
	{ immediate: true },
);

const tableViewRefs = new Map();
function setTableViewRef(id, el) {
	if (el) tableViewRefs.set(id, el);
	else tableViewRefs.delete(id);
}

function requestClose(id) {
	if (tableViewRefs.get(id)?.discardChanges?.() === false) return;
	const closed = closeTab(id);
	const next = tabState.tabs.find((t) => t.id === tabState.activeId);
	if (next) navigate({ db: next.db, schema: next.schema, table: next.table, tab: next.view });
	else if (closed) navigate({ db: closed.db });
}
</script>

<template>
	<div v-if="checking" class="flex min-h-screen items-center justify-center text-neutral-400">Loading…</div>
	<LoginView v-else-if="!store.session" />
	<div v-else class="min-h-dvh">
		<AppSidebar />
		<div class="flex h-dvh flex-col lg:pl-(--sidebar-w)" :style="{ '--sidebar-w': sidebarWidth + 'px' }">
			<TopBar class="shrink-0" />
			<TabStrip v-if="tabState.tabs.length" class="shrink-0" :tabs="tabState.tabs" :active-id="tabState.activeId" @close="requestClose" />
			<main class="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-5 sm:px-6">
				<NoticeBar />
				<TableView
					v-for="t in tabState.tabs"
					:key="t.id"
					v-show="t.id === tabState.activeId"
					class="flex min-h-0 flex-1 flex-col"
					:tab="t"
					:ref="(el) => setTableViewRef(t.id, el)"
				/>
				<template v-if="!tabState.activeId">
					<SqlConsole v-if="route.tab === 'sql'" :key="'sql:' + (route.db || '')" :db="route.db || null" heading />
					<DatabaseView v-else-if="route.db" :key="'db:' + route.db" />
					<ServerView v-else />
				</template>
			</main>
		</div>
	</div>
</template>
