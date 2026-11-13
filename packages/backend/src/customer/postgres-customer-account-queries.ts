import { randomUUID } from "node:crypto";
import type {
	FestivalChildAgeSnapshot,
	FestivalChildRecord,
} from "@festival/common";
import { sql } from "bun";
import type {
	ApplyCustomerProfileInput,
	CustomerAccountIntegrationRecord,
	CustomerSessionRecord,
	FestivalCustomerRecord,
} from "./customer-account-repository.js";
import {
	type ChildRow,
	type ChildWithAgeSnapshotCteRow,
	type CustomerRow,
	childAgeSnapshot,
	childRecord,
	customer,
	integration,
	type JoinedSessionCustomerIntegrationRow,
	session,
} from "./postgres-customer-account-mappers.js";

export interface CreateChildWithAgeSnapshotInput {
	child: Omit<FestivalChildRecord, "id" | "createdAtIso">;
	snapshot: Omit<
		FestivalChildAgeSnapshot,
		"id" | "childId" | "organizationId" | "createdAtIso" | "supersededAtIso"
	>;
}

function extractJoinedCustomer(
	row: JoinedSessionCustomerIntegrationRow,
): FestivalCustomerRecord | null {
	if (
		!row.c_id ||
		!row.c_organization_id ||
		!row.c_shopify_customer_gid ||
		!row.c_created_at ||
		!row.c_updated_at
	) {
		return null;
	}
	return customer({
		id: row.c_id,
		organization_id: row.c_organization_id,
		shopify_customer_gid: row.c_shopify_customer_gid,
		name: row.c_name,
		name_source: row.c_name_source,
		name_updated_at: row.c_name_updated_at,
		email: row.c_email,
		email_source: row.c_email_source,
		email_updated_at: row.c_email_updated_at,
		mailing_address: row.c_mailing_address,
		mailing_address_source: row.c_mailing_address_source,
		mailing_address_updated_at: row.c_mailing_address_updated_at,
		phone: row.c_phone,
		phone_source: row.c_phone_source,
		phone_updated_at: row.c_phone_updated_at,
		created_at: row.c_created_at,
		updated_at: row.c_updated_at,
	});
}

function extractJoinedIntegration(
	row: JoinedSessionCustomerIntegrationRow,
): CustomerAccountIntegrationRecord | null {
	if (
		!row.i_organization_id ||
		!row.i_storefront_domain ||
		!row.i_client_id ||
		!row.i_encrypted_client_secret ||
		!row.i_readiness ||
		row.i_can_read_orders === null ||
		row.i_can_read_orders === undefined ||
		row.i_integration_version === null ||
		row.i_integration_version === undefined ||
		!row.i_created_at ||
		!row.i_updated_at
	) {
		return null;
	}
	return integration({
		organization_id: row.i_organization_id,
		storefront_domain: row.i_storefront_domain,
		client_id: row.i_client_id,
		encrypted_client_secret: row.i_encrypted_client_secret,
		readiness: row.i_readiness,
		can_read_orders: row.i_can_read_orders,
		integration_version: row.i_integration_version,
		verified_at: row.i_verified_at,
		last_error: row.i_last_error,
		created_at: row.i_created_at,
		updated_at: row.i_updated_at,
	});
}

export async function queryJoinedSessionCustomerIntegration(
	schema: string,
	sessionId: string,
	organizationId: string,
): Promise<
	| {
			session: CustomerSessionRecord;
			customer: FestivalCustomerRecord | null;
			integration: CustomerAccountIntegrationRecord | null;
	  }
	| { organizationMismatch: true }
	| null
