<script setup>
import { computed, nextTick, reactive, ref } from 'vue';
import { api } from '../api.js';
import { formatAgo } from '../format.js';
import { resetData, store } from '../store.js';
import AppLogo from './AppLogo.vue';

// Connections that logged in successfully, newest first, kept per browser. Passwords are never stored.
const CONNECTIONS_KEY = 'dbeditor.connections';
const OLD_LOGIN_KEY = 'dbeditor.login'; // the single remembered form from before this list existed
const MAX_CONNECTIONS = 10;
const SERVER_FIELDS = ['host', 'port', 'user', 'database', 'ssl'];

function readJson(key) {
	try {
		return JSON.parse(localStorage.getItem(key));
	} catch {
		return null;
	}
}

/** Just the fields that matter for the connection's system, plus when it was last used. */
function toConnection(source, lastUsed = Date.now()) {
	const server = store.drivers.find((d) => d.id === source.driver)?.server ?? source.driver !== 'sqlite';
	const fields = server ? SERVER_FIELDS : ['file'];
	return { driver: source.driver, ...Object.fromEntries(fields.map((f) => [f, source[f] ?? ''])), lastUsed };
}

// The same server, user and database (or the same file) is one entry, whatever its SSL setting.
const identity = (c) => JSON.stringify(['driver', 'host', 'port', 'user', 'database', 'file'].map((f) => c[f] ?? ''));

function loadConnections() {
	const list = readJson(CONNECTIONS_KEY);
	if (Array.isArray(list)) return list;
	const old = readJson(OLD_LOGIN_KEY);
	return old?.driver ? [toConnection(old, 0)] : [];
}

const connections = ref(loadConnections());
const blank = { driver: 'mysql', host: '', port: '', user: '', password: '', database: '', ssl: '', file: '' };
const form = reactive({ ...blank }); // starts empty; pick a previous connection to fill it
const error = ref('');
const busy = ref(false);
const showPassword = ref(false);
const passwordInput = ref(null);
const submitButton = ref(null);

const driver = computed(() => store.drivers.find((d) => d.id === form.driver));
const current = computed(() => identity(form));

function saveConnections(list) {
	connections.value = list;
	try {
		localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(list));
		localStorage.removeItem(OLD_LOGIN_KEY);
	} catch {}
}

function remember() {
	const entry = toConnection(form);
	saveConnections([entry, ...connections.value.filter((c) => identity(c) !== identity(entry))].slice(0, MAX_CONNECTIONS));
}

function forget(connection) {
	saveConnections(connections.value.filter((c) => c !== connection));
}

/** Fill the form from a previous connection, then go to the password (or the button, for SQLite). */
function use(connection) {
	const { lastUsed, ...fields } = connection;
	Object.assign(form, blank, fields);
	error.value = '';
	nextTick(() => (passwordInput.value ?? submitButton.value)?.focus());
}

function title(c) {
	if (c.driver === 'sqlite') return c.file.split(/[\\/]/).pop() || c.file;
	return `${c.user || '(no user)'}@${c.host || 'localhost'}${c.port ? ':' + c.port : ''}${c.database ? ' / ' + c.database : ''}`;
}

function subtitle(c) {
	const label = store.drivers.find((d) => d.id === c.driver)?.label ?? c.driver;
	return [label, c.driver === 'sqlite' ? c.file : '', c.ssl ? 'SSL' : '', c.lastUsed ? formatAgo(c.lastUsed) : ''].filter(Boolean).join(' · ');
}

async function submit() {
	error.value = '';
	busy.value = true;
	try {
		const session = await api('login', { ...form });
		remember();
		form.password = '';
		resetData();
		store.session = session;
	} catch (e) {
		error.value = e.message;
	} finally {
		busy.value = false;
	}
}
</script>

