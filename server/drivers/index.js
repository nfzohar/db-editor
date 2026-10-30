import { MysqlDriver } from './mysql.js';
import { PostgresDriver } from './postgres.js';
import { SqliteDriver, sqliteAvailable } from './sqlite.js';

export const drivers = {
	mysql: { label: 'MySQL / MariaDB', connect: (opts) => MysqlDriver.connect(opts), server: true, defaultPort: 3306 },
	postgres: { label: 'PostgreSQL', connect: (opts) => PostgresDriver.connect(opts), server: true, defaultPort: 5432 },
	sqlite: { label: 'SQLite', connect: (opts) => SqliteDriver.connect(opts), server: false, available: sqliteAvailable },
};
