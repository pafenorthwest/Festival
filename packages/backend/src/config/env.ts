export interface AppEnv {
	port: number;
	databaseUrl?: string;
	databaseSchema?: string;
	firebaseProjectId?: string;
	firebaseClientEmail?: string;
	firebasePrivateKey?: string;
	festivalSecretKeysJson?: string;
	festivalActiveSecretKeyId?: string;
	allowedApiOrigins?: string[];
	trustProxyHeaders?: boolean;
	publicOrigin?: string;
	customerSessionIdleDays?: number;
	customerSessionAbsoluteDays?: number;
}

const LOCAL_API_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const LOCAL_API_PORTS = [5172, 5173, 8080];

export const LOCAL_API_ORIGINS = LOCAL_API_HOSTS.flatMap((host) =>
	LOCAL_API_PORTS.map((port) => `http://${host}:${port}`),
);

function parseAllowedApiOrigins(value: string | undefined): string[] {
	if (!value?.trim()) {
		return LOCAL_API_ORIGINS;
	}

	return value
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
}

function parseRequiredEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}

	return value;
}

function parsePositiveNumber(name: string, fallback: number): number {
	const raw = process.env[name]?.trim();
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isFinite(value) || value <= 0)
		throw new Error(`Invalid ${name} value: ${raw}`);
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
		festivalSecretKeysJson: process.env.FESTIVAL_SECRET_KEYS_JSON?.trim(),
		festivalActiveSecretKeyId:
			process.env.FESTIVAL_ACTIVE_SECRET_KEY_ID?.trim(),
		allowedApiOrigins: parseAllowedApiOrigins(process.env.API_ALLOWED_ORIGINS),
		trustProxyHeaders: process.env.TRUST_PROXY_HEADERS === "true",
		publicOrigin: process.env.FESTIVAL_PUBLIC_ORIGIN?.trim(),
		customerSessionIdleDays: parsePositiveNumber(
			"CUSTOMER_SESSION_IDLE_DAYS",
			7,
		),
		customerSessionAbsoluteDays: parsePositiveNumber(
			"CUSTOMER_SESSION_ABSOLUTE_DAYS",
			30,
		),
	};
}
