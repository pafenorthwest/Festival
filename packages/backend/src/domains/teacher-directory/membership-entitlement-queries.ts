import { randomUUID } from "node:crypto";
import {
	type AccompanistMembershipGrant,
	AppError,
	addCalendarDays,
	assertValidEntitlementGrantSnapshotInput,
	type CreateEntitlementGrantSnapshotInput,
	type EntitlementGrantSnapshot,
	normalizeVerifiedShopifyIdentityEmail,
} from "@festival/common";
import { sql } from "bun";
import { AccompanistMembershipConflictError } from "../../infra/s10-infra.js";
import type { CreateAccompanistMembershipGrantInput } from "./types.js";

class AccompanistMembershipCohortContentionError extends Error {}

function isAccompanistMembershipConflict(error: unknown): boolean {
	return (
		error instanceof Error && /unique|duplicate|exclusion/i.test(error.message)
	);
}

function isTeacherOverlapError(error: unknown): boolean {
	const code =
		error && typeof error === "object"
			? ((error as { code?: string; errno?: string }).code ??
				(error as { code?: string; errno?: string }).errno)
			: undefined;
	const message =
		error && typeof error === "object" && "message" in error
			? String((error as { message?: unknown }).message)
			: "";
	return (
		code === "23P01" ||
		message.includes(
			"membership_entitlements_organization_id_customer_id_entitl_excl",
		)
	);
}

export async function createTeacherEntitlementGrantTx(
	schema: string,
	input: CreateEntitlementGrantSnapshotInput,
): Promise<EntitlementGrantSnapshot> {
	assertValidEntitlementGrantSnapshotInput(input);
	const verifiedEmail = normalizeVerifiedShopifyIdentityEmail(
		input.verifiedIdentityEmail,
	);
	if (input.entitlementClass !== "teacher_membership") {
		throw new Error("Teacher checkout source requires a teacher entitlement.");
	}
	const id = randomUUID();
	let effectiveEndsOn = input.endsOn;
	try {
		await sql.begin(async (tx) => {
			effectiveEndsOn = await insertTeacherEntitlementRows(
				tx,
				schema,
				id,
				verifiedEmail,
				input,
			);
		});
	} catch (error) {
		if (isTeacherOverlapError(error)) {
			throw new Error(
				"Teacher Membership entitlement intervals may not overlap.",
			);
		}
		throw error;
	}
	return {
		...input,
		endsOn: effectiveEndsOn,
		id,
		createdAtIso: new Date().toISOString(),
	};
}

