import {
	AppError,
	type ClassEntitlement,
	type ClassRegistrationMetadata,
	type CustomerClassEntitlementSummary,
	type CustomerClassRegistrationItem,
	type CustomerClassRegistrationMetadataSummary,
	type CustomerFestivalClassSummary,
	doesClassRequireConcerto,
	evaluateClassCapacityStatus,
	type FestivalClassConfiguration,
	type FestivalRecord,
	type RegistrationCatalogValue,
	type RegistrationEligibleClass,
} from "@festival/common";
import type { CheckoutRepository } from "../checkout/checkout-repository.js";
import type { MembershipCommerceRepository } from "../commerce/membership-commerce-repository.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";

export interface RegistrationItemContext {
	childrenById: Map<string, { id: string; name: string }>;
	classConfigsByFestival: Map<string, Map<string, FestivalClassConfiguration>>;
	metadataByEntitlementId: Map<string, ClassRegistrationMetadata>;
	paidAtByOrderGid: Map<string, string | null>;
	editCutoffs: Map<string, Date>;
	nowMs: number;
}

export function toEntitlementSummary(
	e: ClassEntitlement,
): CustomerClassEntitlementSummary {
	return {
		id: e.id,
		festivalId: e.festivalId,
		festivalClassId: e.festivalClassId,
		childId: e.childId,
		status: e.status,
		createdAt: e.createdAt,
		updatedAt: e.updatedAt,
	};
}

export function toFestivalClassSummary(
	c: FestivalClassConfiguration,
): CustomerFestivalClassSummary {
	return {
		id: c.id,
		festivalId: c.festivalId,
		displayName: c.displayName,
		classSubtypeId: c.classSubtypeId,
		divisionId: c.divisionId,
		minimumAge: c.minimumAge,
		maximumAge: c.maximumAge,
		price: c.price,
		maximumPerformancePieces: c.maximumPerformancePieces,
		performanceMinutes: c.performanceMinutes,
		capacity: c.capacity,
		isActive: c.isActive,
	};
}

export function toMetadataSummary(
	m: ClassRegistrationMetadata,
): CustomerClassRegistrationMetadataSummary {
	return {
		id: m.id,
		festivalId: m.festivalId,
		classEntitlementId: m.classEntitlementId,
		teacherMembershipId: m.teacherMembershipId,
		teacherName: m.registrationSnapshot?.teacher.name ?? null,
		accompanistMembershipId: m.accompanistMembershipId,
		repertoireJson: m.repertoireJson,
		repertoireItems: m.repertoireItems,
	};
}

export function buildRegistrationItem(
	entitlement: ClassEntitlement,
	ctx: RegistrationItemContext,
): CustomerClassRegistrationItem {
	const fc = ctx.classConfigsByFestival
		.get(entitlement.festivalId)
		?.get(entitlement.festivalClassId);
	const child = ctx.childrenById.get(entitlement.childId);
	const metadata = ctx.metadataByEntitlementId.get(entitlement.id) ?? null;
	const editCutoff = ctx.editCutoffs.get(entitlement.festivalId);
	return {
		entitlement: toEntitlementSummary(entitlement),
		festivalClass: fc ? toFestivalClassSummary(fc) : undefined,
		child,
		metadata: metadata ? toMetadataSummary(metadata) : null,
		paidAtIso: ctx.paidAtByOrderGid.get(entitlement.shopifyOrderGid) ?? null,
		metadataEditCutoffIso: editCutoff?.toISOString() ?? null,
		canEditMetadata: Boolean(
			metadata && fc && editCutoff && ctx.nowMs < editCutoff.getTime(),
		),
	};
}

export function toEligibleClass(
	item: FestivalClassConfiguration,
	ctx: {
		subtypeById: Map<string, RegistrationCatalogValue>;
		isRegistrationOpen: boolean;
		placedCounts?: Map<string, number>;
	},
): RegistrationEligibleClass {
	const placedCount = ctx.placedCounts
		? (ctx.placedCounts.get(item.id) ?? 0)
		: undefined;
	const subtype = ctx.subtypeById.get(item.classSubtypeId) ?? null;
	return {
		id: item.id,
		displayName: item.displayName,
		divisionId: item.divisionId,
		classSubtypeId: item.classSubtypeId,
		...(subtype ? { classSubtypeName: subtype.displayName } : {}),
		requiresConcerto: doesClassRequireConcerto(item, subtype),
		minimumAge: item.minimumAge,
		maximumAge: item.maximumAge,
		price: item.price,
		maximumPerformancePieces: item.maximumPerformancePieces,
		performanceMinutes: item.performanceMinutes,
		capacity: item.capacity,
		isRegistrationOpen: ctx.isRegistrationOpen,
		...(placedCount !== undefined
			? {
					placedCount,
					availability: evaluateClassCapacityStatus(item.capacity, placedCount)
						.availability,
				}
			: {}),
	};
}

