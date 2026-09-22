import { randomUUID } from "node:crypto";
import type {
	AccompanistDivisionSelectionPolicy,
	AccompanistMembershipGrant,
	AuthenticatedUser,
	CreateEntitlementGrantSnapshotInput,
	EntitlementClass,
	EntitlementGrantSnapshot,
	EntitlementGrantStatus,
	FestivalClassConfiguration,
	FestivalRecord,
	OrganizationAdminUserEntry,
	OrganizationDivision,
	OrganizationInviteRecord,
	OrganizationMembershipRecord,
	OrganizationRecord,
	OrganizationRole,
	OrganizationUserRecord,
	RegistrationAgeConfiguration,
	RegistrationCatalogValue,
	ShopifyCapabilityDiagnostics,
	ShopifyFailureCategory,
	ShopifyVerificationStatus,
	ShopifyWebhookFailureCategory,
	ShopifyWebhookReadinessStatus,
} from "@festival/common";
import {
	assertValidEntitlementDurationDays,
	assertValidEntitlementGrantSnapshotInput,
	normalizeVerifiedShopifyIdentityEmail,
} from "@festival/common";
import { sql } from "bun";
import type {
	AccompanistDivisionPolicyHistoryRecord,
	AccompanistDivisionPolicyRecord,
	CreateAccompanistMembershipGrantInput,
	CreateFestivalClassConfigurationInput,
	CreateFestivalRecordInput,
	CreateInviteRecordInput,
	CreateMembershipInput,
	CreateMembershipProductRecordInput,
	InviteWithOrganization,
	MembershipWithOrganization,
	OrganizationRepository,
	ProductRecord,
	RegistrationCatalogKind,
	ShopifyIntegrationRecord,
	UpdateFestivalClassConfigurationInput,
	UpdateShopifyVerificationInput,
	UpdateShopifyWebhookReadinessInput,
	UpsertShopifyIntegrationInput,
} from "./organization-repository.js";
import {
	AccompanistMembershipConflictError,
	ShopifyShopOwnershipError,
} from "./organization-repository.js";
import {
	initializePostgresSchema,
	postgresSchemaName,
} from "./postgres-schema.js";

interface MembershipRow {
	id: string;
	organization_id: string;
	user_id: string;
	role: OrganizationRole;
	joined_at: string;
	origin: "creator" | "invite";
	welcome_dismissed_at: string | null;
	organization_name: string;
	organization_slug: string;
	organization_created_at: string;
	organization_timezone: string;
}

interface InviteRow {
	id: string;
	token: string;
	organization_id: string;
	email: string;
	role: OrganizationRole;
	invited_by_user_id: string;
	created_at: string;
	accepted_at: string | null;
	organization_name: string;
	organization_slug: string;
	organization_created_at: string;
	organization_timezone: string;
}

interface FestivalRow {
	id: string;
	organization_id: string;
	code: string;
	short_name: string;
	is_primary: boolean;
	name: string;
	start_date: string;
	end_date: string;
	created_at: string;
}

interface OrganizationRow {
	id: string;
	name: string;
	slug: string;
	timezone: string;
	created_at: string;
}

interface DivisionRow {
	id: string;
	organization_id: string;
	display_name: string;
	is_active: boolean;
	display_order: number;
	created_at: string;
	updated_at: string;
}

interface ShopifyIntegrationRow {
	organization_id: string;
	store_domain: string;
	client_id: string;
	encrypted_client_secret: string;
	encrypted_storefront_private_token: string | null;
	verification_status: ShopifyVerificationStatus;
	verified_shop_gid: string | null;
	verified_shop_domain: string | null;
	granted_scopes: string[];
	can_read_products: boolean;
	can_write_products: boolean;
	can_write_inventory: boolean;
	can_read_orders: boolean;
	integration_version: number | string;
	verified_at: string | null;
	last_tested_at: string | null;
	last_error: string | null;
	last_failure_category: ShopifyFailureCategory | null;
	webhook_readiness_status: ShopifyWebhookReadinessStatus;
	webhook_checked_at: string | null;
	webhook_error: string | null;
	webhook_failure_category: ShopifyWebhookFailureCategory | null;
	webhook_request_id: string | null;
	created_at: string;
	updated_at: string;
}

function capabilityDiagnostics(
	row: ShopifyIntegrationRow,
): ShopifyCapabilityDiagnostics {
	return {
		read_products: row.can_read_products ? "granted" : "missing",
		write_products: row.can_write_products ? "granted" : "missing",
		write_inventory: row.can_write_inventory ? "granted" : "missing",
		read_orders: row.can_read_orders ? "granted" : "missing",
		write_orders: "disabled",
	};
}

function throwTranslatedShopifyOwnershipError(error: unknown): never {
	if (
		error &&
		typeof error === "object" &&
		(("errno" in error && (error as { errno?: string }).errno === "23505") ||
			("code" in error && (error as { code?: string }).code === "23505"))
	) {
		throw new ShopifyShopOwnershipError();
	}
	throw error;
}

interface ProductRow {
	id: string;
	organization_id: string;
	product_category: "membership";
	entitlement_class: EntitlementClass;
	duration_days: number;
	is_active: boolean;
	shopify_product_gid: string;
	shopify_variant_gid: string;
	product_name_snapshot: string;
	created_at: string;
	updated_at: string;
}

interface EntitlementGrantRow {
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
	status: EntitlementGrantStatus;
	created_at: string;
}

interface AccompanistDivisionPolicyRow {
	organization_id: string;
	policy: AccompanistDivisionSelectionPolicy;
	updated_at: string;
}
interface AccompanistDivisionPolicyHistoryRow
	extends AccompanistDivisionPolicyRow {
	id: string;
	created_at: string;
}
interface AccompanistMembershipGrantRow {
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
	created_at: string;
}

interface RegistrationAgeConfigurationRow {
	organization_id: string;
	registration_age_date: string;
	updated_at: string;
}
interface RegistrationCatalogValueRow {
	id: string;
	organization_id: string;
	kind: RegistrationCatalogKind;
	display_name: string;
	is_active: boolean;
	display_order: number;
	created_at: string;
	updated_at: string;
}
interface FestivalClassConfigurationRow {
	id: string;
	organization_id: string;
	festival_id: string;
	display_name: string;
	class_subtype_id: string;
	division_id: string;
	minimum_age: number;
	maximum_age: number;
	price: string;
	maximum_performance_pieces: 1 | 2 | 3;
	performance_minutes: number;
	capacity: number;
	is_active: boolean;
	shopify_product_gid: string;
	shopify_variant_gid: string;
	created_at: string;
	updated_at: string;
}

function mapOrganization(row: {
	id: string;
	name: string;
	slug: string;
	created_at: string;
	timezone?: string;
}): OrganizationRecord {
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		timezone: row.timezone ?? "UTC",
		createdAtIso: row.created_at,
	};
}

function mapDivision(row: DivisionRow): OrganizationDivision {
	return {
		id: row.id,
		organizationId: row.organization_id,
		displayName: row.display_name,
		isActive: row.is_active,
		displayOrder: row.display_order,
		createdAtIso: row.created_at,
		updatedAtIso: row.updated_at,
	};
}

function mapFestivalClassConfiguration(
	row: FestivalClassConfigurationRow,
): FestivalClassConfiguration {
	return {
		id: row.id,
		organizationId: row.organization_id,
		festivalId: row.festival_id,
		displayName: row.display_name,
		classSubtypeId: row.class_subtype_id,
		divisionId: row.division_id,
		minimumAge: Number(row.minimum_age),
		maximumAge: Number(row.maximum_age),
		price: row.price,
		maximumPerformancePieces: row.maximum_performance_pieces,
		performanceMinutes: Number(row.performance_minutes),
		capacity: Number(row.capacity),
		isActive: row.is_active,
		shopifyProductGid: row.shopify_product_gid,
		shopifyVariantGid: row.shopify_variant_gid,
		createdAtIso: row.created_at,
		updatedAtIso: row.updated_at,
	};
}

function mapEntitlementGrant(
	row: EntitlementGrantRow,
): EntitlementGrantSnapshot {
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
		status: row.status,
		createdAtIso: row.created_at,
	};
	assertValidEntitlementGrantSnapshotInput(grant);
	return grant;
}

function mapAccompanistGrant(
	row: AccompanistMembershipGrantRow,
): AccompanistMembershipGrant {
	if (!Array.isArray(row.divisions))
		throw new Error("Accompanist division snapshot is invalid.");
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
		createdAtIso: row.created_at,
	};
}

function mapUser(row: {
	id: string;
	firebase_uid: string;
	email: string;
	display_name: string;
	disassociated: boolean;
	created_at: string;
}): OrganizationUserRecord {
	return {
		id: row.id,
		firebaseUid: row.firebase_uid,
		email: row.email,
		displayName: row.display_name,
		disassociated: row.disassociated,
		createdAtIso: row.created_at,
	};
}

