// Connection URIs as cloud consoles and other tools hand them out, read into the login form's fields:
//   postgres://user:password@host:5432/db?sslmode=require   (also postgresql://)
//   mysql://user:password@host:3306/db?ssl-mode=REQUIRED     (also mariadb://)
//   sqlite:///path/to/file.db

const DRIVERS = { postgres: 'postgres', postgresql: 'postgres', mysql: 'mysql', mariadb: 'mysql', sqlite: 'sqlite', sqlite3: 'sqlite' };

// libpq's sslmode and MySQL's ssl-mode values, as the form's SSL setting ('' off, 'require', 'verify').
const SSL_MODES = {
	disable: '', allow: '', prefer: '', require: 'require', 'verify-ca': 'verify', 'verify-full': 'verify',
	disabled: '', preferred: '', required: 'require', verify_ca: 'verify', verify_identity: 'verify',
};

const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;

function decode(text) {
	try {
		return decodeURIComponent(text);
	} catch {
		return text;
	}
}

/**
 * The form fields for a connection URI. Throws an Error with a message for the user when it can't be read.
 * `masked` is set when the credentials are a console's hidden-password placeholder (Aiven shows
 * CLICK_TO:REVEAL_PASSWORD until the password is revealed); user and password are then left empty.
 */
export function parseConnectionUri(text) {
	const uri = String(text).trim();
	const driver = DRIVERS[SCHEME.exec(uri)?.[1].toLowerCase()];
	if (!driver) throw new Error('Use a postgres://, mysql:// or sqlite:// URL.');
	let url;
	try {
		url = new URL(uri);
	} catch {
		throw new Error('This URL could not be read.');
	}

	if (driver === 'sqlite') {
		// sqlite:///abs/path, sqlite://relative/path, sqlite:///C:/path on Windows
		const file = decode(url.host + url.pathname).replace(/^\/([A-Za-z]:[\\/])/, '$1');
		if (!file) throw new Error('The URL has no database file path.');
		return { driver, file };
	}

	const params = url.searchParams;
	const mode = (params.get('sslmode') ?? params.get('ssl-mode') ?? params.get('ssl_mode') ?? '').toLowerCase();
	if (mode && !(mode in SSL_MODES)) throw new Error(`Unknown SSL mode in the URL: ${mode}`);
	const ssl = mode ? SSL_MODES[mode] : /^(true|1|required?)$/i.test(params.get('ssl') ?? '') ? 'require' : '';

	const user = decode(url.username);
	const password = decode(url.password);
	const masked = /^click_to$/i.test(user) && /^reveal_password$/i.test(password);
	return {
		driver,
		host: url.hostname.replace(/^\[(.*)\]$/, '$1'), // IPv6 addresses come in brackets
		port: url.port,
		user: masked ? '' : user,
		password: masked ? '' : password,
		database: decode(url.pathname.replace(/^\//, '')),
		ssl,
		masked,
	};
}
