import { computed, reactive } from 'vue';

// Light / dark / follow the system. The choice is kept per browser; index.html applies it before the first paint.
const KEY = 'dbeditor.theme';
const CHOICES = ['system', 'light', 'dark'];
const LABELS = { system: ['◐', 'System'], light: ['☀', 'Light'], dark: ['☾', 'Dark'] };
const systemDark = matchMedia('(prefers-color-scheme: dark)');

function saved() {
	try {
		const value = localStorage.getItem(KEY);
		return CHOICES.includes(value) ? value : 'system';
	} catch {
		return 'system';
	}
}

export const theme = reactive({
	choice: saved(),
	icon: computed(() => LABELS[theme.choice][0]),
	label: computed(() => LABELS[theme.choice][1]),
});

function apply() {
	document.documentElement.dataset.theme = theme.choice === 'system' ? (systemDark.matches ? 'dark' : 'light') : theme.choice;
}

export function cycleTheme() {
	theme.choice = CHOICES[(CHOICES.indexOf(theme.choice) + 1) % CHOICES.length];
	try {
		if (theme.choice === 'system') localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, theme.choice);
	} catch {}
	apply();
}

systemDark.addEventListener('change', apply);
apply();
