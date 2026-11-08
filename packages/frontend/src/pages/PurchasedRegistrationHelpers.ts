import type {
	CustomerClassRegistrationItem,
	CustomerFestivalClassSummary,
	RepertoirePiece,
} from "@festival/common";
import { validateRepertoirePiece } from "@festival/common";
import type { UpdateRegistrationMetadataInput } from "../lib/api.js";

export const KEEP_CURRENT_ACCOMPANIST = "__keep_current_accompanist__";

export interface PurchasedRegistrationGroup {
	childId: string;
	name: string;
	registrations: CustomerClassRegistrationItem[];
}

export function groupPurchasedRegistrations(
	registrations: readonly CustomerClassRegistrationItem[],
	festivalId = "",
): PurchasedRegistrationGroup[] {
	const groups = new Map<string, PurchasedRegistrationGroup>();
	for (const registration of registrations) {
		if (festivalId && registration.entitlement.festivalId !== festivalId)
			continue;
		const childId = registration.entitlement.childId;
		let group = groups.get(childId);
		if (!group) {
			group = {
				childId,
				name: registration.child?.name ?? "Performer name unavailable",
				registrations: [],
			};
			groups.set(childId, group);
		}
		group.registrations.push(registration);
	}
	return [...groups.values()];
}

/** The returned server policy and exact cutoff remain authoritative. */
export function canEditPurchasedRegistration(
	registration: CustomerClassRegistrationItem,
	nowMs = Date.now(),
): boolean {
	const cutoff = Date.parse(registration.metadataEditCutoffIso ?? "");
	return Boolean(
		registration.canEditMetadata &&
			registration.metadata &&
			registration.festivalClass &&
			Number.isFinite(cutoff) &&
			nowMs < cutoff,
	);
}

export function purchasedRegistrationReadOnlyReason(
	registration: CustomerClassRegistrationItem,
	nowMs = Date.now(),
): string {
	const cutoff = Date.parse(registration.metadataEditCutoffIso ?? "");
	if (Number.isFinite(cutoff) && nowMs >= cutoff) {
		return "The repertoire and accompanist editing cutoff has passed.";
	}
	return "Editing is unavailable for this registration. Its historical details may be incomplete.";
}

export function validatePurchasedRegistrationPieces(
	pieces: readonly RepertoirePiece[],
	configuration: Pick<
		CustomerFestivalClassSummary,
		"maximumPerformancePieces" | "performanceMinutes"
	>,
): string | null {
	if (pieces.length === 0) return "At least one valid piece is required.";
	if (pieces.length > configuration.maximumPerformancePieces) {
		return `This class permits no more than ${configuration.maximumPerformancePieces} pieces.`;
	}
	const errors: string[] = [];
	pieces.forEach((piece, index) => {
		validateRepertoirePiece(piece, index, errors);
	});
	if (errors.length > 0) return errors[0];
	if (
		pieces.reduce((total, piece) => total + piece.durationSeconds, 0) >
		configuration.performanceMinutes * 60
	) {
		return `Total performance duration must not exceed ${configuration.performanceMinutes} minutes.`;
	}
	return null;
}

/** Membership IDs in the read DTO are not interchangeable with customer IDs. */
export function purchasedRegistrationUpdate(
	pieces: readonly RepertoirePiece[],
	accompanistSelection: string,
): UpdateRegistrationMetadataInput {
	return {
		pieces: pieces.map((piece) => ({ ...piece })),
		...(accompanistSelection !== KEEP_CURRENT_ACCOMPANIST
			? { accompanistId: accompanistSelection || null }
			: {}),
	};
}

export function formatPurchasedCutoff(cutoffIso: string | null): string {
	if (!cutoffIso || !Number.isFinite(Date.parse(cutoffIso)))
		return "Date unavailable";
	return new Date(cutoffIso).toLocaleString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		timeZoneName: "short",
	});
}
