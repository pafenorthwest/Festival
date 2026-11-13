import type {
	AccompanistMembershipGrant,
	CreateEntitlementGrantSnapshotInput,
	EntitlementGrantSnapshot,
} from "@festival/common";
import { sql } from "bun";
import {
	initializePostgresSchema,
	postgresSchemaName,
} from "../../infra/s10-infra.js";
import {
	type AccompanistMembershipGrantRow,
	type EntitlementGrantRow,
	mapAccompanistGrantRow,
	mapEntitlementGrantRow,
} from "./mappers.js";
import {
	createAccompanistGrantTx,
	createTeacherEntitlementGrantTx,
	revokeEntitlementTx,
} from "./membership-entitlement-queries.js";
import type {
	CreateAccompanistMembershipGrantInput,
	MembershipCustomerContact,
	MembershipEntitlementRepository,
} from "./types.js";

/** Postgres repository for teacher and accompanist membership entitlements. */
export class PostgresMembershipEntitlementRepository
	implements MembershipEntitlementRepository
{
	private readonly schema: string;

	constructor(schema: string) {
		this.schema = postgresSchemaName(schema);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async createEntitlementGrantSnapshot(
		input: CreateEntitlementGrantSnapshotInput,
	): Promise<EntitlementGrantSnapshot> {
		await this.ensureReady();
		return createTeacherEntitlementGrantTx(this.schema, input);
	}

	async findActiveTeacherEntitlementGrant(input: {
		organizationId: string;
		customerId: string;
		divisionId: string;
	}): Promise<EntitlementGrantSnapshot | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT e.id,e.organization_id,e.customer_id,e.entitlement_class,e.offering_id,d.duration_days,ed.division_id,ed.division_name_snapshot,d.paid_amount,d.paid_currency_code,d.checkout_intent_id,d.shopify_order_gid,d.shopify_order_line_gid,e.starts_on::text,e.ends_on::text,e.superseded_on::text,e.superseded_at,e.superseded_by_grant_id,'active' AS status,e.created_at
			FROM ${this.schema}.membership_entitlements e
			JOIN ${this.schema}.organizations o ON o.id=e.organization_id
			JOIN ${this.schema}.teacher_membership_entitlement_details d ON d.entitlement_id=e.id
			JOIN ${this.schema}.membership_entitlement_divisions ed ON ed.entitlement_id=e.id
			WHERE e.organization_id=$1 AND e.customer_id=$2 AND e.entitlement_class='teacher_membership' AND ed.division_id=$3
			  AND e.revoked_at IS NULL AND (e.superseded_on IS NULL OR e.superseded_on > (NOW() AT TIME ZONE o.timezone)::date)
			  AND e.starts_on <= (NOW() AT TIME ZONE o.timezone)::date AND e.ends_on > (NOW() AT TIME ZONE o.timezone)::date
			ORDER BY e.created_at ASC, e.id ASC LIMIT 1`,
			[input.organizationId, input.customerId, input.divisionId],
		)) as EntitlementGrantRow[];
		return rows[0] ? mapEntitlementGrantRow(rows[0]) : null;
	}

	async listEntitlementGrantSnapshots(
		organizationId: string,
		customerId?: string,
	): Promise<EntitlementGrantSnapshot[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT e.id,e.organization_id,e.customer_id,e.entitlement_class,e.offering_id,d.duration_days,ed.division_id,ed.division_name_snapshot,d.paid_amount,d.paid_currency_code,d.checkout_intent_id,d.shopify_order_gid,d.shopify_order_line_gid,e.starts_on::text,e.ends_on::text,e.superseded_on::text,e.superseded_at,e.superseded_by_grant_id,CASE WHEN e.revoked_at IS NOT NULL THEN 'revoked' WHEN e.superseded_on IS NOT NULL AND e.superseded_on <= (NOW() AT TIME ZONE o.timezone)::date THEN 'superseded' WHEN e.starts_on > (NOW() AT TIME ZONE o.timezone)::date THEN 'scheduled' WHEN e.ends_on <= (NOW() AT TIME ZONE o.timezone)::date THEN 'expired' ELSE 'active' END AS status,e.created_at
			FROM ${this.schema}.membership_entitlements e
			JOIN ${this.schema}.organizations o ON o.id=e.organization_id
			JOIN ${this.schema}.teacher_membership_entitlement_details d ON d.entitlement_id=e.id
			JOIN ${this.schema}.membership_entitlement_divisions ed ON ed.entitlement_id=e.id
			WHERE e.organization_id=$1 AND ($2::text IS NULL OR e.customer_id=$2)
			ORDER BY e.created_at ASC`,
			[organizationId, customerId ?? null],
		)) as EntitlementGrantRow[];
		return rows.map(mapEntitlementGrantRow);
	}

	async findMembershipCustomerContacts(
		organizationId: string,
		customerIds: string[],
	): Promise<Map<string, MembershipCustomerContact>> {
		await this.ensureReady();
		const result = new Map<string, MembershipCustomerContact>();
		const uniqueIds = Array.from(new Set(customerIds.filter(Boolean)));
		if (uniqueIds.length === 0) return result;
		const rows = (await sql.unsafe(
			`SELECT c.id AS customer_id, c.name, COALESCE(identity.normalized_email, c.email) AS email, c.phone, c.mailing_address->>'city' AS city
			FROM ${this.schema}.festival_customers c
			LEFT JOIN ${this.schema}.membership_identity_emails identity ON identity.organization_id = c.organization_id AND identity.customer_id = c.id
			WHERE c.organization_id = $1 AND c.id = ANY($2::text[])`,
			[organizationId, sql.array(uniqueIds, "text")],
		)) as Array<{
			customer_id: string;
			name: string | null;
			email: string | null;
			phone: string | null;
			city: string | null;
		}>;
		for (const row of rows) {
			result.set(row.customer_id, {
				customerId: row.customer_id,
				...(row.name?.trim() ? { name: row.name.trim() } : {}),
				...(row.email?.trim() ? { email: row.email.trim() } : {}),
				...(row.phone?.trim() ? { phone: row.phone.trim() } : {}),
				...(row.city?.trim() ? { city: row.city.trim() } : {}),
			});
		}
		return result;
	}

	async revokeEntitlement(input: {
		organizationId: string;
		entitlementId: string;
		actorUserId: string;
		reason: string;
		revokedAtIso: string;
	}) {
		await this.ensureReady();
		return revokeEntitlementTx(this.schema, input);
	}

	async createAccompanistMembershipGrant(
		input: CreateAccompanistMembershipGrantInput,
	): Promise<AccompanistMembershipGrant> {
		await this.ensureReady();
		return createAccompanistGrantTx(this.schema, input);
	}

	async findCurrentAccompanistMembershipGrant(input: {
		organizationId: string;
		customerId: string;
	}): Promise<AccompanistMembershipGrant | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT e.id,e.organization_id,e.customer_id,identity.normalized_email,e.offering_id,COALESCE(p.product_name_snapshot,'Accompanist Membership') AS offering_name_snapshot,e.source,d.contact_name,d.contact_email,d.contact_city,d.contact_phone,COALESCE(jsonb_agg(jsonb_build_object('divisionId',ed.division_id,'divisionName',ed.division_name_snapshot)) FILTER (WHERE ed.division_id IS NOT NULL),'[]') AS divisions,e.starts_on::text,e.ends_on::text,'active' AS status,TRUE AS is_current,e.created_at
			FROM ${this.schema}.membership_entitlements e
			JOIN ${this.schema}.organizations o ON o.id=e.organization_id
			LEFT JOIN ${this.schema}.products p ON p.id=e.offering_id
			JOIN ${this.schema}.accompanist_membership_entitlement_details d ON d.entitlement_id=e.id
			LEFT JOIN ${this.schema}.membership_identity_emails identity ON identity.organization_id=e.organization_id AND identity.customer_id=e.customer_id
			LEFT JOIN ${this.schema}.membership_entitlement_divisions ed ON ed.entitlement_id=e.id
			WHERE e.organization_id=$1 AND e.customer_id=$2 AND e.entitlement_class='accompanist_membership' AND e.revoked_at IS NULL AND e.starts_on <= (NOW() AT TIME ZONE o.timezone)::date AND e.ends_on > (NOW() AT TIME ZONE o.timezone)::date
			GROUP BY e.id,identity.normalized_email,p.product_name_snapshot,d.contact_name,d.contact_email,d.contact_city,d.contact_phone,o.timezone
			ORDER BY e.created_at ASC, e.id ASC LIMIT 1`,
			[input.organizationId, input.customerId],
		)) as AccompanistMembershipGrantRow[];
		return rows[0] ? mapAccompanistGrantRow(rows[0]) : null;
	}

	async listAccompanistMembershipGrants(input: {
		organizationId: string;
		customerId?: string;
		normalizedEmail?: string;
		currentOnly?: boolean;
	}): Promise<AccompanistMembershipGrant[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT e.id,e.organization_id,e.customer_id,identity.normalized_email,e.offering_id,COALESCE(p.product_name_snapshot,'Accompanist Membership') AS offering_name_snapshot,e.source,d.contact_name,d.contact_email,d.contact_city,d.contact_phone,COALESCE(jsonb_agg(jsonb_build_object('divisionId',ed.division_id,'divisionName',ed.division_name_snapshot)) FILTER (WHERE ed.division_id IS NOT NULL),'[]') AS divisions,e.starts_on::text,e.ends_on::text,CASE WHEN e.revoked_at IS NOT NULL THEN 'revoked' WHEN e.starts_on > (NOW() AT TIME ZONE o.timezone)::date THEN 'scheduled' WHEN e.ends_on <= (NOW() AT TIME ZONE o.timezone)::date THEN 'expired' ELSE 'active' END AS status,(e.revoked_at IS NULL AND e.starts_on <= (NOW() AT TIME ZONE o.timezone)::date AND e.ends_on > (NOW() AT TIME ZONE o.timezone)::date) AS is_current,e.created_at
			FROM ${this.schema}.membership_entitlements e
			JOIN ${this.schema}.organizations o ON o.id=e.organization_id
			LEFT JOIN ${this.schema}.products p ON p.id=e.offering_id
			JOIN ${this.schema}.accompanist_membership_entitlement_details d ON d.entitlement_id=e.id
			LEFT JOIN ${this.schema}.membership_identity_emails identity ON identity.organization_id=e.organization_id AND identity.customer_id=e.customer_id
			LEFT JOIN ${this.schema}.membership_entitlement_divisions ed ON ed.entitlement_id=e.id
			WHERE e.organization_id=$1 AND e.entitlement_class='accompanist_membership'
			  AND ($2::text IS NULL OR e.customer_id=$2)
			  AND ($3::text IS NULL OR identity.normalized_email=$3)
			  AND ($4::boolean = FALSE OR (e.revoked_at IS NULL AND e.starts_on <= (NOW() AT TIME ZONE o.timezone)::date AND e.ends_on > (NOW() AT TIME ZONE o.timezone)::date))
			GROUP BY e.id,identity.normalized_email,p.product_name_snapshot,d.contact_name,d.contact_email,d.contact_city,d.contact_phone,o.timezone
			ORDER BY e.created_at,e.id`,
			[
				input.organizationId,
				input.customerId ?? null,
				input.normalizedEmail ?? null,
				input.currentOnly ?? false,
			],
		)) as AccompanistMembershipGrantRow[];
		return rows.map(mapAccompanistGrantRow);
	}
}
