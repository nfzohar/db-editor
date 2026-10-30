import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { createApp } from './server/app.js';

/** In development the API runs inside the Vite dev server, so one `npm run dev` is enough. */
function devApi() {
	return {
		name: 'dbeditor-dev-api',
		configureServer(server) {
			const app = createApp();
			server.middlewares.use((req, res, next) => app(req, res, next));
			server.httpServer?.on('close', () => app.close());
		},
	};
}

export default defineConfig({
	plugins: [vue(), tailwindcss(), viteSingleFile(), devApi()],
	build: {
		outDir: 'dist/web',
		emptyOutDir: true,
	},
	server: {
		host: '127.0.0.1',
	},
});