async function persistTeacherChildTables(
	tx: Pick<typeof sql, "unsafe">,
	schema: string,
	id: string,
	input: CreateEntitlementGrantSnapshotInput,
): Promise<void> {
	await tx.unsafe(
		`INSERT INTO ${schema}.membership_entitlement_divisions (entitlement_id,organization_id,division_id,division_name_snapshot) VALUES ($1,$2,$3,$4)`,
		[id, input.organizationId, input.divisionId, input.divisionNameSnapshot],
	);
	await tx.unsafe(
		`INSERT INTO ${schema}.teacher_membership_entitlement_details (entitlement_id,checkout_intent_id,shopify_order_gid,shopify_order_line_gid,paid_amount,paid_currency_code,duration_days) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
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
}

async function assertNoDuplicateTeacherCorrelation(
	tx: Pick<typeof sql, "unsafe">,
	schema: string,
	input: CreateEntitlementGrantSnapshotInput,
): Promise<void> {
	const dupRows = await tx.unsafe(
		`SELECT 1 FROM ${schema}.teacher_membership_entitlement_details d JOIN ${schema}.membership_entitlements e ON e.id = d.entitlement_id WHERE e.organization_id = $1 AND (d.checkout_intent_id = $2 OR d.shopify_order_line_gid = $3) LIMIT 1`,
		[input.organizationId, input.checkoutIntentId, input.shopifyOrderLineGid],
	);
	if (dupRows[0]) {
		throw new Error("Entitlement grant correlation is already recorded.");
	}
}

async function insertTeacherEntitlementRows(
	tx: Pick<typeof sql, "unsafe">,
	schema: string,
	id: string,
	verifiedEmail: string,
	input: CreateEntitlementGrantSnapshotInput,
): Promise<string> {
	const offeringRows = await tx.unsafe(
		`SELECT id FROM ${schema}.products WHERE id=$1 AND organization_id=$2 AND entitlement_class=$3`,
		[input.offeringId, input.organizationId, input.entitlementClass],
	);
	if (!offeringRows[0]) {
		throw new Error(
			"Entitlement offering was not found for this Organization.",
		);
	}
	await assertNoDuplicateTeacherCorrelation(tx, schema, input);
	const identityRows = (await tx.unsafe(
		`INSERT INTO ${schema}.membership_identity_emails (organization_id, normalized_email, customer_id) VALUES ($1,$2,$3) ON CONFLICT (organization_id, normalized_email) DO UPDATE SET customer_id = EXCLUDED.customer_id WHERE ${schema}.membership_identity_emails.customer_id = EXCLUDED.customer_id RETURNING customer_id`,
		[input.organizationId, verifiedEmail, input.customerId],
	)) as Array<Record<string, unknown>>;
	if (!identityRows[0]) {
		throw new Error("Shopify identity email belongs to another customer.");
	}
	const supersededRows = (await tx.unsafe(
		`UPDATE ${schema}.membership_entitlements SET superseded_on = $4::date, superseded_at = NOW(), superseded_by_grant_id = $5 WHERE organization_id = $1 AND customer_id = $2 AND entitlement_class = $3 AND revoked_at IS NULL AND superseded_on IS NULL AND starts_on <= $4::date AND ends_on > $4::date AND ends_on <= ($4::date + INTERVAL '30 days')::date RETURNING ends_on::text`,
		[
			input.organizationId,
			input.customerId,
			input.entitlementClass,
			input.startsOn,
			id,
		],
	)) as Array<{ ends_on?: string }>;
	const priorEnd = supersededRows[0]?.ends_on;
	const effectiveEndsOn =
		priorEnd && priorEnd > input.startsOn
			? addCalendarDays(priorEnd, input.durationDays)
			: input.endsOn;
	await tx.unsafe(
		`INSERT INTO ${schema}.membership_entitlements (id,organization_id,customer_id,entitlement_class,source,offering_id,starts_on,ends_on) VALUES ($1,$2,$3,$4,'teacher_checkout',$5,$6::date,$7::date)`,
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
	await persistTeacherChildTables(tx, schema, id, input);
	return effectiveEndsOn;
}

export async function createAccompanistGrantTx(
	schema: string,
	input: CreateAccompanistMembershipGrantInput,
): Promise<AccompanistMembershipGrant> {
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			return await sql.begin((tx) =>
				insertAccompanistGrantRows(tx, schema, input),
			);
		} catch (error) {
			if (
				error instanceof AccompanistMembershipCohortContentionError &&
				attempt === 0
			) {
				continue;
			}
			if (
				error instanceof AccompanistMembershipCohortContentionError ||
				isAccompanistMembershipConflict(error)
			) {
				throw new AccompanistMembershipConflictError();
			}
			throw error;
		}
	}
	throw new Error("Unreachable accompanist membership contention state.");
}

async function persistAccompanistDetails(
	tx: Pick<typeof sql, "unsafe">,
	schema: string,
	entitlementId: string,
	input: CreateAccompanistMembershipGrantInput,
): Promise<void> {
	await tx.unsafe(
		`INSERT INTO ${schema}.accompanist_membership_entitlement_details (entitlement_id,contact_name,contact_email,contact_city,contact_phone) VALUES ($1,$2,$3,$4,$5)`,
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
			`INSERT INTO ${schema}.membership_entitlement_divisions (entitlement_id,organization_id,division_id,division_name_snapshot) VALUES ($1,$2,$3,$4)`,
			[
				entitlementId,
				input.organizationId,
				division.divisionId,
				division.divisionName,
			],
		);
	}
}

async function insertAccompanistGrantRows(
	tx: Pick<typeof sql, "unsafe">,
	schema: string,
	input: CreateAccompanistMembershipGrantInput,
): Promise<AccompanistMembershipGrant> {
	const entitlementId = randomUUID();
	const identityRows = (await tx.unsafe(
		`INSERT INTO ${schema}.membership_identity_emails (organization_id, normalized_email, customer_id) VALUES ($1,$2,$3) ON CONFLICT (organization_id, normalized_email) DO UPDATE SET customer_id = ${schema}.membership_identity_emails.customer_id WHERE ${schema}.membership_identity_emails.customer_id = EXCLUDED.customer_id RETURNING customer_id`,
		[input.organizationId, input.normalizedEmail, input.customerId],
	)) as Array<Record<string, unknown>>;
	if (!identityRows[0]) {
		throw new Error("Shopify identity email belongs to another customer.");
	}
	await tx.unsafe(
		`INSERT INTO ${schema}.membership_entitlement_cohorts (organization_id, customer_id, entitlement_class) VALUES ($1,$2,'accompanist_membership') ON CONFLICT DO NOTHING`,
		[input.organizationId, input.customerId],
	);
	const cohort = (await tx.unsafe(
		`SELECT version FROM ${schema}.membership_entitlement_cohorts WHERE organization_id=$1 AND customer_id=$2 AND entitlement_class='accompanist_membership' FOR UPDATE`,
		[input.organizationId, input.customerId],
	)) as Array<{ version: number }>;
	const advanced =
		cohort[0] &&
		(await tx.unsafe(
			`UPDATE ${schema}.membership_entitlement_cohorts SET version=version+1 WHERE organization_id=$1 AND customer_id=$2 AND entitlement_class='accompanist_membership' AND version=$3 RETURNING version`,
			[input.organizationId, input.customerId, cohort[0].version],
		));
	if (!advanced || advanced.count !== 1) {
		throw new AccompanistMembershipCohortContentionError();
	}
	const inserted = await tx.unsafe(
		`INSERT INTO ${schema}.membership_entitlements (id,organization_id,customer_id,entitlement_class,source,offering_id,starts_on,ends_on) VALUES ($1,$2,$3,'accompanist_membership','accompanist_form',NULL,$4::date,$5::date) RETURNING id`,
		[
			entitlementId,
			input.organizationId,
			input.customerId,
			input.startsOn,
			input.endsOn,
		],
	);
	if (!inserted[0]) throw new Error("Unable to create accompanist membership.");
	await persistAccompanistDetails(tx, schema, entitlementId, input);
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

async function applyEntitlementRevocation(
	tx: Pick<typeof sql, "unsafe">,
	schema: string,
	customerId: string,
	entitlementClass: string,
	input: {
		organizationId: string;
		entitlementId: string;
		actorUserId: string;
		reason: string;
		revokedAtIso: string;
	},
) {
	await tx.unsafe(
		`UPDATE ${schema}.membership_entitlements SET revoked_at=$3::timestamptz, revoked_reason=$4 WHERE id=$1 AND organization_id=$2`,
		[
			input.entitlementId,
			input.organizationId,
			input.revokedAtIso,
			input.reason,
		],
	);
	const id = randomUUID();
	await tx.unsafe(
		`INSERT INTO ${schema}.membership_entitlement_revocations (id,entitlement_id,organization_id,actor_user_id,reason,revoked_at) VALUES ($1,$2,$3,$4,$5,$6::timestamptz)`,
		[
			id,
			input.entitlementId,
			input.organizationId,
			input.actorUserId,
			input.reason,
			input.revokedAtIso,
		],
	);
	await tx.unsafe(
		`INSERT INTO ${schema}.membership_entitlement_cohorts (organization_id,customer_id,entitlement_class) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
		[input.organizationId, customerId, entitlementClass],
	);
	await tx.unsafe(
		`UPDATE ${schema}.membership_entitlement_cohorts SET version=version+1 WHERE organization_id=$1 AND customer_id=$2 AND entitlement_class=$3`,
		[input.organizationId, customerId, entitlementClass],
	);
	return {
		revocation: {
			id,
			entitlementId: input.entitlementId,
			organizationId: input.organizationId,
			actorUserId: input.actorUserId,
			reason: input.reason,
			revokedAtIso: input.revokedAtIso,
		},
		existing: false,
	};
}