function mapFestival(row: FestivalRow): FestivalRecord {
	return {
		id: row.id,
		organizationId: row.organization_id,
		code: row.code,
		shortName: row.short_name,
		isPrimary: row.is_primary,
		name: row.name,
		startDate: row.start_date,
		endDate: row.end_date,
		createdAtIso: row.created_at,
	};
}

function mapShopifyIntegration(
	row: ShopifyIntegrationRow,
): ShopifyIntegrationRecord {
	const capabilities = capabilityDiagnostics(row);
	const integrationVersion = Number(row.integration_version);
	if (!Number.isSafeInteger(integrationVersion) || integrationVersion <= 0) {
		throw new Error("Shopify integration version is invalid.");
	}
	const verificationMetadataComplete = Boolean(
		row.verified_shop_gid && row.verified_shop_domain && row.verified_at,
	);
	return {
		organizationId: row.organization_id,
		storeDomain: row.store_domain,
		clientId: row.client_id,
		encryptedClientSecret: row.encrypted_client_secret,
		encryptedStorefrontPrivateToken:
			row.encrypted_storefront_private_token ?? undefined,
		verificationStatus:
			row.verification_status === "ok" && !verificationMetadataComplete
				? "failed"
				: row.verification_status,
		verifiedShopGid: row.verified_shop_gid ?? undefined,
		verifiedShopDomain: row.verified_shop_domain ?? undefined,
		grantedScopes: [...(row.granted_scopes ?? [])],
		capabilities,
		integrationVersion,
		verifiedAtIso: row.verified_at ?? undefined,
		lastTestedAtIso: row.last_tested_at ?? undefined,
		lastError: row.last_error ?? undefined,
		lastFailureCategory: row.last_failure_category ?? undefined,
		webhookReadinessStatus: row.webhook_readiness_status,
		webhookCheckedAtIso: row.webhook_checked_at ?? undefined,
		webhookError: row.webhook_error ?? undefined,
		webhookFailureCategory: row.webhook_failure_category ?? undefined,
		webhookRequestId: row.webhook_request_id ?? undefined,
		createdAtIso: row.created_at,
		updatedAtIso: row.updated_at,
	};
}

function mapProduct(row: ProductRow): ProductRecord {
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
		createdAtIso: row.created_at,
		updatedAtIso: row.updated_at,
	};
}

function mapMembership(row: MembershipRow): MembershipWithOrganization {
	return {
		membership: {
			id: row.id,
			organizationId: row.organization_id,
			userId: row.user_id,
			role: row.role,
			joinedAtIso: row.joined_at,
			origin: row.origin,
			welcomeDismissedAtIso: row.welcome_dismissed_at ?? undefined,
		},
		organization: {
			id: row.organization_id,
			name: row.organization_name,
			slug: row.organization_slug,
			timezone: row.organization_timezone,
			createdAtIso: row.organization_created_at,
		},
	};
}

function mapInvite(row: InviteRow): InviteWithOrganization {
	return {
		invite: {
			id: row.id,
			token: row.token,
			organizationId: row.organization_id,
			email: row.email,
			role: row.role,
			invitedByUserId: row.invited_by_user_id,
			createdAtIso: row.created_at,
			acceptedAtIso: row.accepted_at ?? undefined,
		},
		organization: {
			id: row.organization_id,
			name: row.organization_name,
			slug: row.organization_slug,
			timezone: row.organization_timezone,
			createdAtIso: row.organization_created_at,
		},
	};
}

class AccompanistMembershipCohortContentionError extends Error {}

function isAccompanistMembershipConflict(error: unknown): boolean {
	return (
		error instanceof Error && /unique|duplicate|exclusion/i.test(error.message)
	);
}