> {
	const rows = (await sql.unsafe(
		`SELECT s.session_id AS s_session_id, s.customer_id AS s_customer_id, s.organization_id AS s_organization_id, s.shopify_customer_gid AS s_shopify_customer_gid, s.encrypted_tokens AS s_encrypted_tokens, s.csrf_token AS s_csrf_token, s.integration_version AS s_integration_version, s.created_at AS s_created_at, s.last_seen_at AS s_last_seen_at, s.expires_at AS s_expires_at, s.revoked_at AS s_revoked_at, c.id AS c_id, c.organization_id AS c_organization_id, c.shopify_customer_gid AS c_shopify_customer_gid, c.name AS c_name, c.name_source AS c_name_source, c.name_updated_at AS c_name_updated_at, c.email AS c_email, c.email_source AS c_email_source, c.email_updated_at AS c_email_updated_at, c.mailing_address AS c_mailing_address, c.mailing_address_source AS c_mailing_address_source, c.mailing_address_updated_at AS c_mailing_address_updated_at, c.phone AS c_phone, c.phone_source AS c_phone_source, c.phone_updated_at AS c_phone_updated_at, c.created_at AS c_created_at, c.updated_at AS c_updated_at, i.organization_id AS i_organization_id, i.storefront_domain AS i_storefront_domain, i.client_id AS i_client_id, i.encrypted_client_secret AS i_encrypted_client_secret, i.readiness AS i_readiness, i.can_read_orders AS i_can_read_orders, i.integration_version AS i_integration_version, i.verified_at AS i_verified_at, i.last_error AS i_last_error, i.created_at AS i_created_at, i.updated_at AS i_updated_at
		FROM ${schema}.shopify_customer_sessions s
		LEFT JOIN ${schema}.festival_customers c ON c.id = s.customer_id AND c.organization_id = $2
		LEFT JOIN ${schema}.shopify_customer_account_integrations i ON i.organization_id = $2
		WHERE s.session_id = $1`,
		[sessionId, organizationId],
	)) as JoinedSessionCustomerIntegrationRow[];
	const row = rows[0];
	if (!row) return null;
	if (row.s_organization_id !== organizationId) {
		return { organizationMismatch: true };
	}
	return {
		session: session({
			session_id: row.s_session_id,
			customer_id: row.s_customer_id,
			organization_id: row.s_organization_id,
			shopify_customer_gid: row.s_shopify_customer_gid,
			encrypted_tokens: row.s_encrypted_tokens,
			csrf_token: row.s_csrf_token,
			integration_version: row.s_integration_version,
			created_at: row.s_created_at,
			last_seen_at: row.s_last_seen_at,
			expires_at: row.s_expires_at,
			revoked_at: row.s_revoked_at,
		}),
		customer: extractJoinedCustomer(row),
		integration: extractJoinedIntegration(row),
	};
}

export async function updateCustomerProfileRow(
	schema: string,
	input: ApplyCustomerProfileInput,
): Promise<FestivalCustomerRecord | null> {
	const rows = (await sql.unsafe(
		`UPDATE ${schema}.festival_customers SET
		name=CASE WHEN $5::text IS NULL OR ($3='shopify' AND name_source='festival') OR name_updated_at>$4 THEN name ELSE $5 END,
		name_source=CASE WHEN $5::text IS NULL OR ($3='shopify' AND name_source='festival') OR name_updated_at>$4 THEN name_source ELSE $3 END,
		name_updated_at=CASE WHEN $5::text IS NULL OR ($3='shopify' AND name_source='festival') OR name_updated_at>$4 THEN name_updated_at ELSE $4 END,
		email=CASE WHEN $6::text IS NULL OR ($3='shopify' AND email_source='festival') OR email_updated_at>$4 THEN email ELSE $6 END,
		email_source=CASE WHEN $6::text IS NULL OR ($3='shopify' AND email_source='festival') OR email_updated_at>$4 THEN email_source ELSE $3 END,
		email_updated_at=CASE WHEN $6::text IS NULL OR ($3='shopify' AND email_source='festival') OR email_updated_at>$4 THEN email_updated_at ELSE $4 END,
		mailing_address=CASE WHEN $7::jsonb IS NULL OR ($3='shopify' AND mailing_address_source='festival') OR mailing_address_updated_at>$4 THEN mailing_address ELSE $7::jsonb END,
		mailing_address_source=CASE WHEN $7::jsonb IS NULL OR ($3='shopify' AND mailing_address_source='festival') OR mailing_address_updated_at>$4 THEN mailing_address_source ELSE $3 END,
		mailing_address_updated_at=CASE WHEN $7::jsonb IS NULL OR ($3='shopify' AND mailing_address_source='festival') OR mailing_address_updated_at>$4 THEN mailing_address_updated_at ELSE $4 END,
		phone=CASE WHEN $8::text IS NULL OR ($3='shopify' AND phone_source='festival') OR phone_updated_at>$4 THEN phone ELSE $8 END,
		phone_source=CASE WHEN $8::text IS NULL OR ($3='shopify' AND phone_source='festival') OR phone_updated_at>$4 THEN phone_source ELSE $3 END,
		phone_updated_at=CASE WHEN $8::text IS NULL OR ($3='shopify' AND phone_source='festival') OR phone_updated_at>$4 THEN phone_updated_at ELSE $4 END,
		updated_at=GREATEST(updated_at,$4)
		WHERE organization_id=$1 AND id=$2 RETURNING *`,
		[
			input.organizationId,
			input.customerId,
			input.source,
			input.updatedAtIso,
			input.profile.name ?? null,
			input.profile.email ?? null,
			input.profile.mailingAddress ?? null,
			input.profile.phone ?? null,
		],
	)) as CustomerRow[];
	return rows[0] ? customer(rows[0]) : null;
}

