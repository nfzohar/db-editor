// electron-builder hook (afterAllArtifactBuild, see electron-builder.yml): electron-builder works in dist/electron/,
// where it also leaves unpacked builds, logs and update block maps. This moves just the finished packages to
// release/, so that folder only holds the files to hand out. Packages of the same name are replaced.
import { mkdirSync, renameSync } from 'node:fs';
import { basename } from 'node:path';

const release = new URL('../release/', import.meta.url).pathname;

export default function collectRelease({ artifactPaths }) {
	mkdirSync(release, { recursive: true });
	for (const file of artifactPaths) {
		if (file.endsWith('.blockmap')) continue; // only used by auto-updates, which this app doesn't have
		renameSync(file, release + basename(file));
		console.log(`  • moved to release/  file=${basename(file)}`);
	}
	return [];
}
