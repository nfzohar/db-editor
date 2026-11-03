import { reactive, watch } from 'vue';

/**
 * Open table tabs: a browser-tab-like strip above the table view. Each tab tracks which table
 * it shows and which sub-view (browse/structure/sql/alter) it's on; the grid's live state
 * (filters, sort, pending edits) lives only in the tab's own persistent TableView/BrowseTab
 * instance (kept mounted via v-show in App.vue), never here.
 */
export const tabState = reactive({
	tabs: [], // ordered array, display order = strip order
	activeId: null, // id of the active tab, or null while a singleton view (Home/db/SQL) is showing
});

const KEY = 'dbeditor.tabs';

export function tabKey({ db, schema, table }) {
	return JSON.stringify([db, schema || null, table]);
}

export function findTabById(id) {
	return tabState.tabs.find((t) => t.id === id);
}

export function findTab(target) {
	return findTabById(tabKey(target));
}

/** Finds-or-creates a tab for the target and makes it active. An existing tab keeps its own view. */
export function openTab({ db, schema, table, view = 'browse' }) {
	const existing = findTab({ db, schema, table });
	if (existing) {
		tabState.activeId = existing.id;
		return existing;
	}
	const tab = { id: tabKey({ db, schema, table }), db, schema: schema || null, table, view };
	tabState.tabs.push(tab);
	tabState.activeId = tab.id;
	return tab;
}

/** Removes a tab; if it was active, activates its left neighbor (or the new first tab). */
export function closeTab(id) {
	const index = tabState.tabs.findIndex((t) => t.id === id);
	if (index === -1) return undefined;
	const [closed] = tabState.tabs.splice(index, 1);
	if (tabState.activeId === id) {
		const neighbor = tabState.tabs[index - 1] ?? tabState.tabs[index];
		tabState.activeId = neighbor?.id ?? null;
	}
	return closed;
}

export function setView(id, view) {
	const tab = findTabById(id);
	if (tab) tab.view = view;
}

/** Rename-flow primitive: re-identifies a tab in place (keeping its position in the strip). */
export function retarget(id, { db, schema, table }, view) {
	const tab = findTabById(id);
	if (!tab) return;
	const newId = tabKey({ db, schema, table });
	if (newId !== id) {
		const collision = findTabById(newId);
		if (collision) closeTab(collision.id);
	}
	tab.id = newId;
	tab.db = db;
	tab.schema = schema || null;
	tab.table = table;
	if (view !== undefined) tab.view = view;
	if (tabState.activeId === id) tabState.activeId = newId;
}

function restore() {
	try {
		const data = JSON.parse(localStorage.getItem(KEY));
		const tabs = (data?.tabs ?? [])
			.filter((t) => t && typeof t.db === 'string' && typeof t.table === 'string')
			.map((t) => ({ id: tabKey(t), db: t.db, schema: t.schema || null, table: t.table, view: t.view || 'browse' }));
		tabState.tabs = tabs;
		tabState.activeId = tabs.some((t) => t.id === data?.activeId) ? data.activeId : null;
	} catch {
		// corrupt or missing storage: start with no open tabs
	}
}
restore();

watch(
	tabState,
	() => {
		try {
			const tabs = tabState.tabs.map(({ db, schema, table, view }) => ({ db, schema, table, view }));
			localStorage.setItem(KEY, JSON.stringify({ tabs, activeId: tabState.activeId }));
		} catch {
			// storage unavailable or full: open tabs just won't survive a reload
		}
	},
	{ deep: true },
);
