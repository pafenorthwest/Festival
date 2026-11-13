import type {
	CustomerMailingAddress,
	FestivalChildAgeSnapshot,
	FestivalChildRecord,
} from "@festival/common";
import type {
	CustomerAccountIntegrationRecord,
	CustomerOAuthStateRecord,
	CustomerSessionRecord,
	CustomerStaffAccessConsentRecord,
	FestivalCustomerRecord,
} from "./customer-account-repository.js";

export type PgTimestamp = Date | string;

export interface IntegrationRow {
	organization_id: string;
	storefront_domain: string;
	client_id: string;
	encrypted_client_secret: string;
	readiness: "unknown" | "ready" | "failed";
	can_read_orders: boolean;
	integration_version: number | string;
	verified_at: PgTimestamp | null;
	last_error: string | null;
	created_at: PgTimestamp;
	updated_at: PgTimestamp;
}

export interface SessionRow {
	session_id: string;
	customer_id: string;
	organization_id: string;
	shopify_customer_gid: string;
	encrypted_tokens: string;
	csrf_token: string;
	integration_version: number | string;
	created_at: PgTimestamp;
	last_seen_at: PgTimestamp;
	expires_at: PgTimestamp;
	revoked_at: PgTimestamp | null;
}

export interface CustomerRow {
	id: string;
	organization_id: string;
	shopify_customer_gid: string;
	name: string | null;
	name_source: "shopify" | "festival" | null;
	name_updated_at: PgTimestamp | null;
	email: string | null;
	email_source: "shopify" | "festival" | null;
	email_updated_at: PgTimestamp | null;
	mailing_address: CustomerMailingAddress | string | null;
	mailing_address_source: "shopify" | "festival" | null;
	mailing_address_updated_at: PgTimestamp | null;
	phone: string | null;
	phone_source: "shopify" | "festival" | null;
	phone_updated_at: PgTimestamp | null;
	created_at: PgTimestamp;
	updated_at: PgTimestamp;
}

export interface StateRow {
	state_hash: string;
	organization_id: string;
	nonce: string;
	return_to: string;
	offering_id: string | null;
	expires_at: PgTimestamp;
}

export interface ChildRow {
	id: string;
	organization_id: string;
	parent_customer_id: string;
	display_name: string;
	created_at: PgTimestamp;
}

export interface ChildAgeSnapshotRow {
	id: string;
	child_id: string;
	organization_id: string;
	age: number | string;
	created_at: PgTimestamp;
	valid_until: PgTimestamp;
	superseded_at: PgTimestamp | null;
}

export interface ConsentRow {
	customer_id: string;
	organization_id: string;
	privacy_notice_version: string;
	consented_at: PgTimestamp;
}

export interface JoinedSessionCustomerIntegrationRow {
	s_session_id: string;
	s_customer_id: string;
	s_organization_id: string;
	s_shopify_customer_gid: string;
	s_encrypted_tokens: string;
	s_csrf_token: string;
	s_integration_version: number | string;
	s_created_at: PgTimestamp;
	s_last_seen_at: PgTimestamp;
	s_expires_at: PgTimestamp;
	s_revoked_at: PgTimestamp | null;
	c_id: string | null;
	c_organization_id: string | null;
	c_shopify_customer_gid: string | null;
	c_name: string | null;
	c_name_source: "shopify" | "festival" | null;
	c_name_updated_at: PgTimestamp | null;
	c_email: string | null;
	c_email_source: "shopify" | "festival" | null;
	c_email_updated_at: PgTimestamp | null;
	c_mailing_address: CustomerMailingAddress | string | null;
	c_mailing_address_source: "shopify" | "festival" | null;
	c_mailing_address_updated_at: PgTimestamp | null;
	c_phone: string | null;
	c_phone_source: "shopify" | "festival" | null;
	c_phone_updated_at: PgTimestamp | null;
	c_created_at: PgTimestamp | null;
	c_updated_at: PgTimestamp | null;
	i_organization_id: string | null;
	i_storefront_domain: string | null;
	i_client_id: string | null;
	i_encrypted_client_secret: string | null;
	i_readiness: "unknown" | "ready" | "failed" | null;
	i_can_read_orders: boolean | null;
	i_integration_version: number | string | null;
	i_verified_at: PgTimestamp | null;
	i_last_error: string | null;
	i_created_at: PgTimestamp | null;
	i_updated_at: PgTimestamp | null;
}

