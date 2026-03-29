export interface AppEnv {
	port: number;
	databaseUrl?: string;
	databaseSchema?: string;
	firebaseProjectId?: string;
	firebaseClientEmail?: string;
	firebasePrivateKey?: string;
}

function parseRequiredEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}

	return value;
}

function parseDatabaseSsl(value: string | undefined): string {
	const normalized = value?.trim().toLowerCase();
	if (!normalized || normalized === "false" || normalized === "0") {
		return "disable";
	}

	return "require";
}

export function buildDatabaseUrl(): string {
	const user = encodeURIComponent(parseRequiredEnv("DB_USER"));
	const password = encodeURIComponent(parseRequiredEnv("DB_PASSWORD"));
	const host = parseRequiredEnv("DB_HOST");
	const port = parseRequiredEnv("DB_PORT");
	const database = encodeURIComponent(parseRequiredEnv("DATABASE"));
	const sslmode = parseDatabaseSsl(process.env.DB_SSL);

	return `postgresql://${user}:${password}@${host}:${port}/${database}?sslmode=${sslmode}`;
}

export function loadEnv(options?: {
	requireDatabase?: boolean;
	requireFirebaseAdmin?: boolean;
}): AppEnv {
	const portRaw = process.env.PORT ?? "3000";
	const port = Number.parseInt(portRaw, 10);

	if (Number.isNaN(port) || port <= 0) {
		throw new Error(`Invalid PORT value: ${portRaw}`);
	}

	const requireDatabase = options?.requireDatabase ?? true;
	const requireFirebaseAdmin = options?.requireFirebaseAdmin ?? true;
	const databaseUrl = requireDatabase ? buildDatabaseUrl() : undefined;
	const databaseSchema = requireDatabase
		? parseRequiredEnv("DB_SCHEMA")
		: process.env.DB_SCHEMA?.trim();
	const firebaseProjectId = requireFirebaseAdmin
		? parseRequiredEnv("FIREBASE_PROJECT_ID")
		: process.env.FIREBASE_PROJECT_ID?.trim();

	return {
		port,
		databaseUrl,
		databaseSchema,
		firebaseProjectId,
		firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
		firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
	};
}
