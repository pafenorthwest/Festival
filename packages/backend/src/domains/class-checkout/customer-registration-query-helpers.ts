import {
	type ClassEntitlement,
	type ClassEntitlementStatus,
	type ClassRegistrationMetadata,
	type ClassRegistrationSnapshot,
	type CustomerClassRegistrationItem,
	doesClassRequireConcerto,
	evaluateClassCapacityStatus,
	type FestivalClassConfiguration,
	normalizeClassRegistrationSnapshot,
	type RegistrationCatalogValue,
	type RegistrationEligibleClass,
	type RegistrationRepertoireItem,
	type RegistrationRepertoireItemContributor,
	type RepertoireContributorRole,
	type RepertoirePiece,
} from "@festival/common";
import {
	type JoinedRegistrationRow,
	queryClassRegistrationsJoinedSql,
	queryConfirmedCountsSql,
} from "./customer-registration-sql-queries.js";

export {
	type JoinedRegistrationRow,
	queryClassRegistrationsJoinedSql,
	queryConfirmedCountsSql,
};

function iso(value: string | Date): string {
	return value instanceof Date ? value.toISOString() : String(value);
}

function parseJson<T>(raw: unknown, fallback: T): T {
	if (raw === null || raw === undefined) return fallback;
	if (typeof raw === "string") return JSON.parse(raw) as T;
	return raw as T;
}

interface JoinedRegistrationAcc {
	row: JoinedRegistrationRow;
	items: Map<string, RegistrationRepertoireItem & { seen: Set<string> }>;
}

function groupJoinedRegistrationRows(
	rows: JoinedRegistrationRow[],
): Map<string, JoinedRegistrationAcc> {
	const grouped = new Map<string, JoinedRegistrationAcc>();
	for (const row of rows) {
		let acc = grouped.get(row.e_id);
		if (!acc) {
			acc = { row, items: new Map() };
			grouped.set(row.e_id, acc);
		}
		if (row.ri_id && !acc.items.has(row.ri_id)) {
			acc.items.set(row.ri_id, {
				id: row.ri_id,
				registrationMetadataId: row.m_id ?? "",
				organizationId: row.e_organization_id,
				catalogWorkId: row.ri_repertoire_work_id,
				titleSnapshot: row.ri_title_snapshot ?? "",
				performedMovementText: row.ri_performed_movement_text,
				durationSeconds: Number(row.ri_duration_seconds ?? 0),
				displayOrder: Number(row.ri_display_order ?? 0),
				contributors: [],
				seen: new Set(),
			});
		}
		if (row.ri_id && row.ric_id) {
			const item = acc.items.get(row.ri_id);
			if (item && !item.seen.has(row.ric_id)) {
				item.seen.add(row.ric_id);
				item.contributors.push({
					id: row.ric_id,
					catalogContributorId: row.ric_repertoire_contributor_id,
					displayNameSnapshot: row.ric_display_name_snapshot ?? "",
					role: row.ric_contributor_role as RepertoireContributorRole,
					displayOrder: Number(row.ric_position ?? 1) as 1 | 2 | 3,
				} satisfies RegistrationRepertoireItemContributor);
			}
		}
	}
	return grouped;
}

function mapJoinedFestivalClass(
	row: JoinedRegistrationRow,
): CustomerClassRegistrationItem["festivalClass"] {
	if (row.fc_display_name === null) return undefined;
	return {
		id: row.e_festival_class_id,
		festivalId: row.e_festival_id,
		displayName: row.fc_display_name ?? "",
		classSubtypeId: row.fc_class_subtype_id ?? "",
		divisionId: row.fc_division_id ?? "",
		minimumAge: Number(row.fc_minimum_age ?? 0),
		maximumAge: Number(row.fc_maximum_age ?? 0),
		price: row.fc_price ?? "0.00",
		maximumPerformancePieces: Number(row.fc_maximum_performance_pieces ?? 1) as
			| 1
			| 2
			| 3,
		performanceMinutes: Number(row.fc_performance_minutes ?? 0),
		capacity: Number(row.fc_capacity ?? 0),
		isActive: Boolean(row.fc_is_active),
	};
}

function mapJoinedMetadata(
	row: JoinedRegistrationRow,
	items: JoinedRegistrationAcc["items"],
): CustomerClassRegistrationItem["metadata"] {
	if (row.m_id === null) return null;
	const snapshot = normalizeClassRegistrationSnapshot(
		parseJson<ClassRegistrationSnapshot | null>(
			row.m_registration_snapshot,
			null,
		),
	);
	const repertoireItems = Array.from(items.values()).map(
		({ seen: _seen, ...rest }) => rest,
	);
	return {
		id: row.m_id ?? "",
		festivalId: row.m_festival_id ?? row.e_festival_id,
		classEntitlementId: row.m_class_entitlement_id,
		teacherMembershipId: row.m_teacher_membership_id ?? "",
		teacherName: snapshot?.teacher.name ?? null,
		accompanistMembershipId: row.m_accompanist_membership_id,
		repertoireJson: parseJson<RepertoirePiece[]>(row.m_repertoire_json, []),
		repertoireItems,
	};
}

