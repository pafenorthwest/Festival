import { afterEach, describe, expect, it } from "bun:test";
import {
	buildDatabaseUrl,
	loadEnv,
	parseDatabasePoolMax,
} from "../src/config/env.js";
import { SHOPIFY_ADMIN_AUDIT_PATH as DEFAULT_SHOPIFY_ADMIN_AUDIT_PATH } from "../src/shopify/admin-mutation-audit.js";

const originalShopifyAdminAuditPath = process.env.SHOPIFY_ADMIN_AUDIT_PATH;
const originalTenantReconcileTokens =
	process.env.FESTIVAL_TENANT_RECONCILIATION_TOKENS_JSON;
const originalDbUser = process.env.DB_USER;
const originalDbPassword = process.env.DB_PASSWORD;
const originalDbHost = process.env.DB_HOST;
const originalDbPort = process.env.DB_PORT;
const originalDatabase = process.env.DATABASE;
const originalDbSsl = process.env.DB_SSL;
const originalDbPoolMax = process.env.DB_POOL_MAX;

function restoreEnv(key: string, value: string | undefined) {
	if (value === undefined) {
		delete process.env[key];
	} else {
		process.env[key] = value;
	}
}

function loadTestEnv() {
	return loadEnv({ requireDatabase: false, requireFirebaseAdmin: false });
}

afterEach(() => {
	restoreEnv("SHOPIFY_ADMIN_AUDIT_PATH", originalShopifyAdminAuditPath);
	restoreEnv(
		"FESTIVAL_TENANT_RECONCILIATION_TOKENS_JSON",
		originalTenantReconcileTokens,
	);
	restoreEnv("DB_USER", originalDbUser);
	restoreEnv("DB_PASSWORD", originalDbPassword);
	restoreEnv("DB_HOST", originalDbHost);
	restoreEnv("DB_PORT", originalDbPort);
	restoreEnv("DATABASE", originalDatabase);
	restoreEnv("DB_SSL", originalDbSsl);
	restoreEnv("DB_POOL_MAX", originalDbPoolMax);
});

describe("loadEnv Shopify mutation audit path", () => {
	it("uses the production default when the override is unset or blank", () => {
		delete process.env.SHOPIFY_ADMIN_AUDIT_PATH;
		expect(loadTestEnv().shopifyAdminAuditPath).toBe(
			DEFAULT_SHOPIFY_ADMIN_AUDIT_PATH,
		);

		process.env.SHOPIFY_ADMIN_AUDIT_PATH = "   ";
		expect(loadTestEnv().shopifyAdminAuditPath).toBe(
			DEFAULT_SHOPIFY_ADMIN_AUDIT_PATH,
		);
	});

	it("uses a trimmed absolute override", () => {
		process.env.SHOPIFY_ADMIN_AUDIT_PATH =
			"  /tmp/festival-shopify-admin-audit.ndjson  ";

		expect(loadTestEnv().shopifyAdminAuditPath).toBe(
			"/tmp/festival-shopify-admin-audit.ndjson",
		);
	});

	it("rejects a relative override at startup", () => {
		process.env.SHOPIFY_ADMIN_AUDIT_PATH = "audit.ndjson";

		expect(loadTestEnv).toThrow(
			"Invalid SHOPIFY_ADMIN_AUDIT_PATH: expected an absolute file path.",
		);
	});

	it("rejects an override containing a NUL byte at startup", () => {
		process.env.SHOPIFY_ADMIN_AUDIT_PATH =
			"/tmp/festival-shopify-admin-audit.ndjson\0unexpected";

		expect(loadTestEnv).toThrow(
			"Invalid SHOPIFY_ADMIN_AUDIT_PATH: expected an absolute file path.",
		);
	});

	it("parses valid tenant reconciliation tokens and rejects malformed entries", () => {
		process.env.FESTIVAL_TENANT_RECONCILIATION_TOKENS_JSON = JSON.stringify({
			"org-1": " token-1 ",
		});
		expect(loadTestEnv().tenantReconciliationTokens).toEqual({
			"org-1": "token-1",
		});

		process.env.FESTIVAL_TENANT_RECONCILIATION_TOKENS_JSON = "not-json";
		expect(loadTestEnv).toThrow(
			"Invalid FESTIVAL_TENANT_RECONCILIATION_TOKENS_JSON: expected a JSON object.",
		);

		process.env.FESTIVAL_TENANT_RECONCILIATION_TOKENS_JSON = JSON.stringify({
			"org-1": "   ",
		});
		expect(loadTestEnv).toThrow(
			"Invalid FESTIVAL_TENANT_RECONCILIATION_TOKENS_JSON: entries must map organizationId to non-empty token.",
		);
	});
});

describe("parseDatabasePoolMax", () => {
	it("returns undefined for undefined or whitespace values", () => {
		expect(parseDatabasePoolMax(undefined)).toBeUndefined();
		expect(parseDatabasePoolMax("")).toBeUndefined();
		expect(parseDatabasePoolMax("   ")).toBeUndefined();
	});

	it("parses valid positive integer strings", () => {
		expect(parseDatabasePoolMax("80")).toBe(80);
		expect(parseDatabasePoolMax(" 50 ")).toBe(50);
		expect(parseDatabasePoolMax("1")).toBe(1);
	});

	it("rejects non-positive numbers and non-integers", () => {
		expect(() => parseDatabasePoolMax("0")).toThrow(
			"Invalid DB_POOL_MAX value: 0",
		);
		expect(() => parseDatabasePoolMax("-5")).toThrow(
			"Invalid DB_POOL_MAX value: -5",
		);
		expect(() => parseDatabasePoolMax("12.5")).toThrow(
			"Invalid DB_POOL_MAX value: 12.5",
		);
		expect(() => parseDatabasePoolMax("invalid")).toThrow(
			"Invalid DB_POOL_MAX value: invalid",
		);
	});
});

describe("buildDatabaseUrl", () => {
	function setDbEnv() {
		process.env.DB_USER = "testuser";
		process.env.DB_PASSWORD = "testpassword";
		process.env.DB_HOST = "localhost";
		process.env.DB_PORT = "5432";
		process.env.DATABASE = "testdb";
		process.env.DB_SSL = "false";
	}

	it("defaults max connection pool size to 80 when DB_POOL_MAX is unset", () => {
		setDbEnv();
		delete process.env.DB_POOL_MAX;

		expect(buildDatabaseUrl()).toBe(
			"postgresql://testuser:testpassword@localhost:5432/testdb?sslmode=disable&max=80",
		);
	});

	it("appends configured max connection pool size from DB_POOL_MAX", () => {
		setDbEnv();
		process.env.DB_POOL_MAX = "40";

		expect(buildDatabaseUrl()).toBe(
			"postgresql://testuser:testpassword@localhost:5432/testdb?sslmode=disable&max=40",
		);
	});

	it("rejects invalid DB_POOL_MAX values", () => {
		setDbEnv();
		process.env.DB_POOL_MAX = "not-a-number";

		expect(buildDatabaseUrl).toThrow("Invalid DB_POOL_MAX value: not-a-number");
	});
});
