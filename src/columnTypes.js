// How the browse grid edits each column type: which editor to show, how a cell value becomes editor
// text and back, and what counts as valid. Type names come straight from the database
// (MySQL COLUMN_TYPE, PostgreSQL format_type, SQLite's declared type), so they are matched loosely.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}(:\d{2})?$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;
const INTEGER = /^[-+]?\d+$/;
const DECIMAL = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Classify a column: { kind, numeric, options?, maxLength?, unsigned? }.
 * kind is one of boolean, enum, integer, decimal, date, datetime, time, json, uuid, binary, text, string.
 */
export function columnKind(column, driver) {
	const type = String(column?.type ?? '').toLowerCase().trim();
	const base = { numeric: false };
	if (column?.enumValues?.length) return { ...base, kind: 'enum', options: column.enumValues };
	if (/blob|binary|bytea/.test(type)) return { ...base, kind: 'binary' };
	if (/^(bool|boolean)$/.test(type) || (driver === 'mysql' && /^tinyint\(1\)/.test(type))) return { ...base, kind: 'boolean' };
	if (/^((tiny|small|medium|big)?int(eger)?|int[248]|(small|big)?serial)\b/.test(type)) {
		return { kind: 'integer', numeric: true, unsigned: /\bunsigned\b/.test(type) };
	}
	if (/^(decimal|numeric|real|double|float)/.test(type)) return { kind: 'decimal', numeric: true, unsigned: /\bunsigned\b/.test(type) };
	if (/^date$/.test(type)) return { ...base, kind: 'date' };
	if (/^(datetime|timestamp)(\(\d+\))?( without time zone)?$/.test(type)) return { ...base, kind: 'datetime' };
	if (/^time(\(\d+\))?( without time zone)?$/.test(type)) return { ...base, kind: 'time' };
	if (/^jsonb?$/.test(type)) return { ...base, kind: 'json' };
	if (/^uuid$/.test(type)) return { ...base, kind: 'uuid' };
	// SQLite and PostgreSQL use TEXT for short strings too, so only MySQL's TEXT types are always multi-line.
	if (driver === 'mysql' && /text$/.test(type)) return { ...base, kind: 'text' };
	const length = /char(?:acter)?(?: varying)?\((\d+)\)/.exec(type);
	return { ...base, kind: 'string', maxLength: length ? Number(length[1]) : null };
}

/**
 * The editor for a cell: { input, text, options? }. input is select, textarea, or an <input> type
 * (text, date, time, datetime-local). Values the native pickers can't show fall back to plain text.
 */
export function toEditor(kind, value) {
	const text = value === null || value === undefined ? '' : String(value);
	const empty = value === null || value === undefined;
	switch (kind.kind) {
		case 'boolean':
			if (empty || typeof value === 'boolean' || value === 0 || value === 1 || text === '0' || text === '1') {
				return { input: 'select', options: ['true', 'false'], text: empty ? '' : value === true || text === '1' ? 'true' : 'false' };
			}
			break;
		case 'enum':
			return { input: 'select', options: kind.options, text };
		case 'date':
			if (empty || DATE.test(text)) return { input: 'date', text };
			break;
		case 'time':
			if (empty || TIME.test(text)) return { input: 'time', text };
			break;
		case 'datetime':
			if (empty || DATETIME.test(text)) return { input: 'datetime-local', text: text.replace(' ', 'T') };
			break;
		case 'json':
		case 'text':
			return { input: 'textarea', text };
	}
	return { input: text.length > 80 || text.includes('\n') ? 'textarea' : 'text', text };
}

/**
 * Turn editor text back into a value for the database: { value } or { error }.
 * `original` is the cell's loaded value, used to keep numbers numeric and booleans in the driver's form.
 */
export function fromEditor(kind, text, original, driver) {
	const trimmed = text.trim();
	switch (kind.kind) {
		case 'boolean':
			if (text === 'true' || text === 'false') {
				const on = text === 'true';
				return { value: driver === 'postgres' || typeof original === 'boolean' ? on : on ? 1 : 0 };
			}
			break; // a non-0/1 value edited as plain text
		case 'integer':
			if (!INTEGER.test(trimmed)) return { error: 'must be a whole number' };
			if (kind.unsigned && trimmed.startsWith('-') && Number(trimmed) !== 0) return { error: 'must be 0 or more' };
			return { value: Number.isSafeInteger(Number(trimmed)) ? Number(trimmed) : trimmed };
		case 'decimal':
			if (!DECIMAL.test(trimmed)) return { error: 'must be a number' };
			if (kind.unsigned && trimmed.startsWith('-') && Number(trimmed) !== 0) return { error: 'must be 0 or more' };
			// DECIMAL / NUMERIC arrive as exact strings; only float columns come back as numbers.
			return { value: typeof original === 'number' ? Number(trimmed) : trimmed };
		case 'date':
			return DATE.test(text) ? { value: text } : { error: 'must be a full date' };
		case 'time':
			return TIME.test(text) ? { value: withSeconds(text) } : { error: 'must be a full time' };
		case 'datetime':
			return DATETIME.test(text) ? { value: withSeconds(text.replace('T', ' ')) } : { error: 'must be a full date and time' };
		case 'json':
			try {
				JSON.parse(text);
			} catch (e) {
				return { error: 'is not valid JSON (' + e.message + ')' };
			}
			return { value: text };
		case 'uuid':
			return UUID.test(trimmed) ? { value: trimmed.toLowerCase() } : { error: 'must be a UUID like 123e4567-e89b-12d3-a456-426614174000' };
		case 'string':
			if (kind.maxLength && [...text].length > kind.maxLength) return { error: `is longer than ${kind.maxLength} characters` };
	}
	return { value: text };
}

// Native time pickers leave out :00 seconds; the database shows them, so put them back to compare equal.
function withSeconds(text) {
	return /\d{2}:\d{2}$/.test(text) && !/\d{2}:\d{2}:\d{2}$/.test(text) ? text + ':00' : text;
}
