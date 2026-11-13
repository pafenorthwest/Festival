import {
	type AccompanistDivisionSelectionPolicy,
	type AccompanistMembershipGrant,
	type AccompanistProfileRecord,
	assertValidEntitlementDurationDays,
	assertValidEntitlementGrantSnapshotInput,
	type EntitlementClass,
	type EntitlementGrantSnapshot,
	type EntitlementGrantStatus,
	getDeterministicTeacherColor,
	type ProfileApprovalStatus,
	type PublicDirectoryDivisionDto,
	type TeacherProfileRecord,
} from "@festival/common";
import type { ProductRecord } from "./types.js";

export type PgTimestamp = Date | string;

export interface ProductRow {
	id: string;
	organization_id: string;
	product_category: "membership";
	entitlement_class: EntitlementClass;
	duration_days: number;
	is_active: boolean;
	shopify_product_gid: string;
	shopify_variant_gid: string;
	product_name_snapshot: string;
	created_at: PgTimestamp;
	updated_at: PgTimestamp;
}

export interface EntitlementGrantRow {
	id: string;
	organization_id: string;
	customer_id: string;
	entitlement_class: EntitlementClass;
	offering_id: string;
	duration_days: number;
	division_id: string;
	division_name_snapshot: string;
	paid_amount: string;
	paid_currency_code: string;
	checkout_intent_id: string;
	shopify_order_gid: string;
	shopify_order_line_gid: string;
	starts_on: string;
	ends_on: string;
	superseded_on?: string | null;
	superseded_at?: PgTimestamp | null;
	superseded_by_grant_id?: string | null;
	status: EntitlementGrantStatus;
	created_at: PgTimestamp;
}

export interface AccompanistDivisionPolicyRow {
	organization_id: string;
	policy: AccompanistDivisionSelectionPolicy;
	updated_at: PgTimestamp;
}

export interface AccompanistDivisionPolicyHistoryRow
	extends AccompanistDivisionPolicyRow {
	id: string;
	created_at: PgTimestamp;
}

export interface AccompanistMembershipGrantRow {
	id: string;
	organization_id: string;
	customer_id: string;
	normalized_email: string;
	offering_id: string | null;
	offering_name_snapshot: string;
	source: "accompanist_form";
	contact_name: string;
	contact_email: string;
	contact_city: string;
	contact_phone: string;
	divisions: unknown;
	starts_on: string;
	ends_on: string;
	status: "scheduled" | "active" | "superseded" | "expired" | "revoked";
	is_current: boolean;
	created_at: PgTimestamp;
}

export interface TeacherProfileRow {
	id: string;
	organization_id: string;
	customer_id: string;
	display_name: string;
	public_directory_opt_in: boolean;
	approval_status: ProfileApprovalStatus;
	created_at: PgTimestamp;
	updated_at: PgTimestamp;
	zip_code: string | null;
	division_ids: string[] | string;
}

export interface AccompanistProfileRow {
	id: string;
	organization_id: string;
	customer_id: string;
	display_name: string;
	public_directory_opt_in: boolean;
	approval_status: ProfileApprovalStatus;
	created_at: PgTimestamp;
	updated_at: PgTimestamp;
	phone: string | null;
	email: string | null;
	zip_code: string | null;
	division_ids: string[] | string;
}

export interface DirectoryProfileRow {
	id: string;
	customer_id: string;
	display_name: string;
	divisions: unknown;
}

export function toIsoString(value: PgTimestamp): string {
	return value instanceof Date ? value.toISOString() : value;
}

export function parseDivisionIds(
	raw: string[] | string | null | undefined,
): string[] {
	if (!raw) return [];
	if (Array.isArray(raw)) return raw.filter(Boolean);
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
	} catch {
		return [];
	}
}

export function parseApprovedDivisions(
	raw: unknown,
): PublicDirectoryDivisionDto[] {
	const parsed = (
		Array.isArray(raw) ? raw : typeof raw === "string" ? JSON.parse(raw) : []
	) as Array<{ id: string; name: string }>;
	return parsed.map((div) => ({ id: div.id, name: div.name }));
}

