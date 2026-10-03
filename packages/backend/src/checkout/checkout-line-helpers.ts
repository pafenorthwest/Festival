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
