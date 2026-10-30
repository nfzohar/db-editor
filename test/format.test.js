import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatAgo } from '../src/format.js';

test('formatAgo', () => {
	const now = Date.UTC(2026, 9, 30, 12);
	assert.equal(formatAgo(now - 20e3, now), 'just now');
	assert.equal(formatAgo(now - 5 * 60e3, now), '5 min ago');
	assert.equal(formatAgo(now - 3 * 3600e3, now), '3 h ago');
	assert.equal(formatAgo(now - 26 * 3600e3, now), 'yesterday');
	assert.equal(formatAgo(now - 5 * 86400e3, now), '5 days ago');
	assert.equal(formatAgo(now - 90 * 86400e3, now), new Date(now - 90 * 86400e3).toLocaleDateString());
});