export function mapProductRow(row: ProductRow): ProductRecord {
	const durationDays = Number(row.duration_days);
	assertValidEntitlementDurationDays(durationDays);
	return {
		id: row.id,
		organizationId: row.organization_id,
		productCategory: row.product_category,
		entitlementClass: row.entitlement_class,
		durationDays,
		isActive: row.is_active,
		shopifyProductGid: row.shopify_product_gid,
		shopifyVariantGid: row.shopify_variant_gid,
		productNameSnapshot: row.product_name_snapshot,
		createdAtIso: toIsoString(row.created_at),
		updatedAtIso: toIsoString(row.updated_at),
	};
}

export function mapEntitlementGrantRow(
	row: EntitlementGrantRow,
): EntitlementGrantSnapshot {
	const supersededAt = row.superseded_at
		? toIsoString(row.superseded_at)
		: undefined;
	const grant: EntitlementGrantSnapshot = {
		id: row.id,
		organizationId: row.organization_id,
		customerId: row.customer_id,
		entitlementClass: row.entitlement_class,
		offeringId: row.offering_id,
		durationDays: Number(row.duration_days),
		divisionId: row.division_id,
		divisionNameSnapshot: row.division_name_snapshot,
		paidAmount: row.paid_amount,
		paidCurrencyCode: row.paid_currency_code,
		checkoutIntentId: row.checkout_intent_id,
		shopifyOrderGid: row.shopify_order_gid,
		shopifyOrderLineGid: row.shopify_order_line_gid,
		startsOn: row.starts_on,
		endsOn: row.ends_on,
		...(row.superseded_on ? { supersededOn: row.superseded_on } : {}),
		...(supersededAt ? { supersededAt } : {}),
		...(row.superseded_by_grant_id
			? { supersededByGrantId: row.superseded_by_grant_id }
			: {}),
		status: row.status,
		createdAtIso: toIsoString(row.created_at),
	};
	assertValidEntitlementGrantSnapshotInput(grant);
	return grant;
}

export function mapAccompanistGrantRow(
	row: AccompanistMembershipGrantRow,
): AccompanistMembershipGrant {
	if (!Array.isArray(row.divisions)) {
		throw new Error("Accompanist division snapshot is invalid.");
	}
	return {
		id: row.id,
		organizationId: row.organization_id,
		customerId: row.customer_id,
		normalizedEmail: row.normalized_email,
		offeringId: row.offering_id ?? undefined,
		offeringNameSnapshot: row.offering_name_snapshot,
		source: row.source,
		contact: {
			name: row.contact_name,
			email: row.contact_email,
			city: row.contact_city,
			phone: row.contact_phone,
		},
		divisions: row.divisions as AccompanistMembershipGrant["divisions"],
		startsOn: row.starts_on,
		endsOn: row.ends_on,
		status: row.status,
		isCurrent: row.is_current,
		createdAtIso: toIsoString(row.created_at),
	};
}

export function mapTeacherProfileRow(
	row: TeacherProfileRow,
): TeacherProfileRecord {
	return {
		id: row.id,
		organization_id: row.organization_id,
		customer_id: row.customer_id,
		display_name: row.display_name,
		teacher_color: getDeterministicTeacherColor(row.customer_id),
		public_directory_opt_in: row.public_directory_opt_in,
		approval_status: row.approval_status,
		division_ids: parseDivisionIds(row.division_ids),
		created_at: new Date(row.created_at).toISOString(),
		updated_at: new Date(row.updated_at).toISOString(),
		...(row.zip_code ? { zip_code: row.zip_code } : {}),
	};
}

export function mapAccompanistProfileRow(
	row: AccompanistProfileRow,
): AccompanistProfileRecord {
	return {
		id: row.id,
		organization_id: row.organization_id,
		customer_id: row.customer_id,
		display_name: row.display_name,
		public_directory_opt_in: row.public_directory_opt_in,
		approval_status: row.approval_status,
		division_ids: parseDivisionIds(row.division_ids),
		created_at: new Date(row.created_at).toISOString(),
		updated_at: new Date(row.updated_at).toISOString(),
		...(row.phone ? { phone: row.phone } : {}),
		...(row.email ? { email: row.email } : {}),
		...(row.zip_code ? { zip_code: row.zip_code } : {}),
	};
}