export async function loadMetadataMap(
	checkout: CheckoutRepository,
	organizationId: string,
	entitlementIds: readonly string[],
): Promise<Map<string, ClassRegistrationMetadata>> {
	if (entitlementIds.length === 0) return new Map();
	if (checkout.listRegistrationMetadataByEntitlementIds) {
		return checkout.listRegistrationMetadataByEntitlementIds(
			organizationId,
			entitlementIds,
		);
	}
	const entries = await Promise.all(
		entitlementIds.map(async (id) => {
			const meta = await checkout.getRegistrationMetadataByEntitlementId(
				organizationId,
				id,
			);
			return meta ? ([id, meta] as const) : null;
		}),
	);
	return new Map(entries.filter((entry) => entry !== null));
}

export async function loadConfirmedCounts(
	commerce: MembershipCommerceRepository | undefined,
	organizationId: string,
	classIds: readonly string[],
): Promise<Map<string, number> | undefined> {
	if (!commerce) return undefined;
	if (classIds.length === 0) return new Map();
	if (commerce.countConfirmedClassEntitlementsByClassIds) {
		return commerce.countConfirmedClassEntitlementsByClassIds(
			organizationId,
			classIds,
		);
	}
	const entries = await Promise.all(
		classIds.map(
			async (id) =>
				[
					id,
					await commerce.countConfirmedClassEntitlements(organizationId, id),
				] as const,
		),
	);
	return new Map(entries);
}

export async function loadClassConfigsByFestival(
	organizations: OrganizationRepository,
	organizationId: string,
	festivalIds: readonly string[],
) {
	const entries = await Promise.all(
		festivalIds.map(async (festivalId) => {
			const list = await organizations.listFestivalClassConfigurations(
				organizationId,
				festivalId,
			);
			return [festivalId, new Map(list.map((c) => [c.id, c]))] as const;
		}),
	);
	return new Map(entries);
}

export async function lookupFestivalById(
	organizations: OrganizationRepository,
	orgId: string,
	festivalId: string,
	shortName?: string,
): Promise<FestivalRecord> {
	if (shortName) {
		const found = await organizations.findFestivalByShortName(orgId, shortName);
		if (!found || found.id !== festivalId) {
			throw new AppError("Festival not found.", 404);
		}
		return found;
	}
	const found = (await organizations.listFestivals(orgId)).find(
		(f) => f.id === festivalId,
	);
	if (!found) throw new AppError("Festival not found.", 404);
	return found;
}

export async function loadRegistrationResponseItems(
	organizations: OrganizationRepository,
	commerce: MembershipCommerceRepository,
	checkout: CheckoutRepository,
	input: {
		organizationId: string;
		timezone: string;
		children: Array<{ id: string; displayName: string }>;
		festivals: FestivalRecord[];
		entitlements: ClassEntitlement[];
		nowMs: number;
	},
) {
	const [projections, classConfigsByFestival, metadataByEntitlementId] =
		await Promise.all([
			commerce.listOrderProjectionsByGids(input.organizationId, [
				...new Set(input.entitlements.map((e) => e.shopifyOrderGid)),
			]),
			loadClassConfigsByFestival(organizations, input.organizationId, [
				...new Set(input.entitlements.map((e) => e.festivalId)),
			]),
			loadMetadataMap(
				checkout,
				input.organizationId,
				input.entitlements.map((e) => e.id),
			),
		]);
	const { deriveFestivalMetadataCutoff } = await import("@festival/common");
	const ctx: RegistrationItemContext = {
		childrenById: new Map(
			input.children.map((c) => [c.id, { id: c.id, name: c.displayName }]),
		),
		classConfigsByFestival,
		metadataByEntitlementId,
		paidAtByOrderGid: new Map(
			projections.map((p) => [p.shopifyOrderGid, p.fullyPaidAtIso ?? null]),
		),
		editCutoffs: new Map(
			input.festivals.map((f) => [
				f.id,
				deriveFestivalMetadataCutoff(f.startDate, input.timezone || "UTC"),
			]),
		),
		nowMs: input.nowMs,
	};
	return input.entitlements.map((e) => buildRegistrationItem(e, ctx));
}

export async function loadEligibleClassesList(
	organizations: OrganizationRepository,
	commerce: MembershipCommerceRepository | undefined,
	input: {
		organizationId: string;
		festival: FestivalRecord;
		divisionId: string;
		childAge: number;
		now: Date;
	},
): Promise<RegistrationEligibleClass[]> {
	const [classes, timezone, subtypes] = await Promise.all([
		organizations.listFestivalClassConfigurations(
			input.organizationId,
			input.festival.id,
			true,
		),
		organizations.getOrganizationTimezone(input.organizationId),
		organizations.listRegistrationCatalogValues(
			input.organizationId,
			"class_subtype",
			false,
		),
	]);
	const eligible = classes.filter(
		(c) =>
			c.divisionId === input.divisionId &&
			c.minimumAge <= input.childAge &&
			input.childAge <= c.maximumAge,
	);
	const placedCounts = await loadConfirmedCounts(
		commerce,
		input.organizationId,
		eligible.map((i) => i.id),
	);
	const { isFestivalRegistrationOpen } = await import("@festival/common");
	const ctx = {
		subtypeById: new Map(subtypes.map((s) => [s.id, s])),
		isRegistrationOpen: isFestivalRegistrationOpen(
			input.festival,
			input.now,
			timezone,
		),
		placedCounts,
	};
	return eligible.map((item) => toEligibleClass(item, ctx));
}
