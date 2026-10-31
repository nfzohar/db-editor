// Bundles the server, the database drivers and the built single-file UI, for one or both targets:
//   --cli       dist/dbeditor.mjs, run with Node.js
//   --desktop   dist/desktop/, the Electron app for electron-builder to package
// With neither flag, both are built in parallel. Run after `vite build` (see the build scripts in package.json).
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const path = (file) => new URL(file, root).pathname;
const html = readFileSync(path('dist/web/index.html'), 'utf8');

const targets = {
	cli: { entry: 'server/main.js', outfile: 'dist/dbeditor.mjs', external: [] },
	desktop: { entry: 'desktop/main.js', outfile: 'dist/desktop/main.mjs', external: ['electron'], after: writeDesktopApp },
};

async function bundle({ entry, outfile, external, after }) {
	await build({
		entryPoints: [path(entry)],
		outfile: path(outfile),
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node22',
		minify: true,
		legalComments: 'none',
		define: { __DBEDITOR_HTML__: JSON.stringify(html) },
		// pg tries to load the optional native binding; the pure-JS client is used instead.
		external: ['pg-native', ...external],
		// mysql2 and pg are CommonJS and call require() for Node built-ins.
		banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
		logLevel: 'warning',
	});
	after?.();
	console.log(`${outfile}  ${(statSync(path(outfile)).size / 1024).toFixed(0)} KiB`);
}

/** The packaged app is just this folder: the bundle, its icon and a package.json naming the entry point. */
function writeDesktopApp() {
	const pkg = JSON.parse(readFileSync(path('package.json'), 'utf8'));
	mkdirSync(path('dist/desktop'), { recursive: true });
	copyFileSync(path('desktop/icon.png'), path('dist/desktop/icon.png'));
	writeFileSync(path('dist/desktop/package.json'), JSON.stringify({
		name: pkg.name, productName: 'DB Editor', version: pkg.version, description: pkg.description, main: 'main.mjs',
	}, null, '\t') + '\n');
}

const chosen = Object.keys(targets).filter((name) => process.argv.includes('--' + name));
await Promise.all((chosen.length ? chosen : Object.keys(targets)).map((name) => bundle(targets[name])));
