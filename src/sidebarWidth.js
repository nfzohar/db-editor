import { ref, watch } from 'vue';

// How wide the sidebar is, draggable by its edge handle and kept per browser.
const KEY = 'dbeditor.sidebarWidth';
const DEFAULT = 256; // the old w-64
export const MIN = 200;
export const MAX = 480;

const clamp = (w) => Math.min(MAX, Math.max(MIN, w));

function saved() {
	try {
		const value = Number(localStorage.getItem(KEY));
		return value > 0 ? clamp(value) : DEFAULT;
	} catch {
		return DEFAULT;
	}
}

export const sidebarWidth = ref(saved());

export function setSidebarWidth(w) {
	sidebarWidth.value = clamp(w);
}

watch(sidebarWidth, (w) => {
	try {
		localStorage.setItem(KEY, String(w));
	} catch {}
});
