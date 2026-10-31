// Desktop app: runs the server on this machine and shows the UI in an Electron window.
// Bundled into dist/desktop/main.mjs by scripts/bundle.mjs, then packaged by electron-builder (`yarn build:desktop`).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import { createApp } from '../server/app.js';

// The bundled build embeds the UI; when running from source, read the Vite build output.
const html = typeof __DBEDITOR_HTML__ !== 'undefined'
	? __DBEDITOR_HTML__
	: readFileSync(new URL('../dist/web/index.html', import.meta.url), 'utf8');

// Only this app's window may use the server: every request it makes carries a key generated at start-up,
// so other programs on the machine can't reach the databases through it.
const key = Buffer.from(randomBytes(32).toString('hex'));
const hasKey = (value) => typeof value === 'string' && value.length === key.length && timingSafeEqual(Buffer.from(value), key);

const handler = createApp({ html, allowSqlite: true });
const server = createServer((req, res) => {
	if (hasKey(req.headers['x-dbeditor-key'])) handler(req, res);
	else res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
});

/** Settings kept between runs, in the user's app data folder. */
const settingsFile = () => join(app.getPath('userData'), 'settings.json');
function readSettings() {
	try {
		return JSON.parse(readFileSync(settingsFile(), 'utf8'));
	} catch {
		return {};
	}
}

function listen(port) {
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, '127.0.0.1', () => {
			server.off('error', reject);
			resolve(server.address().port);
		});
	});
}

/**
 * Reuse the port from the last run when it is free. The page's saved connections, query history and theme
 * live in browser storage, which belongs to one origin, port included.
 */
async function start() {
	const settings = readSettings();
	const port = await listen(settings.port ?? 0).catch(() => listen(0));
	if (port !== settings.port) {
		try {
			writeFileSync(settingsFile(), JSON.stringify({ ...settings, port }));
		} catch {}
	}
	return `http://127.0.0.1:${port}`;
}

let window = null;

function openWindow(origin) {
	session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [origin + '/*'] }, (details, callback) => {
		callback({ requestHeaders: { ...details.requestHeaders, 'X-DBEditor-Key': key.toString() } });
	});
	window = new BrowserWindow({
		width: 1280,
		height: 820,
		title: 'DB Editor',
		icon: join(import.meta.dirname, 'icon.png'),
		autoHideMenuBar: true,
		webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
	});
	// The window only ever shows the app itself.
	window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
	window.webContents.on('will-navigate', (event, url) => {
		if (!url.startsWith(origin + '/')) event.preventDefault();
	});
	window.on('closed', () => (window = null));
	window.loadURL(origin + '/');
}

// Forms and tables gain nothing from the GPU, and some graphics drivers draw the CSS gradients in wrong colours.
app.disableHardwareAcceleration();

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on('second-instance', () => {
		if (window?.isMinimized()) window.restore();
		window?.focus();
	});
	app.whenReady().then(async () => openWindow(await start()));
	app.on('window-all-closed', async () => {
		server.close();
		await handler.close();
		app.quit();
	});
}
