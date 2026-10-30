#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { createApp } from './app.js';

// node:sqlite still prints an "experimental" warning on first use; it is noise for users of this tool.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
	if (!String(warning).includes('SQLite is an experimental feature')) emitWarning.call(process, warning, ...rest);
};

const { values: args } = parseArgs({
	options: {
		host: { type: 'string', default: '127.0.0.1' },
		port: { type: 'string', default: '8080' },
		'allow-sqlite': { type: 'boolean', default: false },
		help: { type: 'boolean', short: 'h', default: false },
	},
});

if (args.help) {
	console.log(`Usage: node dbeditor.mjs [--host 127.0.0.1] [--port 8080] [--allow-sqlite]

  --host           Address to listen on. Defaults to 127.0.0.1 (this machine only).
  --port           Port to listen on. Defaults to 8080.
  --allow-sqlite   Allow SQLite when listening on a non-local address. SQLite opens
                   files on this machine, so it is only enabled by default on 127.0.0.1.`);
	process.exit(0);
}

// The bundled build embeds the UI; when running from source, read the Vite build output.
const html = typeof __DBEDITOR_HTML__ !== 'undefined'
	? __DBEDITOR_HTML__
	: readFileSync(new URL('../dist/web/index.html', import.meta.url), 'utf8');

const local = ['127.0.0.1', 'localhost', '::1'].includes(args.host);
const app = createApp({ html, allowSqlite: local || args['allow-sqlite'] });
const server = createServer((req, res) => app(req, res));

server.listen(Number(args.port), args.host, () => {
	const shownHost = args.host.includes(':') ? `[${args.host}]` : args.host;
	console.log(`DB Editor running at http://${shownHost}:${args.port}/`);
	if (!local) console.warn('Warning: listening on a non-local address. Anyone who can reach this port can try to log in to your databases.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, async () => {
		server.close();
		await app.close();
		process.exit(0);
	});
}
