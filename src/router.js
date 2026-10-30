import { reactive } from 'vue';
import { store } from './store.js';

/**
 * Tiny hash router. The URL looks like #/?db=shop&table=orders&tab=browse,
 * so every screen can be bookmarked and the back button works.
 */
export const route = reactive({});

function parse() {
	const params = new URLSearchParams(location.hash.replace(/^#\/?\??/, ''));
	for (const key of Object.keys(route)) delete route[key];
	for (const [key, value] of params) route[key] = value;
	if (store.notice && store.notice.type !== 'error' && store.notice.hash !== location.hash) store.notice = null; // errors stay until dismissed
}

window.addEventListener('hashchange', parse);
parse();

export function link(params = {}) {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null && value !== '') search.set(key, value);
	}
	const query = search.toString();
	return '#/' + (query ? '?' + query : '');
}

export function navigate(params) {
	location.hash = link(params);
}
