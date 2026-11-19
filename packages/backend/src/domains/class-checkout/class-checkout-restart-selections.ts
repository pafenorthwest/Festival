import {
	AppError,
	type ClassCheckoutLineItemInput,
	type ClassCheckoutRestartRegistration,
	type ClassRegistrationSnapshot,
	type FestivalClassConfiguration,
} from "@festival/common";
import type { ClassCheckoutExecution } from "./checkout-execution-types.js";
import type {
	CheckoutIntentLineItemRecord,
	CheckoutIntentRecord,
} from "./checkout-types.js";
import type { RecoveryOpsDeps } from "./class-checkout-recovery-preflight.js";
import type { CheckoutChildRecord } from "./ports.js";

export function mapRestartRegistration(
	entry: {
		checkoutIntentLineId: string;
		registrationSnapshot: ClassRegistrationSnapshot;
	},
	lookups: {
		intentLinesById: Map<string, CheckoutIntentLineItemRecord>;
		childById: Map<string, CheckoutChildRecord>;
		classById: Map<string, FestivalClassConfiguration>;
	},
): ClassCheckoutRestartRegistration {
	const { checkoutIntentLineId, registrationSnapshot } = entry;
	const line = lookups.intentLinesById.get(checkoutIntentLineId);
	const child = line?.childId ? lookups.childById.get(line.childId) : undefined;
	const fc = line?.festivalClassId
		? lookups.classById.get(line.festivalClassId)
		: undefined;
	return {
		lineId: checkoutIntentLineId,
		childId: line?.childId ?? "",
		childName: child?.displayName ?? "",
		divisionId: registrationSnapshot.division.id,
		divisionName: registrationSnapshot.division.name ?? "",
		teacherId: registrationSnapshot.teacher.customerId,
		teacherName: registrationSnapshot.teacher.name ?? "",
		classId: registrationSnapshot.class.id,
		className: fc?.displayName ?? registrationSnapshot.class.displayName,
		classSubtypeId: registrationSnapshot.class.classSubtypeId,
		classSubtypeName: registrationSnapshot.class.classSubtypeName,
		minimumAge: registrationSnapshot.class.minimumAge,
		maximumAge: registrationSnapshot.class.maximumAge,
		priceCents: Math.round(
			Number.parseFloat(registrationSnapshot.class.price) * 100,
		),
		accompanistId: registrationSnapshot.accompanist?.customerId ?? null,
		accompanistName: registrationSnapshot.accompanist?.name ?? null,
		instrumentId:
			registrationSnapshot.instrument === "unknown"
				? undefined
				: registrationSnapshot.instrument.id,
		instrumentName:
			registrationSnapshot.instrument === "unknown"
				? undefined
				: registrationSnapshot.instrument.name,
		pieces: registrationSnapshot.repertoire,
	};
}

export interface RestartUnissuedCartInput {
	organizationId: string;
	customerId: string;
	festivalShortName: string;
	recoveryReference: string;
}

export async function loadRestartResources(
	deps: RecoveryOpsDeps,
	input: RestartUnissuedCartInput,
	intentId: string,
	intentLines: CheckoutIntentLineItemRecord[],
) {
	const festival = await deps.catalog.findFestivalByShortName(
		input.organizationId,
		input.festivalShortName.trim(),
	);
	const [snapshots, children, classes] = await Promise.all([
		deps.checkout.listCheckoutRegistrationSnapshots?.(
			input.organizationId,
			intentId,
		) ?? Promise.resolve([]),
		deps.customers.listChildren(input.organizationId, input.customerId),
		festival
			? deps.catalog.listFestivalClassConfigurations(
					input.organizationId,
					festival.id,
					false,
				)
			: Promise.resolve([]),
	]);
	const byLine = new Map(
		snapshots.map((entry) => [entry.checkoutIntentLineId, entry]),
	);
	return {
		snapshots: intentLines.flatMap((line) => {
			const entry = byLine.get(line.id);
			return entry ? [entry] : [];
		}),
		lookups: {
			intentLinesById: new Map(intentLines.map((line) => [line.id, line])),
			childById: new Map(children.map((c) => [c.id, c])),
			classById: new Map(classes.map((c) => [c.id, c])),
		},
	};
}

export async function restoreReplacementSelections(
	deps: RecoveryOpsDeps,
	input: RestartUnissuedCartInput,
	replacementIntent: CheckoutIntentRecord,
	replacementExecution: ClassCheckoutExecution,
	{ snapshots, lookups }: Awaited<ReturnType<typeof loadRestartResources>>,
): Promise<ClassCheckoutRestartRegistration[]> {
	const persisted = await loadRestartResources(
		deps,
		input,
		replacementIntent.id,
		replacementIntent.lines ?? [],
	);
	const request = replacementExecution.requestSnapshot as {
		lineItems?: ClassCheckoutLineItemInput[];
	} | null;
	const replacementLines = replacementIntent.lines;
	if (
		!request?.lineItems ||
		!replacementLines ||
		request.lineItems.length !== replacementLines.length
	) {
		throw new AppError(
			"Saved checkout selections are temporarily unavailable.",
			503,
			"checkout_persistence_unavailable",
		);
	}
	// The execution snapshot is persisted before metadata, so it remains canonical
	// even if a metadata write failed partway through the submitted selection.
	const registrations = request.lineItems.map((line, index) => {
		const intentLine = replacementLines[index];
		const saved =
			persisted.snapshots.find(
				(entry) => entry.checkoutIntentLineId === intentLine.id,
			) ??
			snapshots.find(
				(entry) => entry.registrationSnapshot.class.id === line.festivalClassId,
			);
		const fc = persisted.lookups.classById.get(line.festivalClassId);
		const fallback = saved
			? mapRestartRegistration(saved, {
					...lookups,
					...persisted.lookups,
					intentLinesById: new Map([
						...lookups.intentLinesById,
						...persisted.lookups.intentLinesById,
					]),
				})
			: null;
		return {
			...fallback,
			lineId: intentLine.id,
			childId: line.childId,
			childName:
				persisted.lookups.childById.get(line.childId)?.displayName ?? "",
			classId: line.festivalClassId,
			className: fc?.displayName ?? fallback?.className ?? "Unavailable class",
			divisionId: fc?.divisionId ?? fallback?.divisionId ?? "",
			divisionName: fallback?.divisionName ?? "",
			teacherId: line.teacherId,
			teacherName:
				fallback?.teacherId === line.teacherId ? fallback.teacherName : "",
			accompanistId: line.accompanistId ?? null,
			accompanistName:
				fallback?.accompanistId === (line.accompanistId ?? null)
					? (fallback?.accompanistName ?? null)
					: null,
			instrumentId: line.instrumentId,
			instrumentName:
				fallback?.instrumentId === line.instrumentId
					? fallback?.instrumentName
					: undefined,
			priceCents: Math.round(Number.parseFloat(intentLine.amount) * 100),
			pieces: line.pieces ?? [],
		};
	});
	return registrations;
}