export interface ChildWithAgeSnapshotCteRow {
	child_id: string;
	child_organization_id: string;
	child_parent_customer_id: string;
	child_display_name: string;
	child_created_at: PgTimestamp;
	snapshot_id: string;
	snapshot_child_id: string;
	snapshot_organization_id: string;
	snapshot_age: number | string;
	snapshot_created_at: PgTimestamp;
	snapshot_valid_until: PgTimestamp;
	snapshot_superseded_at: PgTimestamp | null;
}

export function toIsoString(value: PgTimestamp): string {
	return value instanceof Date ? value.toISOString() : value;
}

export function toOptionalIsoString(
	value: PgTimestamp | null | undefined,
): string | undefined {
	return value === null || value === undefined ? undefined : toIsoString(value);
}

export function toNullableIsoString(
	value: PgTimestamp | null | undefined,
): string | null {
	return value === null || value === undefined ? null : toIsoString(value);
}

export function schemaName(value: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))
		throw new Error("Invalid DB_SCHEMA.");
	return value;
}

export function integration(
	row: IntegrationRow,
): CustomerAccountIntegrationRecord {
	return {
		organizationId: row.organization_id,
		storefrontDomain: row.storefront_domain,
		clientId: row.client_id,
		encryptedClientSecret: row.encrypted_client_secret,
		readiness: row.readiness,
		canReadOrders: row.can_read_orders,
		integrationVersion: Number(row.integration_version),
		verifiedAtIso: toOptionalIsoString(row.verified_at),
		lastError: row.last_error ?? undefined,
		createdAtIso: toIsoString(row.created_at),
		updatedAtIso: toIsoString(row.updated_at),
	};
}

export function session(row: SessionRow): CustomerSessionRecord {
	return {
		sessionId: row.session_id,
		customerId: row.customer_id,
		organizationId: row.organization_id,
		shopifyCustomerGid: row.shopify_customer_gid,
		encryptedTokens: row.encrypted_tokens,
		csrfToken: row.csrf_token,
		integrationVersion: Number(row.integration_version),
		createdAtIso: toIsoString(row.created_at),
		lastSeenAtIso: toIsoString(row.last_seen_at),
		expiresAtIso: toIsoString(row.expires_at),
		revokedAtIso: toOptionalIsoString(row.revoked_at),
	};
}

function mailingAddress(
	value: CustomerRow["mailing_address"],
): CustomerMailingAddress | null {
	if (!value) return null;
	return typeof value === "string"
		? (JSON.parse(value) as CustomerMailingAddress)
		: value;
}

function field<T>(
	value: T | null,
	source: "shopify" | "festival" | null,
	updatedAt: PgTimestamp | null,
) {
	return { value, source, updatedAtIso: toNullableIsoString(updatedAt) };
}

export function customer(row: CustomerRow): FestivalCustomerRecord {
	return {
		id: row.id,
		organizationId: row.organization_id,
		shopifyCustomerGid: row.shopify_customer_gid,
		name: field(row.name, row.name_source, row.name_updated_at),
		email: field(row.email, row.email_source, row.email_updated_at),
		mailingAddress: field(
			mailingAddress(row.mailing_address),
			row.mailing_address_source,
			row.mailing_address_updated_at,
		),
		phone: field(row.phone, row.phone_source, row.phone_updated_at),
		createdAtIso: toIsoString(row.created_at),
		updatedAtIso: toIsoString(row.updated_at),
	};
}

export function childRecord(row: ChildRow): FestivalChildRecord {
	return {
		id: row.id,
		organizationId: row.organization_id,
		parentCustomerId: row.parent_customer_id,
		displayName: row.display_name,
		createdAtIso: toIsoString(row.created_at),
	};
}

export function childAgeSnapshot(
	row: ChildAgeSnapshotRow,
): FestivalChildAgeSnapshot {
	const supersededAtIso = toOptionalIsoString(row.superseded_at);
	return {
		id: row.id,
		childId: row.child_id,
		organizationId: row.organization_id,
		age: Number(row.age),
		createdAtIso: toIsoString(row.created_at),
		validUntilIso: toIsoString(row.valid_until),
		...(supersededAtIso ? { supersededAtIso } : {}),
	};
}

export function consentRecord(
	row: ConsentRow,
): CustomerStaffAccessConsentRecord {
	return {
		customerId: row.customer_id,
		organizationId: row.organization_id,
		privacyNoticeVersion: row.privacy_notice_version,
		consentedAtIso: toIsoString(row.consented_at),
	};
}

export function stateRecord(row: StateRow): CustomerOAuthStateRecord {
	return {
		stateHash: row.state_hash,
		organizationId: row.organization_id,
		nonce: row.nonce,
		returnTo: row.return_to,
		offeringId: row.offering_id ?? undefined,
		expiresAtIso: toIsoString(row.expires_at),
	};
}
