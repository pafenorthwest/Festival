import { randomUUID } from "node:crypto";
import {
	type AccompanistMembershipGrant,
	addCalendarDays,
	assertValidEntitlementGrantSnapshotInput,
	type CreateEntitlementGrantSnapshotInput,
	type EntitlementClass,
	type EntitlementGrantSnapshot,
	type EntitlementGrantStatus,
} from "@festival/common";
import type { sql } from "bun";
import type { CreateAccompanistMembershipGrantInput } from "./organization-repository-types.js";

export type SqlRunner = Pick<typeof sql, "unsafe">;

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
	created_at: Date | string;
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
	superseded_at?: Date | string | null;
	superseded_by_grant_id?: string | null;
	status: EntitlementGrantStatus;
	created_at: Date | string;
}

export class AccompanistMembershipCohortContentionError extends Error {}

export function isAccompanistMembershipConflict(error: unknown): boolean {
	return (
		error instanceof Error && /unique|duplicate|exclusion/i.test(error.message)
	);
}

export function mapAccompanistGrant(
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
		createdAtIso:
			row.created_at instanceof Date
				? row.created_at.toISOString()
				: row.created_at,
	};
}

export function mapEntitlementGrant(
	row: EntitlementGrantRow,
): EntitlementGrantSnapshot {
	const supersededAt =
		row.superseded_at instanceof Date
			? row.superseded_at.toISOString()
			: row.superseded_at;
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
		createdAtIso:
			row.created_at instanceof Date
				? row.created_at.toISOString()
				: row.created_at,
	};
	assertValidEntitlementGrantSnapshotInput(grant);
	return grant;
}

async function lockAccompanistIdentityAndCohort(
	tx: SqlRunner,
	schema: string,
	organizationId: string,
	normalizedEmail: string,
	customerId: string,
): Promise<void> {
	const identityRows = (await tx.unsafe(
		`INSERT INTO ${schema}.membership_identity_emails (organization_id, normalized_email, customer_id)
		 VALUES ($1,$2,$3) ON CONFLICT (organization_id, normalized_email)
		 DO UPDATE SET customer_id = ${schema}.membership_identity_emails.customer_id
		 WHERE ${schema}.membership_identity_emails.customer_id = EXCLUDED.customer_id RETURNING customer_id`,
		[organizationId, normalizedEmail, customerId],
	)) as Array<Record<string, unknown>>;
	if (!identityRows[0]) {
		throw new Error("Shopify identity email belongs to another customer.");
	}
	await tx.unsafe(
		`INSERT INTO ${schema}.membership_entitlement_cohorts (organization_id, customer_id, entitlement_class)
		 VALUES ($1,$2,'accompanist_membership') ON CONFLICT DO NOTHING`,
		[organizationId, customerId],
	);
	const cohort = (await tx.unsafe(
		`SELECT version FROM ${schema}.membership_entitlement_cohorts
		 WHERE organization_id=$1 AND customer_id=$2 AND entitlement_class='accompanist_membership' FOR UPDATE`,
		[organizationId, customerId],
	)) as Array<{ version: number }>;
	const advanced =
		cohort[0] &&
		(await tx.unsafe(
			`UPDATE ${schema}.membership_entitlement_cohorts SET version=version+1
			 WHERE organization_id=$1 AND customer_id=$2 AND entitlement_class='accompanist_membership' AND version=$3 RETURNING version`,
			[organizationId, customerId, cohort[0].version],
		));
	if (!advanced || advanced.count !== 1) {
		throw new AccompanistMembershipCohortContentionError();
	}
}

async function insertAccompanistEntitlementDetails(
	tx: SqlRunner,
	schema: string,
	entitlementId: string,
	input: CreateAccompanistMembershipGrantInput,
): Promise<void> {
	await tx.unsafe(
		`INSERT INTO ${schema}.accompanist_membership_entitlement_details
		   (entitlement_id,contact_name,contact_email,contact_city,contact_phone)
		 VALUES ($1,$2,$3,$4,$5)`,
		[
			entitlementId,
			input.contact.name,
			input.contact.email,
			input.contact.city,
			input.contact.phone,
		],
	);
	for (const division of input.divisions) {
		await tx.unsafe(
			`INSERT INTO ${schema}.membership_entitlement_divisions
			   (entitlement_id,organization_id,division_id,division_name_snapshot)
			 VALUES ($1,$2,$3,$4)`,
			[
				entitlementId,
				input.organizationId,
				division.divisionId,
				division.divisionName,
			],
		);
	}
}

