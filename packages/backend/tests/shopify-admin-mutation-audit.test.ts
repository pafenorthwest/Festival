import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileShopifyMutationAuditWriter } from "../src/shopify/admin-mutation-audit.js";

const temporaryDirectories: string[] = [];
const ORGANIZATION_ID = "123e4567-e89b-12d3-a456-426614174000";
const AUDIT_ATTEMPT = {
	timestampIso: "2026-08-12T12:00:00.000Z",
	firebaseActorUid: "firebase-user-1",
	organizationId: ORGANIZATION_ID,
	operation: "productCreate" as const,
};

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) {
		await rm(directory, { recursive: true, force: true });
	}
});

async function temporaryAuditPath() {
	const directory = await mkdtemp(join(tmpdir(), "festival-shopify-audit-"));
	temporaryDirectories.push(directory);
	return join(directory, "audit.ndjson");
}

describe("FileShopifyMutationAuditWriter", () => {
	it("appends exactly one bounded closed-schema NDJSON record", async () => {
		const path = await temporaryAuditPath();
		const writer = new FileShopifyMutationAuditWriter(path);
		await writer.ensureReady(AUDIT_ATTEMPT);
		await writer.append({
			...AUDIT_ATTEMPT,
			requestId: "shopify-request-1",
			result: "success",
			...({
				clientSecret: "client-secret-canary",
				accessToken: "access-token-canary",
				rawError: "raw-error-canary",
			} as object),
		});

		const contents = await readFile(path, "utf8");
		expect(contents.split("\n").filter(Boolean)).toHaveLength(1);
		expect(JSON.parse(contents)).toEqual({
			...AUDIT_ATTEMPT,
			requestId: "shopify-request-1",
			result: "success",
		});
		expect(contents).not.toContain("canary");
	});

	it("preserves every valid Firebase UID character within the 128-character limit", async () => {
		const path = await temporaryAuditPath();
		const writer = new FileShopifyMutationAuditWriter(path);
		const firebaseActorUid = "\u0000".repeat(128);
		const attempt = { ...AUDIT_ATTEMPT, firebaseActorUid };

		await writer.ensureReady(attempt);
		await writer.append({
			...attempt,
			requestId: "r".repeat(128),
			result: "failure",
			failureCategory: "shop_ownership_conflict",
		});

		const contents = await readFile(path, "utf8");
		expect(JSON.parse(contents).firebaseActorUid).toBe(firebaseActorUid);
		expect(Buffer.byteLength(contents, "utf8")).toBeLessThanOrEqual(2048);
	});

	it("uses field-specific Firebase, organization, and request-ID validation", async () => {
		const writer = new FileShopifyMutationAuditWriter(
			await temporaryAuditPath(),
		);
		await expect(
			writer.append({
				...AUDIT_ATTEMPT,
				operation: "productDelete",
				result: "failure",
			}),
		).rejects.toThrow("audit record is invalid");
		await expect(
			writer.append({
				...AUDIT_ATTEMPT,
				firebaseActorUid: "",
				result: "success",
			}),
		).rejects.toThrow("audit record is invalid");
		await expect(
			writer.append({
				...AUDIT_ATTEMPT,
				firebaseActorUid: "x".repeat(129),
				operation: "productDelete",
				result: "failure",
				failureCategory: "transport",
			}),
		).rejects.toThrow("audit record is invalid");
		await expect(
			writer.append({
				...AUDIT_ATTEMPT,
				organizationId: "organization-1",
				result: "success",
			}),
		).rejects.toThrow("audit record is invalid");
		await expect(
			writer.append({
				...AUDIT_ATTEMPT,
				requestId: "unsafe request id",
				result: "success",
			}),
		).rejects.toThrow("audit record is invalid");
	});

	it("propagates destination failures without fallback", async () => {
		const path = join(await temporaryAuditPath(), "missing", "audit.ndjson");
		const writer = new FileShopifyMutationAuditWriter(path);
		await expect(writer.ensureReady(AUDIT_ATTEMPT)).rejects.toThrow();
	});
});
