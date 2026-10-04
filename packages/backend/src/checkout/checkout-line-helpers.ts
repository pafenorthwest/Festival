import { randomUUID } from "node:crypto";
import type {
	RegistrationRepertoireItem,
	RepertoirePiece,
} from "@festival/common";
import type {
	CheckoutIntentLineItemRecord,
	CheckoutIntentRecord,
	CreateCheckoutIntentLineInput,
} from "./checkout-repository.js";

/** Server-only Shopify cart-line attribute used to correlate a paid line. */
export const CHECKOUT_INTENT_LINE_ID_ATTRIBUTE_KEY =
	"festival_checkout_intent_line_id";

const CANONICAL_UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isCanonicalUuid(value: unknown): value is string {
	return typeof value === "string" && CANONICAL_UUID_REGEX.test(value);
}

/**
 * Returns the durable checkout lines in validated-request order, or throws
 * before a cart can be emitted when persistence has violated that mapping.
 */
export function requireClassCheckoutIntentLineMapping(
	intent: Pick<CheckoutIntentRecord, "id" | "lines">,
	expectedLineCount: number,
): CheckoutIntentLineItemRecord[] {
	const persistedLines = intent.lines;
	if (
		!Array.isArray(persistedLines) ||
		persistedLines.length !== expectedLineCount
	) {
		throw new Error("Checkout intent line persistence is incomplete.");
	}

	const linesByIndex = new Map<number, CheckoutIntentLineItemRecord>();
	const lineIds = new Set<string>();
	for (const line of persistedLines) {
		if (
			line.checkoutIntentId !== intent.id ||
			!Number.isInteger(line.lineIndex) ||
			line.lineIndex < 0 ||
			line.lineIndex >= expectedLineCount ||
			linesByIndex.has(line.lineIndex) ||
			!isCanonicalUuid(line.id) ||
			lineIds.has(line.id)
		) {
			throw new Error("Checkout intent line persistence is invalid.");
		}
		linesByIndex.set(line.lineIndex, line);
		lineIds.add(line.id);
	}

	return Array.from({ length: expectedLineCount }, (_, lineIndex) => {
		const line = linesByIndex.get(lineIndex);
		if (!line) {
			throw new Error("Checkout intent line persistence is incomplete.");
		}
		return line;
	});
}

export function buildIntentLineRecords(
	intent: CheckoutIntentRecord,
	inputs?: CreateCheckoutIntentLineInput[],
): CheckoutIntentLineItemRecord[] {
	if (inputs && inputs.length > 0) {
		return inputs.map((line, index) => ({
			id: line.id ?? randomUUID(),
			checkoutIntentId: intent.id,
			lineIndex: line.lineIndex ?? index,
			lineType: line.lineType ?? "class_entry",
			festivalClassId: line.festivalClassId ?? null,
			childId: line.childId ?? null,
			offeringId: line.offeringId ?? null,
			shopifyProductGid: line.shopifyProductGid,
			shopifyVariantGid: line.shopifyVariantGid,
			amount: line.amount,
			currencyCode: line.currencyCode,
			divisionId: line.divisionId ?? null,
			divisionNameSnapshot: line.divisionNameSnapshot ?? null,
			createdAtIso: intent.createdAtIso,
		}));
	}
	return [
		{
			id: randomUUID(),
			checkoutIntentId: intent.id,
			lineIndex: 0,
			lineType:
				intent.intentType === "class_entry" ? "class_entry" : "membership",
			festivalClassId: intent.festivalClassId,
			childId: intent.childId,
			offeringId: intent.offeringId,
			shopifyProductGid: intent.shopifyProductGid,
			shopifyVariantGid: intent.shopifyVariantGid,
			amount: intent.amount,
			currencyCode: intent.currencyCode,
			divisionId: intent.divisionId,
			divisionNameSnapshot: intent.divisionNameSnapshot,
			createdAtIso: intent.createdAtIso,
		},
	];
}

/**
 * Compatibility mapping while callers still submit the MVP title/composer JSON
 * shape. The relational snapshot is the durable source for new reads.
 */
export function repertoireItemsFromLegacyPieces(
	registrationMetadataId: string,
	organizationId: string,
	pieces: RepertoirePiece[],
): RegistrationRepertoireItem[] {
	return pieces.map((piece, index) => ({
		id: randomUUID(),
		registrationMetadataId,
		organizationId,
		displayOrder: index + 1,
		catalogWorkId: null,
		titleSnapshot: piece.title,
		performedMovementText:
			typeof piece.movement === "string" ? piece.movement.trim() || null : null,
		durationSeconds: piece.durationSeconds,
		contributors: [
			{
				id: randomUUID(),
				displayOrder: 1,
				role: "Composer",
				displayNameSnapshot: piece.composer,
				catalogContributorId: null,
			},
		],
	}));
}
