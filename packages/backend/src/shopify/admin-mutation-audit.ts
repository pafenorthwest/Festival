import { appendFile, open } from "node:fs/promises";
import type { ShopifyFailureCategory } from "@festival/common";

export const SHOPIFY_ADMIN_AUDIT_PATH =
	"/var/log/festival/shopify-admin-audit.ndjson";
const MAX_AUDIT_RECORD_BYTES = 2048;
const MAX_FIREBASE_UID_LENGTH = 128;
const ORGANIZATION_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHOPIFY_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const AUDIT_OPERATIONS = new Set<ShopifyMutationAuditOperation>([
	"productCreate",
	"productVariantUpdate",
	"productDelete",
]);
const AUDIT_RESULTS = new Set(["success", "failure"]);
const FAILURE_CATEGORIES = new Set<ShopifyFailureCategory>([
	"credentials",
	"identity_mismatch",
	"shop_ownership_conflict",
	"missing_scope",
	"transport",
	"upstream",
]);

export type ShopifyMutationAuditOperation =
	| "productCreate"
	| "productVariantUpdate"
	| "productDelete";

export interface ShopifyMutationAuditAttemptInput {
	timestampIso: string;
	firebaseActorUid: string;
	organizationId: string;
	operation: ShopifyMutationAuditOperation;
}

export interface ShopifyMutationAuditInput
	extends ShopifyMutationAuditAttemptInput {
	requestId?: string;
	result: "success" | "failure";
	failureCategory?: ShopifyFailureCategory;
}

export interface ShopifyMutationAuditWriter {
	ensureReady(input: ShopifyMutationAuditAttemptInput): Promise<void>;
	append(input: ShopifyMutationAuditInput): Promise<void>;
}

export class FileShopifyMutationAuditWriter
	implements ShopifyMutationAuditWriter
{
	constructor(private readonly destination = SHOPIFY_ADMIN_AUDIT_PATH) {}

	async ensureReady(input: ShopifyMutationAuditAttemptInput): Promise<void> {
		this.assertValidInput({
			...input,
			requestId: "r".repeat(128),
			result: "failure",
			failureCategory: "shop_ownership_conflict",
		});
		const handle = await open(this.destination, "a", 0o600);
		await handle.close();
	}

	async append(input: ShopifyMutationAuditInput): Promise<void> {
		this.assertValidInput(input);
		await appendFile(this.destination, this.serialize(input), {
			encoding: "utf8",
			mode: 0o600,
			flag: "a",
		});
	}

	private serialize(input: ShopifyMutationAuditInput): string {
		const line = `${JSON.stringify({
			timestampIso: input.timestampIso,
			firebaseActorUid: input.firebaseActorUid,
			organizationId: input.organizationId,
			operation: input.operation,
			...(input.requestId ? { requestId: input.requestId } : {}),
			result: input.result,
			...(input.failureCategory
				? { failureCategory: input.failureCategory }
				: {}),
		})}\n`;
		if (Buffer.byteLength(line, "utf8") > MAX_AUDIT_RECORD_BYTES) {
			throw new Error("Shopify mutation audit record exceeds the size limit.");
		}
		return line;
	}

	private assertValidInput(input: ShopifyMutationAuditInput): void {
		if (!input) {
			throw new Error("Shopify mutation audit record is invalid.");
		}
		let timestampIsValid = false;
		try {
			timestampIsValid =
				new Date(input.timestampIso).toISOString() === input.timestampIso;
		} catch {
			timestampIsValid = false;
		}
		if (
			!timestampIsValid ||
			typeof input.firebaseActorUid !== "string" ||
			input.firebaseActorUid.length === 0 ||
			input.firebaseActorUid.length > MAX_FIREBASE_UID_LENGTH ||
			!ORGANIZATION_UUID.test(input.organizationId) ||
			!AUDIT_OPERATIONS.has(input.operation) ||
			!AUDIT_RESULTS.has(input.result) ||
			(input.requestId !== undefined &&
				!SHOPIFY_REQUEST_ID.test(input.requestId)) ||
			(input.failureCategory !== undefined &&
				!FAILURE_CATEGORIES.has(input.failureCategory)) ||
			(input.result === "success" && input.failureCategory !== undefined) ||
			(input.result === "failure" && input.failureCategory === undefined)
		) {
			throw new Error("Shopify mutation audit record is invalid.");
		}
		this.serialize(input);
	}
}
