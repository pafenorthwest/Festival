import { afterEach, describe, expect, it } from "bun:test";
import { loadEnv } from "../src/config/env.js";
import { SHOPIFY_ADMIN_AUDIT_PATH as DEFAULT_SHOPIFY_ADMIN_AUDIT_PATH } from "../src/shopify/admin-mutation-audit.js";

const originalShopifyAdminAuditPath = process.env.SHOPIFY_ADMIN_AUDIT_PATH;

function loadTestEnv() {
	return loadEnv({ requireDatabase: false, requireFirebaseAdmin: false });
}

afterEach(() => {
	if (originalShopifyAdminAuditPath === undefined) {
		delete process.env.SHOPIFY_ADMIN_AUDIT_PATH;
		return;
	}
	process.env.SHOPIFY_ADMIN_AUDIT_PATH = originalShopifyAdminAuditPath;
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
});