function toJoinedRegistrationItem(
	acc: JoinedRegistrationAcc,
	editCutoffs: Map<string, Date>,
	nowMs: number,
): CustomerClassRegistrationItem {
	const { row, items } = acc;
	const editCutoff = editCutoffs.get(row.e_festival_id);
	const hasClass = row.fc_display_name !== null;
	const hasMeta = row.m_id !== null;
	return {
		entitlement: {
			id: row.e_id,
			festivalId: row.e_festival_id,
			festivalClassId: row.e_festival_class_id,
			childId: row.e_child_id,
			status: row.e_status as ClassEntitlementStatus,
			createdAt: iso(row.e_created_at),
			updatedAt: iso(row.e_updated_at),
		},
		festivalClass: mapJoinedFestivalClass(row),
		child:
			row.c_display_name !== null
				? { id: row.e_child_id, name: row.c_display_name }
				: undefined,
		metadata: mapJoinedMetadata(row, items),
		paidAtIso: row.p_fully_paid_at ? iso(row.p_fully_paid_at) : null,
		metadataEditCutoffIso: editCutoff?.toISOString() ?? null,
		canEditMetadata: Boolean(
			hasMeta && hasClass && editCutoff && nowMs < editCutoff.getTime(),
		),
	};
}

export function buildJoinedRegistrationItems(
	rows: JoinedRegistrationRow[],
	editCutoffs: Map<string, Date>,
	nowMs: number,
): CustomerClassRegistrationItem[] {
	const grouped = groupJoinedRegistrationRows(rows);
	return Array.from(grouped.values()).map((acc) =>
		toJoinedRegistrationItem(acc, editCutoffs, nowMs),
	);
}

function mapPortFestivalClass(
	festivalClass: FestivalClassConfiguration | undefined,
): CustomerClassRegistrationItem["festivalClass"] {
	if (!festivalClass) return undefined;
	return {
		id: festivalClass.id,
		festivalId: festivalClass.festivalId,
		displayName: festivalClass.displayName,
		classSubtypeId: festivalClass.classSubtypeId,
		divisionId: festivalClass.divisionId,
		minimumAge: festivalClass.minimumAge,
		maximumAge: festivalClass.maximumAge,
		price: festivalClass.price,
		maximumPerformancePieces: festivalClass.maximumPerformancePieces,
		performanceMinutes: festivalClass.performanceMinutes,
		capacity: festivalClass.capacity,
		isActive: festivalClass.isActive,
	};
}

function mapPortMetadata(
	metadata: ClassRegistrationMetadata | null,
): CustomerClassRegistrationItem["metadata"] {
	if (!metadata) return null;
	return {
		id: metadata.id,
		festivalId: metadata.festivalId,
		classEntitlementId: metadata.classEntitlementId,
		teacherMembershipId: metadata.teacherMembershipId,
		teacherName: metadata.registrationSnapshot?.teacher.name ?? null,
		accompanistMembershipId: metadata.accompanistMembershipId,
		repertoireJson: metadata.repertoireJson,
		repertoireItems: metadata.repertoireItems,
	};
}

export function buildPortRegistrationItem(
	entitlement: ClassEntitlement,
	ctx: {
		childrenById: Map<string, { id: string; name: string }>;
		classConfigsByFestival: Map<
			string,
			Map<string, FestivalClassConfiguration>
		>;
		metadataByEntitlementId: Map<string, ClassRegistrationMetadata>;
		paidAtByOrderGid: Map<string, string | null>;
		editCutoffs: Map<string, Date>;
		nowMs: number;
	},
): CustomerClassRegistrationItem {
	const festivalClass = ctx.classConfigsByFestival
		.get(entitlement.festivalId)
		?.get(entitlement.festivalClassId);
	const child = ctx.childrenById.get(entitlement.childId);
	const metadata = ctx.metadataByEntitlementId.get(entitlement.id) ?? null;
	const editCutoff = ctx.editCutoffs.get(entitlement.festivalId);
	return {
		entitlement: {
			id: entitlement.id,
			festivalId: entitlement.festivalId,
			festivalClassId: entitlement.festivalClassId,
			childId: entitlement.childId,
			status: entitlement.status,
			createdAt: entitlement.createdAt,
			updatedAt: entitlement.updatedAt,
		},
		festivalClass: mapPortFestivalClass(festivalClass),
		child,
		metadata: mapPortMetadata(metadata),
		paidAtIso: ctx.paidAtByOrderGid.get(entitlement.shopifyOrderGid) ?? null,
		metadataEditCutoffIso: editCutoff?.toISOString() ?? null,
		canEditMetadata: Boolean(
			metadata &&
				festivalClass &&
				editCutoff &&
				ctx.nowMs < editCutoff.getTime(),
		),
	};
}

export function toRegistrationEligibleClassDto(
	item: FestivalClassConfiguration,
	subtypeById: Map<string, RegistrationCatalogValue>,
	isRegistrationOpen: boolean,
	placedCounts?: Map<string, number>,
): RegistrationEligibleClass {
	const placedCount = placedCounts
		? (placedCounts.get(item.id) ?? 0)
		: undefined;
	const subtype = subtypeById.get(item.classSubtypeId) ?? null;
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
		isRegistrationOpen,
		...(placedCount !== undefined
			? {
					placedCount,
					availability: evaluateClassCapacityStatus(item.capacity, placedCount)
						.availability,
				}
			: {}),
	};
}