export class PostgresOrganizationRepository implements OrganizationRepository {
	private readonly schema: string;
	constructor(schema: string) {
		this.schema = postgresSchemaName(schema);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async upsertUser(user: AuthenticatedUser): Promise<OrganizationUserRecord> {
		await this.ensureReady();

		const existingRows = (await sql.unsafe(
			`SELECT id, firebase_uid, email, display_name, disassociated, created_at
			 FROM ${this.schema}.users
			 WHERE firebase_uid = $1
			 LIMIT 1`,
			[user.uid],
		)) as Array<{
			id: string;
			firebase_uid: string;
			email: string;
			display_name: string;
			disassociated: boolean;
			created_at: string;
		}>;

		if (existingRows.length > 0) {
			const [updatedRow] = (await sql.unsafe(
				`UPDATE ${this.schema}.users
				 SET email = $2, display_name = $3, disassociated = FALSE
				 WHERE firebase_uid = $1
				 RETURNING id, firebase_uid, email, display_name, disassociated, created_at`,
				[user.uid, user.email.toLowerCase(), user.displayName],
			)) as Array<{
				id: string;
				firebase_uid: string;
				email: string;
				display_name: string;
				disassociated: boolean;
				created_at: string;
			}>;

			return mapUser(updatedRow);
		}

		const [insertedRow] = (await sql.unsafe(
			`INSERT INTO ${this.schema}.users (
				id, firebase_uid, email, display_name
			) VALUES ($1, $2, $3, $4)
			RETURNING id, firebase_uid, email, display_name, disassociated, created_at`,
			[randomUUID(), user.uid, user.email.toLowerCase(), user.displayName],
		)) as Array<{
			id: string;
			firebase_uid: string;
			email: string;
			display_name: string;
			disassociated: boolean;
			created_at: string;
		}>;

		return mapUser(insertedRow);
	}

	async findMembershipByUserId(
		userId: string,
	): Promise<MembershipWithOrganization | null> {
		const memberships = await this.listMembershipsByUserId(userId);
		return memberships[0] ?? null;
	}

	async listMembershipsByUserId(
		userId: string,
	): Promise<MembershipWithOrganization[]> {
		await this.ensureReady();

		const rows = (await sql.unsafe(
			`SELECT
				m.id,
				m.organization_id,
				m.user_id,
				m.role,
				m.joined_at,
				m.origin,
				m.welcome_dismissed_at,
				o.name AS organization_name,
				o.slug AS organization_slug,
				o.created_at AS organization_created_at,
				o.timezone AS organization_timezone
			 FROM ${this.schema}.memberships m
			 JOIN ${this.schema}.organizations o
			   ON o.id = m.organization_id
			 WHERE m.user_id = $1
			 ORDER BY m.joined_at ASC`,
			[userId],
		)) as MembershipRow[];

		return rows.map(mapMembership);
	}

	async findMembershipByUserAndSlug(
		userId: string,
		slug: string,
	): Promise<MembershipWithOrganization | null> {
		await this.ensureReady();

		const rows = (await sql.unsafe(
			`SELECT
				m.id,
				m.organization_id,
				m.user_id,
				m.role,
				m.joined_at,
				m.origin,
				m.welcome_dismissed_at,
				o.name AS organization_name,
				o.slug AS organization_slug,
				o.created_at AS organization_created_at,
				o.timezone AS organization_timezone
			 FROM ${this.schema}.memberships m
			 JOIN ${this.schema}.organizations o
			   ON o.id = m.organization_id
			 WHERE m.user_id = $1
			   AND o.slug = $2
			 LIMIT 1`,
			[userId, slug],
		)) as MembershipRow[];

		return rows[0] ? mapMembership(rows[0]) : null;
	}

	async findOrganizationBySlug(
		slug: string,
	): Promise<OrganizationRecord | null> {
		await this.ensureReady();

		const rows = (await sql.unsafe(
			`SELECT id, name, slug, timezone, created_at
			 FROM ${this.schema}.organizations
			 WHERE slug = $1
			 LIMIT 1`,
			[slug],
		)) as Array<{
			id: string;
			name: string;
			slug: string;
			timezone: string;
			created_at: string;
		}>;

		return rows[0] ? mapOrganization(rows[0]) : null;
	}

	async findOrganizationByName(
		name: string,
	): Promise<OrganizationRecord | null> {
		await this.ensureReady();

		const rows = (await sql.unsafe(
			`SELECT id, name, slug, timezone, created_at
			 FROM ${this.schema}.organizations
			 WHERE LOWER(name) = LOWER($1)
			 LIMIT 1`,
			[name],
		)) as Array<{
			id: string;
			name: string;
			slug: string;
			timezone: string;
			created_at: string;
		}>;

		return rows[0] ? mapOrganization(rows[0]) : null;
	}

	async createOrganization(input: {
		name: string;
		slug: string;
	}): Promise<OrganizationRecord> {
		await this.ensureReady();

		const [row] = (await sql.unsafe(
			`INSERT INTO ${this.schema}.organizations (id, name, slug)
			 VALUES ($1, $2, $3)
			 RETURNING id, name, slug, timezone, created_at`,
			[randomUUID(), input.name, input.slug],
		)) as Array<{
			id: string;
			name: string;
			slug: string;
			timezone: string;
			created_at: string;
		}>;

		return mapOrganization(row);
	}

	async listDivisions(
		organizationId: string,
		activeOnly = false,
	): Promise<OrganizationDivision[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, display_name, is_active, display_order, created_at, updated_at
			 FROM ${this.schema}.organization_divisions
			 WHERE organization_id = $1 AND ($2::boolean = FALSE OR is_active = TRUE)
			 ORDER BY display_order ASC, id ASC`,
			[organizationId, activeOnly],
		)) as DivisionRow[];
		return rows.map(mapDivision);
	}

	async createDivision(input: {
		organizationId: string;
		displayName: string;
		normalizedName: string;
	}): Promise<OrganizationDivision> {
		await this.ensureReady();
		try {
			return await sql.begin(async (transaction) => {
				await transaction.unsafe(
					"SELECT pg_advisory_xact_lock(hashtextextended($1, 24))",
					[input.organizationId],
				);
				const [row] = (await transaction.unsafe(
					`INSERT INTO ${this.schema}.organization_divisions (
						id, organization_id, display_name, normalized_name, display_order
					) VALUES (
						$1, $2, $3, $4,
						(SELECT COUNT(*)::integer FROM ${this.schema}.organization_divisions WHERE organization_id = $2)
					)
					RETURNING id, organization_id, display_name, is_active, display_order, created_at, updated_at`,
					[
						randomUUID(),
						input.organizationId,
						input.displayName,
						input.normalizedName,
					],
				)) as DivisionRow[];
				return mapDivision(row);
			});
		} catch (error) {
			if (
				error &&
				typeof error === "object" &&
				"code" in error &&
				(error as { code?: string }).code === "23505"
			) {
				throw new Error("Division display name already exists.");
			}
			throw error;
		}
	}

	async updateDivision(input: {
		organizationId: string;
		divisionId: string;
		displayName?: string;
		normalizedName?: string;
		isActive?: boolean;
	}): Promise<OrganizationDivision | null> {
		await this.ensureReady();
		try {
			const rows = (await sql.unsafe(
				`UPDATE ${this.schema}.organization_divisions
				 SET display_name = COALESCE($3, display_name),
				     normalized_name = COALESCE($4, normalized_name),
				     is_active = COALESCE($5, is_active),
				     updated_at = NOW()
				 WHERE id = $1 AND organization_id = $2
				 RETURNING id, organization_id, display_name, is_active, display_order, created_at, updated_at`,
				[
					input.divisionId,
					input.organizationId,
					input.displayName ?? null,
					input.normalizedName ?? null,
					input.isActive ?? null,
				],
			)) as DivisionRow[];
			return rows[0] ? mapDivision(rows[0]) : null;
		} catch (error) {
			if (
				error &&
				typeof error === "object" &&
				"code" in error &&
				(error as { code?: string }).code === "23505"
			) {
				throw new Error("Division display name already exists.");
			}
			throw error;
		}
	}

	async reorderDivisions(
		organizationId: string,
		divisionIds: string[],
	): Promise<OrganizationDivision[]> {
		await this.ensureReady();
		await sql.begin(async (transaction) => {
			await transaction.unsafe(
				"SELECT pg_advisory_xact_lock(hashtextextended($1, 24))",
				[organizationId],
			);
			const current = (await transaction.unsafe(
				`SELECT id FROM ${this.schema}.organization_divisions WHERE organization_id = $1`,
				[organizationId],
			)) as Array<{ id: string }>;
			if (
				current.length !== divisionIds.length ||
				new Set(divisionIds).size !== divisionIds.length ||
				divisionIds.some(
					(id) => !current.some((division) => division.id === id),
				)
			) {
				throw new Error(
					"Division order must contain every organization division exactly once.",
				);
			}
			// Offset first to avoid transient violations of the per-Organization order index.
			await transaction.unsafe(
				`UPDATE ${this.schema}.organization_divisions SET display_order = display_order + 1000000 WHERE organization_id = $1`,
				[organizationId],
			);
			for (const [displayOrder, divisionId] of divisionIds.entries()) {
				await transaction.unsafe(
					`UPDATE ${this.schema}.organization_divisions SET display_order = $3, updated_at = NOW() WHERE id = $1 AND organization_id = $2`,
					[divisionId, organizationId, displayOrder],
				);
			}
		});
		return this.listDivisions(organizationId);
	}

	async getOrganizationTimezone(organizationId: string): Promise<string> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT timezone FROM ${this.schema}.organizations WHERE id = $1 LIMIT 1`,
			[organizationId],
		)) as Array<{ timezone: string }>;
		if (!rows[0]) throw new Error("Organization not found.");
		return rows[0].timezone;
	}

	async updateOrganizationTimezone(
		organizationId: string,
		timezone: string,
	): Promise<string> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.organizations SET timezone = $2 WHERE id = $1 RETURNING timezone`,
			[organizationId, timezone],
		)) as Array<{ timezone: string }>;
		if (!rows[0]) throw new Error("Organization not found.");
		return rows[0].timezone;
	}

	async createMembership(
		input: CreateMembershipInput,
	): Promise<OrganizationMembershipRecord> {
		await this.ensureReady();

		const [row] = (await sql.unsafe(
			`INSERT INTO ${this.schema}.memberships (
				id,
				organization_id,
				user_id,
				role,
				origin
			) VALUES ($1, $2, $3, $4, $5)
			RETURNING
				id,
				organization_id,
				user_id,
				role,
				origin,
				joined_at,
				welcome_dismissed_at`,
			[
				randomUUID(),
				input.organizationId,
				input.userId,
				input.role,
				input.origin,
			],
		)) as Array<{
			id: string;
			organization_id: string;
			user_id: string;
			role: OrganizationRole;
			origin: "creator" | "invite";
			joined_at: string;
			welcome_dismissed_at: string | null;
		}>;

		return {
			id: row.id,
			organizationId: row.organization_id,
			userId: row.user_id,
			role: row.role,
			origin: row.origin,
			joinedAtIso: row.joined_at,
			welcomeDismissedAtIso: row.welcome_dismissed_at ?? undefined,
		};
	}

	async createInvite(
		input: CreateInviteRecordInput,
	): Promise<OrganizationInviteRecord> {
		await this.ensureReady();

		const [row] = (await sql.unsafe(
			`INSERT INTO ${this.schema}.invites (
				id,
				token,
				organization_id,
					email,
					role,
					invited_by_user_id
				) VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING
				id,
				token,
				organization_id,
				email,
				role,
				invited_by_user_id,
				created_at,
				accepted_at`,
			[
				randomUUID(),
				randomUUID(),
				input.organizationId,
				input.email.toLowerCase(),
				input.role,
				input.invitedByUserId,
			],
		)) as Array<{
			id: string;
			token: string;
			organization_id: string;
			email: string;
			role: OrganizationRole;
			invited_by_user_id: string;
			created_at: string;
			accepted_at: string | null;
		}>;

		return {
			id: row.id,
			token: row.token,
			organizationId: row.organization_id,
			email: row.email,
			role: row.role,
			invitedByUserId: row.invited_by_user_id,
			createdAtIso: row.created_at,
			acceptedAtIso: row.accepted_at ?? undefined,
		};
	}

	async findInviteByToken(
		token: string,
	): Promise<InviteWithOrganization | null> {
		await this.ensureReady();

		const rows = (await sql.unsafe(
			`SELECT
				i.id,
				i.token,
				i.organization_id,
				i.email,
				i.role,
				i.invited_by_user_id,
				i.created_at,
				i.accepted_at,
				o.name AS organization_name,
				o.slug AS organization_slug,
				o.created_at AS organization_created_at,
				o.timezone AS organization_timezone
			 FROM ${this.schema}.invites i
			 JOIN ${this.schema}.organizations o
			   ON o.id = i.organization_id
			 WHERE i.token = $1
			 LIMIT 1`,
			[token],
		)) as InviteRow[];

		return rows[0] ? mapInvite(rows[0]) : null;
	}

	async markInviteAccepted(token: string): Promise<void> {
		await this.ensureReady();

		await sql.unsafe(
			`UPDATE ${this.schema}.invites
			 SET accepted_at = NOW()
			 WHERE token = $1`,
			[token],
		);
	}

	async listAdminUsers(
		organizationId: string,
		currentUserId: string,
	): Promise<OrganizationAdminUserEntry[]> {
		await this.ensureReady();

		const acceptedRows = (await sql.unsafe(
			`SELECT
				m.id,
				u.email,
				m.role,
				(m.user_id = $2) AS is_self
			 FROM ${this.schema}.memberships m
			 JOIN ${this.schema}.users u
			   ON u.id = m.user_id
			 WHERE m.organization_id = $1
			 ORDER BY m.joined_at ASC`,
			[organizationId, currentUserId],
		)) as Array<{
			id: string;
			email: string;
			role: OrganizationRole;
			is_self: boolean;
		}>;
		const pendingRows = (await sql.unsafe(
			`SELECT id, email, role
			 FROM ${this.schema}.invites
			 WHERE organization_id = $1
			   AND accepted_at IS NULL
			 ORDER BY created_at ASC`,
			[organizationId],
		)) as Array<{
			id: string;
			email: string;
			role: OrganizationRole;
		}>;

		return [
			...acceptedRows.map((row) => ({
				id: row.id,
				email: row.email,
				role: row.role,
				status: "accepted" as const,
				isSelf: row.is_self,
			})),
			...pendingRows.map((row) => ({
				id: row.id,
				email: row.email,
				role: row.role,
				status: "pending" as const,
				isSelf: false,
			})),
		];
	}

	async deleteMembership(input: {
		organizationId: string;
		membershipId: string;
		currentUserId: string;
	}): Promise<void> {
		await this.ensureReady();

		const rows = (await sql.unsafe(
			`SELECT user_id
			 FROM ${this.schema}.memberships
			 WHERE id = $1
			   AND organization_id = $2
			 LIMIT 1`,
			[input.membershipId, input.organizationId],
		)) as Array<{ user_id: string }>;
		const row = rows[0];
		if (!row) {
			throw new Error("Membership not found.");
		}

		if (row.user_id === input.currentUserId) {
			throw new Error("Admins cannot delete their own membership.");
		}

		await sql.unsafe(
			`DELETE FROM ${this.schema}.memberships
			 WHERE id = $1
			   AND organization_id = $2`,
			[input.membershipId, input.organizationId],
		);
		await sql.unsafe(
			`UPDATE ${this.schema}.users
			 SET disassociated = TRUE
			 WHERE id = $1`,
			[row.user_id],
		);
	}

	async cancelInvite(input: {
		organizationId: string;
		inviteId: string;
	}): Promise<void> {
		await this.ensureReady();

		await sql.unsafe(
			`DELETE FROM ${this.schema}.invites
			 WHERE id = $1
			   AND organization_id = $2
			   AND accepted_at IS NULL`,
			[input.inviteId, input.organizationId],
		);
	}

	async listFestivals(organizationId: string): Promise<FestivalRecord[]> {
		await this.ensureReady();

		const rows = (await sql.unsafe(
			`SELECT
				id,
				organization_id,
				code,
				short_name,
				is_primary,
				name,
				start_date::text AS start_date,
				end_date::text AS end_date,
				created_at
			 FROM ${this.schema}.festivals
			 WHERE organization_id = $1
			 ORDER BY start_date ASC, name ASC`,
			[organizationId],
		)) as FestivalRow[];

		return rows.map(mapFestival);
	}

	async createFestival(
		input: CreateFestivalRecordInput,
	): Promise<FestivalRecord> {
		await this.ensureReady();

		const [row] = (await sql.unsafe(
			`INSERT INTO ${this.schema}.festivals (
				id,
				organization_id,
				code,
				short_name,
				is_primary,
					name,
					start_date,
					end_date
				) VALUES (
					$1,
					$2,
					$3,
					$4,
					NOT EXISTS (
						SELECT 1
						FROM ${this.schema}.festivals
						WHERE organization_id = $2
					),
					$5,
					$6,
					$7
				)
			RETURNING
				id,
				organization_id,
				code,
				short_name,
				is_primary,
				name,
				start_date::text AS start_date,
				end_date::text AS end_date,
				created_at`,
			[
				input.id,
				input.organizationId,
				input.code,
				input.shortName,
				input.name,
				input.startDate,
				input.endDate,
			],
		)) as FestivalRow[];

		return mapFestival(row);
	}

	async findFestivalByName(
		organizationId: string,
		name: string,
	): Promise<FestivalRecord | null> {
		await this.ensureReady();

		const rows = (await sql.unsafe(
			`SELECT
				id,
				organization_id,
				code,
				name,
				start_date::text AS start_date,
				end_date::text AS end_date,
				created_at
			 FROM ${this.schema}.festivals
			 WHERE organization_id = $1
			   AND LOWER(name) = LOWER($2)
			 LIMIT 1`,
			[organizationId, name],
		)) as FestivalRow[];

		return rows[0] ? mapFestival(rows[0]) : null;
	}

	async findFestivalByShortName(
		organizationId: string,
		shortName: string,
	): Promise<FestivalRecord | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, code, short_name, is_primary, name, start_date::text AS start_date, end_date::text AS end_date, created_at FROM ${this.schema}.festivals WHERE organization_id = $1 AND short_name = $2 LIMIT 1`,
			[organizationId, shortName],
		)) as FestivalRow[];
		return rows[0] ? mapFestival(rows[0]) : null;
	}

	async setPrimaryFestival(
		organizationId: string,
		festivalId: string,
	): Promise<FestivalRecord> {
		await this.ensureReady();
		await sql.begin(async (transaction) => {
			await transaction.unsafe(
				`UPDATE ${this.schema}.festivals SET is_primary = FALSE WHERE organization_id = $1`,
				[organizationId],
			);
			const rows = (await transaction.unsafe(
				`UPDATE ${this.schema}.festivals SET is_primary = TRUE WHERE organization_id = $1 AND id = $2 RETURNING id`,
				[organizationId, festivalId],
			)) as { id: string }[];
			if (!rows[0]) throw new Error("Festival not found.");
		});
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, code, short_name, is_primary, name, start_date::text AS start_date, end_date::text AS end_date, created_at FROM ${this.schema}.festivals WHERE organization_id = $1 AND id = $2`,
			[organizationId, festivalId],
		)) as FestivalRow[];
		if (!rows[0]) throw new Error("Festival not found.");
		return mapFestival(rows[0]);
	}

	async dismissWelcome(
		userId: string,
		organizationId: string,
	): Promise<OrganizationMembershipRecord> {
		await this.ensureReady();

		const [row] = (await sql.unsafe(
			`UPDATE ${this.schema}.memberships
			 SET welcome_dismissed_at = COALESCE(welcome_dismissed_at, NOW())
			 WHERE user_id = $1
			   AND organization_id = $2
			 RETURNING
			 	id,
			 	organization_id,
			 	user_id,
			 	role,
			 	origin,
			 	joined_at,
			 	welcome_dismissed_at`,
			[userId, organizationId],
		)) as Array<{
			id: string;
			organization_id: string;
			user_id: string;
			role: OrganizationRole;
			origin: "creator" | "invite";
			joined_at: string;
			welcome_dismissed_at: string | null;
		}>;

		return {
			id: row.id,
			organizationId: row.organization_id,
			userId: row.user_id,
			role: row.role,
			origin: row.origin,
			joinedAtIso: row.joined_at,
			welcomeDismissedAtIso: row.welcome_dismissed_at ?? undefined,
		};
	}

	async getShopifyIntegration(
		organizationId: string,
	): Promise<ShopifyIntegrationRecord | null> {
		await this.ensureReady();

		const rows = (await sql.unsafe(
			`SELECT
				organization_id,
				store_domain,
				client_id,
				encrypted_client_secret,
				encrypted_storefront_private_token,
				verification_status,
				verified_shop_gid,
				verified_shop_domain,
				granted_scopes,
				can_read_products,
				can_write_products,
				can_write_inventory,
				can_read_orders,
				integration_version,
				verified_at,
				last_tested_at,
				last_error,
				last_failure_category,
				webhook_readiness_status,
				webhook_checked_at,
				webhook_error,
				webhook_failure_category,
				webhook_request_id,
				created_at,
				updated_at
			 FROM ${this.schema}.shopify_integrations
			 WHERE organization_id = $1
			 LIMIT 1`,
			[organizationId],
		)) as ShopifyIntegrationRow[];

		return rows[0] ? mapShopifyIntegration(rows[0]) : null;
	}

	async findOrganizationByShopDomain(shopDomain: string) {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT o.id, o.name, o.slug, o.timezone, o.created_at
			 FROM ${this.schema}.organizations o
			 JOIN ${this.schema}.shopify_integrations i ON i.organization_id = o.id
			 WHERE i.verification_status = 'ok'
			   AND (i.store_domain = $1 OR i.verified_shop_domain = $1)
			 LIMIT 1`,
			[shopDomain.toLowerCase()],
		)) as OrganizationRow[];
		return rows[0] ? mapOrganization(rows[0]) : null;
	}

	async getPublicShopifyCatalogDomain(
		organizationId: string,
	): Promise<string | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT verified_shop_domain
			 FROM ${this.schema}.shopify_integrations
			 WHERE organization_id = $1
			   AND verification_status = 'ok'
			 LIMIT 1`,
			[organizationId],
		)) as Array<{ verified_shop_domain: string | null }>;
		return rows[0]?.verified_shop_domain ?? null;
	}

	async upsertShopifyIntegration(
		input: UpsertShopifyIntegrationInput,
	): Promise<ShopifyIntegrationRecord> {
		await this.ensureReady();

		let row: ShopifyIntegrationRow | undefined;
		try {
			[row] = (await sql.unsafe(
				`INSERT INTO ${this.schema}.shopify_integrations (
				organization_id,
				store_domain,
				client_id,
				encrypted_client_secret,
				encrypted_storefront_private_token,
				verification_status,
				verified_at,
				last_tested_at,
				last_error,
				last_failure_category,
				updated_at
			) VALUES ($1, $2, $3, $4, $5, 'unknown', NULL, NULL, NULL, NULL, NOW())
			ON CONFLICT (organization_id) DO UPDATE SET
				store_domain = EXCLUDED.store_domain,
				client_id = EXCLUDED.client_id,
				encrypted_client_secret = EXCLUDED.encrypted_client_secret,
				encrypted_storefront_private_token = EXCLUDED.encrypted_storefront_private_token,
				verification_status = 'unknown',
				verified_shop_gid = NULL,
				verified_shop_domain = NULL,
				granted_scopes = '{}',
				can_read_products = FALSE,
				can_write_products = FALSE,
				can_write_inventory = FALSE,
				can_read_orders = FALSE,
				integration_version = ${this.schema}.shopify_integrations.integration_version + 1,
				verified_at = NULL,
				last_tested_at = NULL,
				last_error = NULL,
				last_failure_category = NULL,
				webhook_readiness_status = 'unknown',
				webhook_checked_at = NULL,
				webhook_error = NULL,
				webhook_failure_category = NULL,
				webhook_request_id = NULL,
				updated_at = NOW()
			RETURNING
				organization_id,
				store_domain,
				client_id,
				encrypted_client_secret,
				encrypted_storefront_private_token,
				verification_status,
				verified_shop_gid,
				verified_shop_domain,
				granted_scopes,
				can_read_products,
				can_write_products,
				can_write_inventory,
				can_read_orders,
				integration_version,
				verified_at,
				last_tested_at,
				last_error,
				last_failure_category,
				webhook_readiness_status,
				webhook_checked_at,
				webhook_error,
				webhook_failure_category,
				webhook_request_id,
				created_at,
				updated_at`,
				[
					input.organizationId,
					input.storeDomain,
					input.clientId,
					input.encryptedClientSecret,
					input.encryptedStorefrontPrivateToken ?? null,
				],
			)) as ShopifyIntegrationRow[];
		} catch (error) {
			throwTranslatedShopifyOwnershipError(error);
		}
		if (!row) {
			throw new Error("Shopify integration upsert returned no record.");
		}

		return mapShopifyIntegration(row);
	}

	async updateShopifyVerification(
		input: UpdateShopifyVerificationInput,
	): Promise<ShopifyIntegrationRecord> {
		await this.ensureReady();
		const grantedScopes = input.grantedScopes ?? [];
		if (grantedScopes.some((scope) => !/^[a-z][a-z0-9_]*$/.test(scope))) {
			throw new Error("Shopify granted scope data is invalid.");
		}

		let row: ShopifyIntegrationRow | undefined;
		try {
			[row] = (await sql.unsafe(
				`UPDATE ${this.schema}.shopify_integrations
			 SET
				verification_status = $2,
				verified_shop_gid = $3,
				verified_shop_domain = $4,
				granted_scopes = COALESCE(
					string_to_array(NULLIF($5, ''), ','),
					ARRAY[]::TEXT[]
				),
				can_read_products = $6,
				can_write_products = $7,
				can_write_inventory = $8,
				can_read_orders = $9,
				verified_at = $10,
				last_tested_at = $11,
				last_error = $12,
				last_failure_category = $13,
				updated_at = NOW()
			 WHERE organization_id = $1
			RETURNING
				organization_id,
				store_domain,
				client_id,
				encrypted_client_secret,
				encrypted_storefront_private_token,
				verification_status,
				verified_shop_gid,
				verified_shop_domain,
				granted_scopes,
				can_read_products,
				can_write_products,
				can_write_inventory,
				can_read_orders,
				integration_version,
				verified_at,
				last_tested_at,
				last_error,
				last_failure_category,
				webhook_readiness_status,
				webhook_checked_at,
				webhook_error,
				webhook_failure_category,
				webhook_request_id,
				created_at,
				updated_at`,
				[
					input.organizationId,
					input.verificationStatus,
					input.verifiedShopGid ?? null,
					input.verifiedShopDomain ?? null,
					grantedScopes.join(","),
					input.capabilities?.read_products === "granted",
					input.capabilities?.write_products === "granted",
					input.capabilities?.write_inventory === "granted",
					input.capabilities?.read_orders === "granted",
					input.verifiedAtIso ?? null,
					input.lastTestedAtIso,
					input.lastError ?? null,
					input.lastFailureCategory ?? null,
				],
			)) as ShopifyIntegrationRow[];
		} catch (error) {
			throwTranslatedShopifyOwnershipError(error);
		}

		if (!row) {
			throw new Error("Shopify integration not found.");
		}

		return mapShopifyIntegration(row);
	}

	async updateShopifyWebhookReadiness(
		input: UpdateShopifyWebhookReadinessInput,
	): Promise<ShopifyIntegrationRecord> {
		await this.ensureReady();
		if (
			input.requestId !== undefined &&
			!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(input.requestId)
		) {
			throw new Error("Shopify webhook request ID is invalid.");
		}

		const [row] = (await sql.unsafe(
			`UPDATE ${this.schema}.shopify_integrations
			 SET
				webhook_readiness_status = $2,
				webhook_checked_at = $3,
				webhook_error = $4,
				webhook_failure_category = $5,
				webhook_request_id = $6,
				updated_at = NOW()
			 WHERE organization_id = $1
			 RETURNING
				organization_id,
				store_domain,
				client_id,
				encrypted_client_secret,
				encrypted_storefront_private_token,
				verification_status,
				verified_shop_gid,
				verified_shop_domain,
				granted_scopes,
				can_read_products,
				can_write_products,
				can_write_inventory,
				can_read_orders,
				integration_version,
				verified_at,
				last_tested_at,
				last_error,
				last_failure_category,
				webhook_readiness_status,
				webhook_checked_at,
				webhook_error,
				webhook_failure_category,
				webhook_request_id,
				created_at,
				updated_at`,
			[
				input.organizationId,
				input.status,
				input.checkedAtIso,
				input.status === "failed" ? input.message : null,
				input.status === "failed" ? input.failureCategory : null,
				input.status === "failed" ? (input.requestId ?? null) : null,
			],
		)) as ShopifyIntegrationRow[];
		if (!row) {
			throw new Error("Shopify integration not found.");
		}
		return mapShopifyIntegration(row);
	}

	async createMembershipProductRecord(
		input: CreateMembershipProductRecordInput,
	): Promise<ProductRecord> {
		await this.ensureReady();

		const [row] = (await sql.unsafe(
			`INSERT INTO ${this.schema}.products (
				id,
				organization_id,
				product_category,
				entitlement_class,
				duration_days,
				is_active,
				shopify_product_gid,
				shopify_variant_gid,
				product_name_snapshot,
				updated_at
			) VALUES ($1, $2, 'membership', $3, $4, $5, $6, $7, $8, NOW())
			RETURNING
				id,
				organization_id,
				product_category,
				entitlement_class,
				duration_days,
				is_active,
				shopify_product_gid,
				shopify_variant_gid,
				product_name_snapshot,
				created_at,
				updated_at`,
			[
				randomUUID(),
				input.organizationId,
				input.entitlementClass,
				input.durationDays,
				input.isActive,
				input.shopifyProductGid,
				input.shopifyVariantGid,
				input.productNameSnapshot,
			],
		)) as ProductRow[];

		return mapProduct(row);
	}

	async updateMembershipProductRecord(input: {
		organizationId: string;
		productId: string;
		productNameSnapshot?: string;
		durationDays?: number;
		isActive?: boolean;
	}): Promise<ProductRecord | null> {
		await this.ensureReady();
		if (input.durationDays !== undefined) {
			assertValidEntitlementDurationDays(input.durationDays);
		}
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.products
			 SET
				product_name_snapshot = COALESCE($3, product_name_snapshot),
				duration_days = COALESCE($4, duration_days),
				is_active = COALESCE($5, is_active),
				updated_at = NOW()
			 WHERE id = $1 AND organization_id = $2
			 RETURNING
				id,
				organization_id,
				product_category,
				entitlement_class,
				duration_days,
				is_active,
				shopify_product_gid,
				shopify_variant_gid,
				product_name_snapshot,
				created_at,
				updated_at`,
			[
				input.productId,
				input.organizationId,
				input.productNameSnapshot ?? null,
				input.durationDays ?? null,
				input.isActive ?? null,
			],
		)) as ProductRow[];
		return rows[0] ? mapProduct(rows[0]) : null;
	}

	async listMembershipProductRecords(
		organizationId: string,
	): Promise<ProductRecord[]> {
		await this.ensureReady();

		const rows = (await sql.unsafe(
			`SELECT
				id,
				organization_id,
				product_category,
				entitlement_class,
				duration_days,
				is_active,
				shopify_product_gid,
				shopify_variant_gid,
				product_name_snapshot,
				created_at,
				updated_at
			 FROM ${this.schema}.products
			 WHERE organization_id = $1
			   AND product_category = 'membership'
			 ORDER BY created_at ASC`,
			[organizationId],
		)) as ProductRow[];

		return rows.map(mapProduct);
	}

	async findMembershipProductRecordByClass(
		organizationId: string,
		entitlementClass: EntitlementClass,
	): Promise<ProductRecord | null> {
		await this.ensureReady();

		const rows = (await sql.unsafe(
			`SELECT
				id,
				organization_id,
				product_category,
				entitlement_class,
				duration_days,
				is_active,
				shopify_product_gid,
				shopify_variant_gid,
				product_name_snapshot,
				created_at,
				updated_at
			 FROM ${this.schema}.products
			 WHERE organization_id = $1
			   AND product_category = 'membership'
			   AND entitlement_class = $2
			   AND is_active
			 LIMIT 1`,
			[organizationId, entitlementClass],
		)) as ProductRow[];

		return rows[0] ? mapProduct(rows[0]) : null;
	}

	async getAccompanistDivisionPolicy(
		organizationId: string,
	): Promise<AccompanistDivisionPolicyRecord> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT organization_id, policy, updated_at
			 FROM ${this.schema}.membership_division_policies
			 WHERE organization_id = $1 AND entitlement_class = 'accompanist_membership'`,
			[organizationId],
		)) as AccompanistDivisionPolicyRow[];
		const row = rows[0];
		return row
			? {
					organizationId: row.organization_id,
					policy: row.policy,
					updatedAtIso: row.updated_at,
				}
			: {
					organizationId,
					policy: "exactly_one",
					updatedAtIso: new Date().toISOString(),
				};
	}

	async updateAccompanistDivisionPolicy(input: {
		organizationId: string;
		policy: AccompanistDivisionSelectionPolicy;
	}): Promise<AccompanistDivisionPolicyRecord> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.membership_division_policies
				(organization_id, entitlement_class, policy, updated_at)
			 VALUES ($1, 'accompanist_membership', $2, NOW())
			 ON CONFLICT (organization_id, entitlement_class) DO UPDATE
			 SET policy = EXCLUDED.policy, updated_at = NOW()
			 RETURNING organization_id, policy, updated_at`,
			[input.organizationId, input.policy],
		)) as AccompanistDivisionPolicyRow[];
		const row = rows[0];
		if (!row) throw new Error("Unable to save accompanist division policy.");
		const record = {
			organizationId: row.organization_id,
			policy: row.policy,
			updatedAtIso: row.updated_at,
		};
		await sql.unsafe(
			`INSERT INTO ${this.schema}.membership_division_policy_history (id, organization_id, entitlement_class, policy) VALUES ($1, $2, 'accompanist_membership', $3)`,
			[randomUUID(), record.organizationId, record.policy],
		);
		return record;
	}

	async listAccompanistDivisionPolicyHistory(
		organizationId: string,
	): Promise<AccompanistDivisionPolicyHistoryRecord[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, policy, created_at FROM ${this.schema}.membership_division_policy_history WHERE organization_id = $1 AND entitlement_class = 'accompanist_membership' ORDER BY created_at, id`,
			[organizationId],
		)) as AccompanistDivisionPolicyHistoryRow[];
		return rows.map((row) => ({
			id: row.id,
			organizationId: row.organization_id,
			policy: row.policy,
			updatedAtIso: row.created_at,
			createdAtIso: row.created_at,
		}));
	}

	async createAccompanistMembershipGrant(
		input: CreateAccompanistMembershipGrantInput,
	): Promise<AccompanistMembershipGrant> {
		await this.ensureReady();
		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				return await sql.begin(async (transaction) => {
					const entitlementId = randomUUID();
					const identityRows = (await transaction.unsafe(
						`INSERT INTO ${this.schema}.membership_identity_emails (organization_id, normalized_email, customer_id) VALUES ($1,$2,$3) ON CONFLICT (organization_id, normalized_email) DO UPDATE SET customer_id = ${this.schema}.membership_identity_emails.customer_id WHERE ${this.schema}.membership_identity_emails.customer_id = EXCLUDED.customer_id RETURNING customer_id`,
						[input.organizationId, input.normalizedEmail, input.customerId],
					)) as Array<Record<string, unknown>>;
					if (!identityRows[0])
						throw new Error(
							"Shopify identity email belongs to another customer.",
						);
					await transaction.unsafe(
						`INSERT INTO ${this.schema}.membership_entitlement_cohorts (organization_id, customer_id, entitlement_class) VALUES ($1,$2,'accompanist_membership') ON CONFLICT DO NOTHING`,
						[input.organizationId, input.customerId],
					);
					const cohort = (await transaction.unsafe(
						`SELECT version FROM ${this.schema}.membership_entitlement_cohorts WHERE organization_id=$1 AND customer_id=$2 AND entitlement_class='accompanist_membership' FOR UPDATE`,
						[input.organizationId, input.customerId],
					)) as Array<{ version: number }>;
					const advanced =
						cohort[0] &&
						(await transaction.unsafe(
							`UPDATE ${this.schema}.membership_entitlement_cohorts SET version=version+1 WHERE organization_id=$1 AND customer_id=$2 AND entitlement_class='accompanist_membership' AND version=$3 RETURNING version`,
							[input.organizationId, input.customerId, cohort[0].version],
						));
					if (!advanced || advanced.count !== 1)
						throw new AccompanistMembershipCohortContentionError();
					const inserted = await transaction.unsafe(
						`INSERT INTO ${this.schema}.membership_entitlements (id,organization_id,customer_id,entitlement_class,source,offering_id,starts_on,ends_on) VALUES ($1,$2,$3,'accompanist_membership','accompanist_form',NULL,$4::date,$5::date) RETURNING id`,
						[
							entitlementId,
							input.organizationId,
							input.customerId,
							input.startsOn,
							input.endsOn,
						],
					);
					if (!inserted[0])
						throw new Error("Unable to create accompanist membership.");
					await transaction.unsafe(
						`INSERT INTO ${this.schema}.accompanist_membership_entitlement_details (entitlement_id,contact_name,contact_email,contact_city,contact_phone) VALUES ($1,$2,$3,$4,$5)`,
						[
							entitlementId,
							input.contact.name,
							input.contact.email,
							input.contact.city,
							input.contact.phone,
						],
					);
					for (const division of input.divisions)
						await transaction.unsafe(
							`INSERT INTO ${this.schema}.membership_entitlement_divisions (entitlement_id,organization_id,division_id,division_name_snapshot) VALUES ($1,$2,$3,$4)`,
							[
								entitlementId,
								input.organizationId,
								division.divisionId,
								division.divisionName,
							],
						);
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
				});
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

	async listAccompanistMembershipGrants(input: {
		organizationId: string;
		customerId?: string;
		normalizedEmail?: string;
		currentOnly?: boolean;
	}): Promise<AccompanistMembershipGrant[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT e.id,e.organization_id,e.customer_id,identity.normalized_email,e.offering_id,COALESCE(p.product_name_snapshot,'Accompanist Membership') AS offering_name_snapshot,e.source,d.contact_name,d.contact_email,d.contact_city,d.contact_phone,COALESCE(jsonb_agg(jsonb_build_object('divisionId',ed.division_id,'divisionName',ed.division_name_snapshot)) FILTER (WHERE ed.division_id IS NOT NULL),'[]') AS divisions,e.starts_on::text,e.ends_on::text,CASE WHEN e.revoked_at IS NOT NULL THEN 'revoked' WHEN e.starts_on > (NOW() AT TIME ZONE o.timezone)::date THEN 'scheduled' WHEN e.ends_on <= (NOW() AT TIME ZONE o.timezone)::date THEN 'expired' ELSE 'active' END AS status,(e.revoked_at IS NULL AND e.starts_on <= (NOW() AT TIME ZONE o.timezone)::date AND e.ends_on > (NOW() AT TIME ZONE o.timezone)::date) AS is_current,e.created_at FROM ${this.schema}.membership_entitlements e JOIN ${this.schema}.organizations o ON o.id=e.organization_id LEFT JOIN ${this.schema}.products p ON p.id=e.offering_id JOIN ${this.schema}.accompanist_membership_entitlement_details d ON d.entitlement_id=e.id LEFT JOIN ${this.schema}.membership_identity_emails identity ON identity.organization_id=e.organization_id AND identity.customer_id=e.customer_id LEFT JOIN ${this.schema}.membership_entitlement_divisions ed ON ed.entitlement_id=e.id WHERE e.organization_id=$1 AND e.entitlement_class='accompanist_membership' AND ($2::text IS NULL OR e.customer_id=$2) AND ($3::text IS NULL OR identity.normalized_email=$3) AND ($4::boolean = FALSE OR (e.revoked_at IS NULL AND e.starts_on <= (NOW() AT TIME ZONE o.timezone)::date AND e.ends_on > (NOW() AT TIME ZONE o.timezone)::date)) GROUP BY e.id,identity.normalized_email,p.product_name_snapshot,d.contact_name,d.contact_email,d.contact_city,d.contact_phone,o.timezone ORDER BY e.created_at,e.id`,
			[
				input.organizationId,
				input.customerId ?? null,
				input.normalizedEmail ?? null,
				input.currentOnly ?? false,
			],
		)) as AccompanistMembershipGrantRow[];
		return rows.map(mapAccompanistGrant);
	}

	async getRegistrationAgeConfiguration(
		organizationId: string,
	): Promise<RegistrationAgeConfiguration | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT organization_id, registration_age_date::text, updated_at FROM ${this.schema}.registration_age_configurations WHERE organization_id = $1`,
			[organizationId],
		)) as RegistrationAgeConfigurationRow[];
		const row = rows[0];
		return row
			? {
					organizationId: row.organization_id,
					registrationAgeDate: row.registration_age_date,
					updatedAtIso: row.updated_at,
				}
			: null;
	}

	async updateRegistrationAgeConfiguration(input: {
		organizationId: string;
		registrationAgeDate: string;
	}): Promise<RegistrationAgeConfiguration> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.registration_age_configurations (organization_id, registration_age_date, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (organization_id) DO UPDATE SET registration_age_date = EXCLUDED.registration_age_date, updated_at = NOW() RETURNING organization_id, registration_age_date::text, updated_at`,
			[input.organizationId, input.registrationAgeDate],
		)) as RegistrationAgeConfigurationRow[];
		const row = rows[0];
		if (!row) throw new Error("Unable to save registration age configuration.");
		return {
			organizationId: row.organization_id,
			registrationAgeDate: row.registration_age_date,
			updatedAtIso: row.updated_at,
		};
	}

	async listRegistrationCatalogValues(
		organizationId: string,
		kind: RegistrationCatalogKind,
		activeOnly = false,
	): Promise<RegistrationCatalogValue[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, kind, display_name, is_active, display_order, created_at, updated_at FROM ${this.schema}.registration_catalog_values WHERE organization_id = $1 AND kind = $2 AND ($3::boolean = FALSE OR is_active) ORDER BY display_order, id`,
			[organizationId, kind, activeOnly],
		)) as RegistrationCatalogValueRow[];
		return rows.map((row) => ({
			id: row.id,
			organizationId: row.organization_id,
			displayName: row.display_name,
			isActive: row.is_active,
			displayOrder: row.display_order,
			createdAtIso: row.created_at,
			updatedAtIso: row.updated_at,
		}));
	}

	async createRegistrationCatalogValue(input: {
		organizationId: string;
		kind: RegistrationCatalogKind;
		displayName: string;
		normalizedName: string;
	}): Promise<RegistrationCatalogValue> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.registration_catalog_values (id, organization_id, kind, display_name, normalized_name, display_order) SELECT $1, $2, $3, $4, $5, COUNT(*)::integer FROM ${this.schema}.registration_catalog_values WHERE organization_id = $2 AND kind = $3 RETURNING id, organization_id, kind, display_name, is_active, display_order, created_at, updated_at`,
			[
				randomUUID(),
				input.organizationId,
				input.kind,
				input.displayName,
				input.normalizedName,
			],
		)) as RegistrationCatalogValueRow[];
		const row = rows[0];
		if (!row) throw new Error("Unable to create registration catalog value.");
		return {
			id: row.id,
			organizationId: row.organization_id,
			displayName: row.display_name,
			isActive: row.is_active,
			displayOrder: row.display_order,
			createdAtIso: row.created_at,
			updatedAtIso: row.updated_at,
		};
	}

	async updateRegistrationCatalogValue(input: {
		organizationId: string;
		kind: RegistrationCatalogKind;
		id: string;
		displayName?: string;
		normalizedName?: string;
		isActive?: boolean;
	}): Promise<RegistrationCatalogValue | null> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.registration_catalog_values SET display_name = COALESCE($4, display_name), normalized_name = COALESCE($5, normalized_name), is_active = COALESCE($6, is_active), updated_at = NOW() WHERE organization_id = $1 AND kind = $2 AND id = $3 RETURNING id, organization_id, kind, display_name, is_active, display_order, created_at, updated_at`,
			[
				input.organizationId,
				input.kind,
				input.id,
				input.displayName ?? null,
				input.normalizedName ?? null,
				input.isActive ?? null,
			],
		)) as RegistrationCatalogValueRow[];
		const row = rows[0];
		return row
			? {
					id: row.id,
					organizationId: row.organization_id,
					displayName: row.display_name,
					isActive: row.is_active,
					displayOrder: row.display_order,
					createdAtIso: row.created_at,
					updatedAtIso: row.updated_at,
				}
			: null;
	}

	async reorderRegistrationCatalogValues(
		organizationId: string,
		kind: RegistrationCatalogKind,
		ids: string[],
	): Promise<RegistrationCatalogValue[]> {
		await this.ensureReady();
		const current = await this.listRegistrationCatalogValues(
			organizationId,
			kind,
		);
		if (
			current.length !== ids.length ||
			new Set(ids).size !== ids.length ||
			ids.some((id) => !current.some((value) => value.id === id))
		)
			throw new Error(
				"Registration catalog order must contain every value exactly once.",
			);
		await Promise.all(
			ids.map((id, index) =>
				sql.unsafe(
					`UPDATE ${this.schema}.registration_catalog_values SET display_order = $4, updated_at = NOW() WHERE organization_id = $1 AND kind = $2 AND id = $3`,
					[organizationId, kind, id, index],
				),
			),
		);
		return this.listRegistrationCatalogValues(organizationId, kind);
	}

	async createFestivalClassConfiguration(
		input: CreateFestivalClassConfigurationInput,
	): Promise<FestivalClassConfiguration> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`INSERT INTO ${this.schema}.festival_class_configurations (id, organization_id, festival_id, display_name, class_subtype_id, division_id, minimum_age, maximum_age, price, maximum_performance_pieces, performance_minutes, capacity, is_active, shopify_product_gid, shopify_variant_gid) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, organization_id, festival_id, display_name, class_subtype_id, division_id, minimum_age, maximum_age, price, maximum_performance_pieces, performance_minutes, capacity, is_active, shopify_product_gid, shopify_variant_gid, created_at, updated_at`,
			[
				randomUUID(),
				input.organizationId,
				input.festivalId,
				input.displayName,
				input.classSubtypeId,
				input.divisionId,
				input.minimumAge,
				input.maximumAge,
				input.price,
				input.maximumPerformancePieces,
				input.performanceMinutes,
				input.capacity,
				input.isActive ?? true,
				input.shopifyProductGid,
				input.shopifyVariantGid,
			],
		)) as FestivalClassConfigurationRow[];
		const row = rows[0];
		if (!row) throw new Error("Unable to create Festival class.");
		return mapFestivalClassConfiguration(row);
	}

	async updateFestivalClassConfiguration(
		input: UpdateFestivalClassConfigurationInput,
	): Promise<FestivalClassConfiguration> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`UPDATE ${this.schema}.festival_class_configurations
			 SET
				display_name = COALESCE($4, display_name),
				class_subtype_id = COALESCE($5, class_subtype_id),
				division_id = COALESCE($6, division_id),
				minimum_age = COALESCE($7, minimum_age),
				maximum_age = COALESCE($8, maximum_age),
				price = COALESCE($9, price),
				maximum_performance_pieces = COALESCE($10, maximum_performance_pieces),
				performance_minutes = COALESCE($11, performance_minutes),
				capacity = COALESCE($12, capacity),
				is_active = COALESCE($13, is_active),
				shopify_product_gid = COALESCE($14, shopify_product_gid),
				shopify_variant_gid = COALESCE($15, shopify_variant_gid),
				updated_at = NOW()
			 WHERE organization_id = $1 AND festival_id = $2 AND id = $3
			 RETURNING id, organization_id, festival_id, display_name, class_subtype_id, division_id, minimum_age, maximum_age, price, maximum_performance_pieces, performance_minutes, capacity, is_active, shopify_product_gid, shopify_variant_gid, created_at, updated_at`,
			[
				input.organizationId,
				input.festivalId,
				input.id,
				input.displayName ?? null,
				input.classSubtypeId ?? null,
				input.divisionId ?? null,
				input.minimumAge ?? null,
				input.maximumAge ?? null,
				input.price ?? null,
				input.maximumPerformancePieces ?? null,
				input.performanceMinutes ?? null,
				input.capacity ?? null,
				input.isActive ?? null,
				input.shopifyProductGid ?? null,
				input.shopifyVariantGid ?? null,
			],
		)) as FestivalClassConfigurationRow[];
		const row = rows[0];
		if (!row) throw new Error("Festival class configuration not found.");
		return mapFestivalClassConfiguration(row);
	}

	async listFestivalClassConfigurations(
		organizationId: string,
		festivalId: string,
		activeOnly = false,
	): Promise<FestivalClassConfiguration[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, festival_id, display_name, class_subtype_id, division_id, minimum_age, maximum_age, price, maximum_performance_pieces, performance_minutes, capacity, is_active, shopify_product_gid, shopify_variant_gid, created_at, updated_at FROM ${this.schema}.festival_class_configurations WHERE organization_id = $1 AND festival_id = $2 AND ($3::boolean = FALSE OR is_active) ORDER BY created_at, id`,
			[organizationId, festivalId, activeOnly],
		)) as FestivalClassConfigurationRow[];
		return rows.map(mapFestivalClassConfiguration);
	}

	async findProductRecordByShopifyProductGid(
		shopifyProductGid: string,
	): Promise<ProductRecord | null> {
		await this.ensureReady();

		const rows = (await sql.unsafe(
			`SELECT
				id,
				organization_id,
				product_category,
				entitlement_class,
				duration_days,
				is_active,
				shopify_product_gid,
				shopify_variant_gid,
				product_name_snapshot,
				created_at,
				updated_at
			 FROM ${this.schema}.products
			 WHERE shopify_product_gid = $1
			 LIMIT 1`,
			[shopifyProductGid],
		)) as ProductRow[];

		return rows[0] ? mapProduct(rows[0]) : null;
	}

	async findProductRecordByShopifyVariantGid(
		shopifyVariantGid: string,
	): Promise<ProductRecord | null> {
		await this.ensureReady();

		const rows = (await sql.unsafe(
			`SELECT
				id,
				organization_id,
				product_category,
				entitlement_class,
				duration_days,
				is_active,
				shopify_product_gid,
				shopify_variant_gid,
				product_name_snapshot,
				created_at,
				updated_at
			 FROM ${this.schema}.products
			 WHERE shopify_variant_gid = $1
			 LIMIT 1`,
			[shopifyVariantGid],
		)) as ProductRow[];

		return rows[0] ? mapProduct(rows[0]) : null;
	}

	async createEntitlementGrantSnapshot(
		input: CreateEntitlementGrantSnapshotInput,
	): Promise<EntitlementGrantSnapshot> {
		await this.ensureReady();
		assertValidEntitlementGrantSnapshotInput(input);
		const verifiedIdentityEmail = normalizeVerifiedShopifyIdentityEmail(
			input.verifiedIdentityEmail,
		);
		if (input.entitlementClass !== "teacher_membership") {
			throw new Error(
				"Teacher checkout source requires a teacher entitlement.",
			);
		}

		const id = randomUUID();
		await sql.begin(async (transaction) => {
			const identityRows = (await transaction.unsafe(
				`INSERT INTO ${this.schema}.membership_identity_emails (organization_id, normalized_email, customer_id) VALUES ($1,$2,$3) ON CONFLICT (organization_id, normalized_email) DO UPDATE SET customer_id = EXCLUDED.customer_id WHERE ${this.schema}.membership_identity_emails.customer_id = EXCLUDED.customer_id RETURNING customer_id`,
				[input.organizationId, verifiedIdentityEmail, input.customerId],
			)) as Array<Record<string, unknown>>;
			if (!identityRows[0]) {
				throw new Error("Shopify identity email belongs to another customer.");
			}
			const inserted = await transaction.unsafe(
				`INSERT INTO ${this.schema}.membership_entitlements (id,organization_id,customer_id,entitlement_class,source,offering_id,starts_on,ends_on) SELECT $1,$2,$3,$4,'teacher_checkout',$5,$6::date,$7::date FROM ${this.schema}.products WHERE id=$5 AND organization_id=$2 AND entitlement_class=$4 RETURNING id`,
				[
					id,
					input.organizationId,
					input.customerId,
					input.entitlementClass,
					input.offeringId,
					input.startsOn,
					input.endsOn,
				],
			);
			if (!inserted[0])
				throw new Error(
					"Entitlement offering was not found for this Organization.",
				);
			await transaction.unsafe(
				`INSERT INTO ${this.schema}.membership_entitlement_divisions (entitlement_id,organization_id,division_id,division_name_snapshot) VALUES ($1,$2,$3,$4)`,
				[
					id,
					input.organizationId,
					input.divisionId,
					input.divisionNameSnapshot,
				],
			);
			await transaction.unsafe(
				`INSERT INTO ${this.schema}.teacher_membership_entitlement_details (entitlement_id,checkout_intent_id,shopify_order_gid,shopify_order_line_gid,paid_amount,paid_currency_code,duration_days) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
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
		});
		return { ...input, id, createdAtIso: new Date().toISOString() };
	}

	async listEntitlementGrantSnapshots(
		organizationId: string,
		customerId: string,
	): Promise<EntitlementGrantSnapshot[]> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT e.id,e.organization_id,e.customer_id,e.entitlement_class,e.offering_id,d.duration_days,ed.division_id,ed.division_name_snapshot,d.paid_amount,d.paid_currency_code,d.checkout_intent_id,d.shopify_order_gid,d.shopify_order_line_gid,e.starts_on::text,e.ends_on::text,CASE WHEN e.revoked_at IS NOT NULL THEN 'revoked' WHEN e.starts_on > (NOW() AT TIME ZONE o.timezone)::date THEN 'scheduled' WHEN e.ends_on <= (NOW() AT TIME ZONE o.timezone)::date THEN 'expired' ELSE 'active' END AS status,e.created_at FROM ${this.schema}.membership_entitlements e JOIN ${this.schema}.organizations o ON o.id=e.organization_id JOIN ${this.schema}.teacher_membership_entitlement_details d ON d.entitlement_id=e.id JOIN ${this.schema}.membership_entitlement_divisions ed ON ed.entitlement_id=e.id WHERE e.organization_id=$1 AND e.customer_id=$2
			 ORDER BY created_at ASC`,
			[organizationId, customerId],
		)) as EntitlementGrantRow[];
		return rows.map(mapEntitlementGrant);
	}

	async revokeEntitlement(input: {
		organizationId: string;
		entitlementId: string;
		actorUserId: string;
		reason: string;
		revokedAtIso: string;
	}) {
		await this.ensureReady();
		return sql.begin(async (transaction) => {
			const initial = (await transaction.unsafe(
				`SELECT customer_id FROM ${this.schema}.membership_entitlements WHERE id=$1 AND organization_id=$2`,
				[input.entitlementId, input.organizationId],
			)) as Array<{ customer_id: string }>;
			if (!initial[0]) throw new Error("Entitlement was not found.");
			await transaction.unsafe(
				"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
				[`${input.organizationId}:${initial[0].customer_id}`],
			);
			const entitlement = (await transaction.unsafe(
				`SELECT customer_id, entitlement_class, revoked_at::text, revoked_reason FROM ${this.schema}.membership_entitlements WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
				[input.entitlementId, input.organizationId],
			)) as Array<{
				customer_id: string;
				entitlement_class: string;
				revoked_at: string | null;
				revoked_reason: string | null;
			}>;
			if (!entitlement[0]) throw new Error("Entitlement was not found.");
			const existing = (await transaction.unsafe(
				`SELECT id, entitlement_id, organization_id, actor_user_id, reason, revoked_at::text FROM ${this.schema}.membership_entitlement_revocations WHERE entitlement_id=$1`,
				[input.entitlementId],
			)) as Array<{
				id: string;
				entitlement_id: string;
				organization_id: string;
				actor_user_id: string;
				reason: string;
				revoked_at: string;
			}>;
			if (existing[0])
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
			await transaction.unsafe(
				`UPDATE ${this.schema}.membership_entitlements SET revoked_at=$3::timestamptz, revoked_reason=$4 WHERE id=$1 AND organization_id=$2`,
				[
					input.entitlementId,
					input.organizationId,
					input.revokedAtIso,
					input.reason,
				],
			);
			const id = randomUUID();
			await transaction.unsafe(
				`INSERT INTO ${this.schema}.membership_entitlement_revocations (id,entitlement_id,organization_id,actor_user_id,reason,revoked_at) VALUES ($1,$2,$3,$4,$5,$6::timestamptz)`,
				[
					id,
					input.entitlementId,
					input.organizationId,
					input.actorUserId,
					input.reason,
					input.revokedAtIso,
				],
			);
			await transaction.unsafe(
				`INSERT INTO ${this.schema}.membership_entitlement_cohorts (organization_id,customer_id,entitlement_class) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
				[
					input.organizationId,
					entitlement[0].customer_id,
					entitlement[0].entitlement_class,
				],
			);
			await transaction.unsafe(
				`UPDATE ${this.schema}.membership_entitlement_cohorts SET version=version+1 WHERE organization_id=$1 AND customer_id=$2 AND entitlement_class=$3`,
				[
					input.organizationId,
					entitlement[0].customer_id,
					entitlement[0].entitlement_class,
				],
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
		});
	}

	async listActiveTeachersForDivision(
		organizationId: string,
		divisionId: string,
	): Promise<Array<{ id: string; name: string }>> {
		await this.ensureReady();
		const rows = (await sql.unsafe(
			`SELECT DISTINCT
				c.id,
				COALESCE(c.name, '') AS name
			 FROM ${this.schema}.membership_entitlements e
			 JOIN ${this.schema}.organizations o ON o.id = e.organization_id
			 JOIN ${this.schema}.membership_entitlement_divisions ed ON ed.entitlement_id = e.id
			 JOIN ${this.schema}.festival_customers c ON c.id = e.customer_id AND c.organization_id = e.organization_id
			 WHERE e.organization_id = $1
			   AND e.entitlement_class = 'teacher_membership'
			   AND ed.division_id = $2
			   AND e.revoked_at IS NULL
			   AND e.starts_on <= (NOW() AT TIME ZONE o.timezone)::date
			   AND e.ends_on > (NOW() AT TIME ZONE o.timezone)::date
			 ORDER BY name, c.id`,
			[organizationId, divisionId],
		)) as Array<{ id: string; name: string }>;
		return rows.map((row) => ({ id: row.id, name: row.name }));
	}
}