async function findExistingRevocation(
	tx: Pick<typeof sql, "unsafe">,
	schema: string,
	entitlementId: string,
	organizationId: string,
) {
	const existing = (await tx.unsafe(
		`SELECT id, entitlement_id, organization_id, actor_user_id, reason, revoked_at::text FROM ${schema}.membership_entitlement_revocations WHERE entitlement_id=$1 AND organization_id=$2`,
		[entitlementId, organizationId],
	)) as Array<{
		id: string;
		entitlement_id: string;
		organization_id: string;
		actor_user_id: string;
		reason: string;
		revoked_at: string;
	}>;
	if (!existing[0]) return null;
	return {
		revocation: {
			id: existing[0].id,
			entitlementId: existing[0].entitlement_id,
			organizationId: existing[0].organization_id,
			actorUserId: existing[0].actor_user_id,
			reason: existing[0].reason,
			revokedAtIso: existing[0].revoked_at,
		},
		existing: true,
	};
}

async function runRevokeEntitlementTx(
	tx: Pick<typeof sql, "unsafe">,
	schema: string,
	input: {
		organizationId: string;
		entitlementId: string;
		actorUserId: string;
		reason: string;
		revokedAtIso: string;
	},
) {
	const initial = (await tx.unsafe(
		`SELECT customer_id FROM ${schema}.membership_entitlements WHERE id=$1 AND organization_id=$2`,
		[input.entitlementId, input.organizationId],
	)) as Array<{ customer_id: string }>;
	if (!initial[0]) throw new AppError("Entitlement was not found.", 404);
	await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
		`${input.organizationId}:${initial[0].customer_id}`,
	]);
	const entitlement = (await tx.unsafe(
		`SELECT e.customer_id, e.entitlement_class, (e.ends_on <= (NOW() AT TIME ZONE o.timezone)::date) AS is_expired FROM ${schema}.membership_entitlements e JOIN ${schema}.organizations o ON o.id = e.organization_id WHERE e.id=$1 AND e.organization_id=$2 FOR UPDATE OF e`,
		[input.entitlementId, input.organizationId],
	)) as Array<{
		customer_id: string;
		entitlement_class: string;
		is_expired: boolean;
	}>;
	if (!entitlement[0]) throw new AppError("Entitlement was not found.", 404);
	const existing = await findExistingRevocation(
		tx,
		schema,
		input.entitlementId,
		input.organizationId,
	);
	if (existing) return existing;
	if (entitlement[0].is_expired) {
		throw new AppError("Expired entitlements cannot be revoked.", 409);
	}
	return applyEntitlementRevocation(
		tx,
		schema,
		entitlement[0].customer_id,
		entitlement[0].entitlement_class,
		input,
	);
}

export async function revokeEntitlementTx(
	schema: string,
	input: {
		organizationId: string;
		entitlementId: string;
		actorUserId: string;
		reason: string;
		revokedAtIso: string;
	},
) {
	return sql.begin((tx) => runRevokeEntitlementTx(tx, schema, input));
}