<template>
	<div class="flex min-h-screen items-start justify-center bg-neutral-100 px-4 pt-[12vh]">
		<div class="w-full max-w-xl pb-10">
			<form @submit.prevent="submit">
				<div class="mb-5 flex justify-center"><AppLogo class="text-2xl" /></div>
				<div class="overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-md">
					<div class="panel-title">Log in</div>
					<div class="space-y-3 p-5">
						<p v-if="error" class="rounded border border-red-300 bg-red-50 px-3 py-2 text-red-800" role="alert">{{ error }}</p>

						<label class="grid grid-cols-[7rem_1fr] items-center gap-3">
							<span class="text-neutral-600">System</span>
							<select v-model="form.driver" class="input">
								<option v-for="d in store.drivers" :key="d.id" :value="d.id" :disabled="!d.available">
									{{ d.label }}{{ d.available ? '' : ' (unavailable)' }}
								</option>
							</select>
						</label>

						<template v-if="driver?.server !== false">
							<div class="grid grid-cols-[7rem_1fr] items-center gap-3">
								<label for="host" class="text-neutral-600">Server</label>
								<div class="flex gap-2">
									<input id="host" v-model="form.host" class="input min-w-0 flex-1" placeholder="localhost" autocapitalize="off" spellcheck="false">
									<input v-model="form.port" class="input w-20" :placeholder="String(driver?.defaultPort ?? '')" inputmode="numeric" aria-label="Port">
								</div>
							</div>
							<label class="grid grid-cols-[7rem_1fr] items-center gap-3">
								<span class="text-neutral-600">Username</span>
								<input v-model="form.user" class="input" autocomplete="username" autocapitalize="off" spellcheck="false" autofocus>
							</label>
							<div class="grid grid-cols-[7rem_1fr] items-center gap-3">
								<label for="password" class="text-neutral-600">Password</label>
								<div class="relative">
									<input id="password" ref="passwordInput" v-model="form.password" :type="showPassword ? 'text' : 'password'" class="input w-full pr-10" autocomplete="current-password" autocapitalize="off" spellcheck="false">
									<button
										type="button"
										class="absolute inset-y-0 right-0 flex w-9 cursor-pointer items-center justify-center rounded-r text-neutral-500 hover:text-brand"
										:aria-label="showPassword ? 'Hide password' : 'Show password'"
										:title="showPassword ? 'Hide password' : 'Show password'"
										:aria-pressed="showPassword"
										@click="showPassword = !showPassword"
									>
										<svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
											<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
											<circle cx="12" cy="12" r="3" />
											<path v-if="showPassword" d="M3 3l18 18" />
										</svg>
									</button>
								</div>
							</div>
							<label class="grid grid-cols-[7rem_1fr] items-center gap-3">
								<span class="text-neutral-600">Database</span>
								<input v-model="form.database" class="input" :placeholder="form.driver === 'postgres' ? 'postgres' : 'optional'" autocapitalize="off" spellcheck="false">
							</label>
							<label class="grid grid-cols-[7rem_1fr] items-center gap-3">
								<span class="text-neutral-600">SSL</span>
								<select v-model="form.ssl" class="input">
									<option value="">Off</option>
									<option value="require">Required (don't verify certificate)</option>
									<option value="verify">Required, verify certificate</option>
								</select>
							</label>
						</template>
						<label v-else class="grid grid-cols-[7rem_1fr] items-center gap-3">
							<span class="text-neutral-600">Database file</span>
							<input v-model="form.file" class="input font-mono" placeholder="/path/to/database.sqlite" autocapitalize="off" spellcheck="false">
						</label>
					</div>
					<div class="flex items-center justify-end gap-3 border-t border-neutral-200 bg-neutral-50 px-5 py-3">
						<button ref="submitButton" class="btn btn-primary" :disabled="busy">{{ busy ? 'Connecting…' : 'Log in' }}</button>
					</div>
				</div>
			</form>

			<section v-if="connections.length" class="mt-6 overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-sm" aria-labelledby="previous-connections">
				<div id="previous-connections" class="panel-title">Previous connections</div>
				<ul>
					<li v-for="c in connections" :key="identity(c)" class="flex items-stretch border-b border-neutral-200 last:border-b-0" :class="{ 'bg-brand-light/60': identity(c) === current }">
						<button
							type="button"
							class="min-w-0 flex-1 cursor-pointer px-4 py-2.5 text-left hover:bg-brand-light"
								:title="'Fill in the form with ' + title(c)"
							@click="use(c)"
						>
							<span class="block truncate font-medium text-neutral-800">{{ title(c) }}</span>
							<span class="block truncate text-xs text-neutral-500">{{ subtitle(c) }}</span>
						</button>
						<button type="button" class="cursor-pointer px-4 text-neutral-400 hover:text-red-700" :title="'Forget ' + title(c)" :aria-label="'Forget ' + title(c)" @click="forget(c)">✕</button>
					</li>
				</ul>
				<p class="border-t border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-500">Saved in this browser without passwords.</p>
			</section>
		</div>
	</div>
</template>
