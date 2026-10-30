// Bundles the server, the database drivers and the built single-file UI into dist/dbeditor.mjs.
// Run after `vite build` (see `npm run build`).
import { build } from 'esbuild';
import { readFileSync, statSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const html = readFileSync(new URL('dist/web/index.html', root), 'utf8');
const outfile = new URL('dist/dbeditor.mjs', root).pathname;

await build({
	entryPoints: [new URL('server/main.js', root).pathname],
	outfile,
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node22',
	minify: true,
	legalComments: 'none',
	define: { __DBEDITOR_HTML__: JSON.stringify(html) },
	// pg tries to load the optional native binding; the pure-JS client is used instead.
	external: ['pg-native'],
	// mysql2 and pg are CommonJS and call require() for Node built-ins.
	banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
	logLevel: 'warning',
});

console.log(`dist/dbeditor.mjs  ${(statSync(outfile).size / 1024).toFixed(0)} KiB`);
