export function quoteIdent(driver, name) {
	return driver === 'mysql' ? '`' + name.replaceAll('`', '``') + '`' : '"' + name.replaceAll('"', '""') + '"';
}

/** Table name as you would type it in SQL (PostgreSQL's public schema is implied). */
export function qualifiedName(driver, table, schema) {
	return (schema && schema !== 'public' ? quoteIdent(driver, schema) + '.' : '') + quoteIdent(driver, table);
}

/** Display name: schema.table outside PostgreSQL's public schema. */
export function displayName(table, schema) {
	return schema && schema !== 'public' ? `${schema}.${table}` : table;
}

export function formatBytes(bytes) {
	if (bytes === null || bytes === undefined) return '';
	const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${unit ? value.toFixed(1) : value} ${units[unit]}`;
}

export function formatCount(value) {
	return value === null || value === undefined ? '' : Number(value).toLocaleString();
}

export function formatSeconds(ms) {
	return (ms / 1000).toFixed(4) + ' s';
}

export function plural(count, word) {
	return `${formatCount(count)} ${word}${count === 1 ? '' : 's'}`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", then the date. */
export function formatAgo(time, now = Date.now()) {
	const minutes = Math.round((now - time) / 60000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	const days = Math.round(hours / 24);
	if (days < 30) return days === 1 ? 'yesterday' : `${days} days ago`;
	return new Date(time).toLocaleDateString();
}