export async function insertAccompanistGrantTx(
	tx: SqlRunner,
	schema: string,
	input: CreateAccompanistMembershipGrantInput,
): Promise<AccompanistMembershipGrant> {
	await lockAccompanistIdentityAndCohort(
		tx,
		schema,
		input.organizationId,
		input.normalizedEmail,
		input.customerId,
	);
	const entitlementId = randomUUID();
	const inserted = await tx.unsafe(
		`INSERT INTO ${schema}.membership_entitlements
		   (id,organization_id,customer_id,entitlement_class,source,offering_id,starts_on,ends_on)
		 VALUES ($1,$2,$3,'accompanist_membership','accompanist_form',NULL,$4::date,$5::date) RETURNING id`,
		[
			entitlementId,
			input.organizationId,
			input.customerId,
			input.startsOn,
			input.endsOn,
		],
	);
	if (!inserted[0]) throw new Error("Unable to create accompanist membership.");
	await insertAccompanistEntitlementDetails(tx, schema, entitlementId, input);
	return {
		id: entitlementId,
		organizationId: input.organizationId,
		customerId: input.customerId,
		normalizedEmail: input.normalizedEmail,
		offeringId: input.offeringId,
		offeringNameSnapshot: input.offeringNameSnapshot,
		source: "accompanist_form",
		contact: input.contact,
		divisions: input.divisions,
		startsOn: input.startsOn,
		endsOn: input.endsOn,
		status: "active",
		isCurrent: true,
		createdAtIso: new Date().toISOString(),
	};
}

async function resolveTeacherSupersededEndDate(
	tx: SqlRunner,
	schema: string,
	id: string,
	verifiedIdentityEmail: string,
	input: CreateEntitlementGrantSnapshotInput,
): Promise<string> {
	const identityRows = (await tx.unsafe(
		`INSERT INTO ${schema}.membership_identity_emails (organization_id, normalized_email, customer_id)
		 VALUES ($1,$2,$3) ON CONFLICT (organization_id, normalized_email)
		 DO UPDATE SET customer_id = EXCLUDED.customer_id
		 WHERE ${schema}.membership_identity_emails.customer_id = EXCLUDED.customer_id RETURNING customer_id`,
		[input.organizationId, verifiedIdentityEmail, input.customerId],
	)) as Array<Record<string, unknown>>;
	if (!identityRows[0]) {
		throw new Error("Shopify identity email belongs to another customer.");
	}
	const supersededRows = (await tx.unsafe(
		`UPDATE ${schema}.membership_entitlements
		 SET superseded_on = $4::date, superseded_at = NOW(), superseded_by_grant_id = $5
		 WHERE organization_id = $1 AND customer_id = $2 AND entitlement_class = $3
		   AND revoked_at IS NULL AND superseded_on IS NULL
		   AND starts_on <= $4::date AND ends_on > $4::date
		   AND ends_on <= ($4::date + INTERVAL '30 days')::date
		 RETURNING ends_on::text`,
		[
			input.organizationId,
			input.customerId,
			input.entitlementClass,
			input.startsOn,
			id,
		],
	)) as Array<{ ends_on?: string }>;
	return supersededRows[0]?.ends_on &&
		supersededRows[0].ends_on > input.startsOn
		? addCalendarDays(supersededRows[0].ends_on, input.durationDays)
		: input.endsOn;
}

export async function insertTeacherEntitlementGrantTx(
	tx: SqlRunner,
	schema: string,
	id: string,
	verifiedIdentityEmail: string,
	input: CreateEntitlementGrantSnapshotInput,
): Promise<string> {
	const effectiveEndsOn = await resolveTeacherSupersededEndDate(
		tx,
		schema,
		id,
		verifiedIdentityEmail,
		input,
	);
	const inserted = await tx.unsafe(
		`INSERT INTO ${schema}.membership_entitlements
		   (id,organization_id,customer_id,entitlement_class,source,offering_id,starts_on,ends_on)
		 SELECT $1,$2,$3,$4,'teacher_checkout',$5,$6::date,$7::date
		 FROM ${schema}.products WHERE id=$5 AND organization_id=$2 AND entitlement_class=$4 RETURNING id`,
		[
			id,
			input.organizationId,
			input.customerId,
			input.entitlementClass,
			input.offeringId,
			input.startsOn,
			effectiveEndsOn,
		],
	);
	if (!inserted[0]) {
		throw new Error(
			"Entitlement offering was not found for this Organization.",
		);
	}
	await tx.unsafe(
		`INSERT INTO ${schema}.membership_entitlement_divisions
		   (entitlement_id,organization_id,division_id,division_name_snapshot) VALUES ($1,$2,$3,$4)`,
		[id, input.organizationId, input.divisionId, input.divisionNameSnapshot],
	);
	await tx.unsafe(
		`INSERT INTO ${schema}.teacher_membership_entitlement_details
		   (entitlement_id,checkout_intent_id,shopify_order_gid,shopify_order_line_gid,paid_amount,paid_currency_code,duration_days)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		[
			id,
			input.checkoutIntentId,
			input.shopifyOrderGid,
			input.shopifyOrderLineGid,
			input.paidAmount,
			input.paidCurrencyCode,
			input.durationDays,
		],
	);
	return effectiveEndsOn;
}