export async function insertChildWithAgeSnapshotCte(
	schema: string,
	input: CreateChildWithAgeSnapshotInput,
): Promise<{
	child: FestivalChildRecord;
	ageSnapshot: FestivalChildAgeSnapshot;
}> {
	const childId = randomUUID();
	const snapshotId = randomUUID();
	const createdAtIso = new Date().toISOString();
	const rows = (await sql.unsafe(
		`WITH inserted_child AS (
			INSERT INTO ${schema}.festival_children (id, organization_id, parent_customer_id, display_name, created_at)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id, organization_id, parent_customer_id, display_name, created_at
		),
		inserted_snapshot AS (
			INSERT INTO ${schema}.festival_child_age_snapshots (id, child_id, organization_id, age, created_at, valid_until)
			SELECT $6, c.id, c.organization_id, $7, $5, $8
			FROM inserted_child c
			RETURNING id, child_id, organization_id, age, created_at, valid_until, superseded_at
		)
		SELECT c.id AS child_id, c.organization_id AS child_organization_id, c.parent_customer_id AS child_parent_customer_id, c.display_name AS child_display_name, c.created_at AS child_created_at, s.id AS snapshot_id, s.child_id AS snapshot_child_id, s.organization_id AS snapshot_organization_id, s.age AS snapshot_age, s.created_at AS snapshot_created_at, s.valid_until AS snapshot_valid_until, s.superseded_at AS snapshot_superseded_at
		FROM inserted_child c CROSS JOIN inserted_snapshot s`,
		[
			childId,
			input.child.organizationId,
			input.child.parentCustomerId,
			input.child.displayName,
			createdAtIso,
			snapshotId,
			input.snapshot.age,
			input.snapshot.validUntilIso,
		],
	)) as ChildWithAgeSnapshotCteRow[];
	const row = rows[0];
	if (!row) throw new Error("Failed to create child with age snapshot.");
	return {
		child: childRecord({
			id: row.child_id,
			organization_id: row.child_organization_id,
			parent_customer_id: row.child_parent_customer_id,
			display_name: row.child_display_name,
			created_at: row.child_created_at,
		}),
		ageSnapshot: childAgeSnapshot({
			id: row.snapshot_id,
			child_id: row.snapshot_child_id,
			organization_id: row.snapshot_organization_id,
			age: row.snapshot_age,
			created_at: row.snapshot_created_at,
			valid_until: row.snapshot_valid_until,
			superseded_at: row.snapshot_superseded_at,
		}),
	};
}

export async function queryChildrenByIds(
	schema: string,
	scope: { organizationId: string; parentCustomerId: string },
	childIds: readonly string[],
): Promise<FestivalChildRecord[]> {
	if (childIds.length === 0) return [];
	const rows = (await sql.unsafe(
		`SELECT id, organization_id, parent_customer_id, display_name, created_at
		FROM ${schema}.festival_children
		WHERE organization_id = $1 AND parent_customer_id = $2 AND id = ANY($3::text[])`,
		[
			scope.organizationId,
			scope.parentCustomerId,
			sql.array([...childIds], "text"),
		],
	)) as ChildRow[];
	return rows.map(childRecord);
}
