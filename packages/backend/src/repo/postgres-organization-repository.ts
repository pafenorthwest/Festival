import { randomUUID } from "node:crypto";
import type {
	AuthenticatedUser,
	FestivalRecord,
	MembershipEntitlementPeriod,
	MembershipProductType,
	OrganizationAdminUserEntry,
	OrganizationInviteRecord,
	OrganizationMembershipRecord,
	OrganizationRecord,
	OrganizationRole,
	OrganizationUserRecord,
	ShopifyCapabilityDiagnostics,
	ShopifyFailureCategory,
	ShopifyVerificationStatus,
} from "@festival/common";
import { sql } from "bun";
import type {
	CreateFestivalRecordInput,
	CreateInviteRecordInput,
	CreateMembershipInput,
	CreateMembershipProductRecordInput,
	InviteWithOrganization,
	MembershipWithOrganization,
	OrganizationRepository,
	ProductRecord,
	ShopifyIntegrationRecord,
	UpdateShopifyVerificationInput,
	UpsertShopifyIntegrationInput,
} from "./organization-repository.js";
import { ShopifyShopOwnershipError } from "./organization-repository.js";

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
}

interface FestivalRow {
	id: string;
	organization_id: string;
	code: string;
	name: string;
	start_date: string;
	end_date: string;
	created_at: string;
}

interface ShopifyIntegrationRow {
	organization_id: string;
	store_domain: string;
	client_id: string;
	encrypted_client_secret: string;
	verification_status: ShopifyVerificationStatus;
	verified_shop_gid: string | null;
	verified_shop_domain: string | null;
	granted_scopes: string[];
	can_read_products: boolean;
	can_write_products: boolean;
	can_read_orders: boolean;
	integration_version: number | string;
	verified_at: string | null;
	last_tested_at: string | null;
	last_error: string | null;
	last_failure_category: ShopifyFailureCategory | null;
	created_at: string;
	updated_at: string;
}

function capabilityDiagnostics(
	row: ShopifyIntegrationRow,
): ShopifyCapabilityDiagnostics {
	return {
		read_products: row.can_read_products ? "granted" : "missing",
		write_products: row.can_write_products ? "granted" : "missing",
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
	membership_type: MembershipProductType;
	entitlement_period: MembershipEntitlementPeriod;
	shopify_product_gid: string;
	shopify_variant_gid: string;
	product_name_snapshot: string;
	created_at: string;
	updated_at: string;
}

function sanitizeSchemaName(schema: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
		throw new Error(
			`Invalid DB_SCHEMA "${schema}". Only letters, digits, and underscores are allowed, and the name must not start with a digit.`,
		);
	}

	return schema;
}

function mapOrganization(row: {
	id: string;
	name: string;
	slug: string;
	created_at: string;
}): OrganizationRecord {
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
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
		createdAtIso: row.created_at,
		updatedAtIso: row.updated_at,
	};
}

function mapProduct(row: ProductRow): ProductRecord {
	return {
		id: row.id,
		organizationId: row.organization_id,
		productCategory: row.product_category,
		membershipType: row.membership_type,
		entitlementPeriod: row.entitlement_period,
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
			createdAtIso: row.organization_created_at,
		},
	};
}

export class PostgresOrganizationRepository implements OrganizationRepository {
	private readonly schema: string;
	private readyPromise?: Promise<void>;

	constructor(schema: string) {
		this.schema = sanitizeSchemaName(schema);
	}

	async ensureReady(): Promise<void> {
		this.readyPromise ??= this.runMigrations();
		await this.readyPromise;
	}

	private async runMigrations(): Promise<void> {
		const schema = this.schema;

		await sql.unsafe(`
			CREATE TABLE IF NOT EXISTS ${schema}.organizations (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL UNIQUE,
				slug TEXT NOT NULL UNIQUE,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);

			CREATE TABLE IF NOT EXISTS ${schema}.users (
				id TEXT PRIMARY KEY,
				firebase_uid TEXT NOT NULL UNIQUE,
				email TEXT NOT NULL UNIQUE,
				display_name TEXT NOT NULL,
				disassociated BOOLEAN NOT NULL DEFAULT FALSE,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);

			CREATE TABLE IF NOT EXISTS ${schema}.memberships (
				id TEXT PRIMARY KEY,
				organization_id TEXT NOT NULL REFERENCES ${schema}.organizations (id) ON DELETE CASCADE,
				user_id TEXT NOT NULL REFERENCES ${schema}.users (id) ON DELETE CASCADE,
				role TEXT NOT NULL,
				origin TEXT NOT NULL,
				joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				welcome_dismissed_at TIMESTAMPTZ NULL
			);

			CREATE TABLE IF NOT EXISTS ${schema}.invites (
				id TEXT PRIMARY KEY,
				token TEXT NOT NULL UNIQUE,
				organization_id TEXT NOT NULL REFERENCES ${schema}.organizations (id) ON DELETE CASCADE,
				email TEXT NOT NULL,
				role TEXT NOT NULL,
				invited_by_user_id TEXT NOT NULL REFERENCES ${schema}.users (id) ON DELETE CASCADE,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				accepted_at TIMESTAMPTZ NULL
			);

			CREATE TABLE IF NOT EXISTS ${schema}.festivals (
				id TEXT PRIMARY KEY,
				organization_id TEXT NOT NULL REFERENCES ${schema}.organizations (id) ON DELETE CASCADE,
				code TEXT NOT NULL,
				name TEXT NOT NULL,
				start_date DATE NOT NULL,
				end_date DATE NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);

			CREATE TABLE IF NOT EXISTS ${schema}.shopify_integrations (
				organization_id TEXT PRIMARY KEY REFERENCES ${schema}.organizations (id) ON DELETE CASCADE,
				store_domain TEXT NOT NULL,
				client_id TEXT NOT NULL,
				encrypted_client_secret TEXT NOT NULL,
				verification_status TEXT NOT NULL DEFAULT 'unknown',
				verified_shop_gid TEXT NULL,
				verified_shop_domain TEXT NULL,
				granted_scopes TEXT[] NOT NULL DEFAULT '{}',
				can_read_products BOOLEAN NOT NULL DEFAULT FALSE,
				can_write_products BOOLEAN NOT NULL DEFAULT FALSE,
				can_read_orders BOOLEAN NOT NULL DEFAULT FALSE,
				integration_version BIGINT NOT NULL DEFAULT 1,
				verified_at TIMESTAMPTZ NULL,
				last_tested_at TIMESTAMPTZ NULL,
				last_error TEXT NULL,
				last_failure_category TEXT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);

			CREATE TABLE IF NOT EXISTS ${schema}.products (
				id TEXT PRIMARY KEY,
				organization_id TEXT NOT NULL REFERENCES ${schema}.organizations (id) ON DELETE CASCADE,
				product_category TEXT NOT NULL,
				membership_type TEXT NULL,
				entitlement_period TEXT NULL,
				shopify_product_gid TEXT NOT NULL,
				shopify_variant_gid TEXT NOT NULL,
				product_name_snapshot TEXT NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				CONSTRAINT products_product_category_check
					CHECK (product_category IN ('membership')),
				CONSTRAINT products_membership_type_check
					CHECK (
						membership_type IS NULL OR membership_type IN ('teacher', 'accompanist')
					),
				CONSTRAINT products_entitlement_period_check
					CHECK (
						entitlement_period IS NULL OR entitlement_period IN ('1_day', '1_month', '1_year')
					),
				CONSTRAINT products_membership_fields_check
					CHECK (
						product_category <> 'membership'
						OR (membership_type IS NOT NULL AND entitlement_period IS NOT NULL)
					)
			);

			ALTER TABLE ${schema}.users
				ADD COLUMN IF NOT EXISTS disassociated BOOLEAN NOT NULL DEFAULT FALSE;

			ALTER TABLE ${schema}.shopify_integrations
				ADD COLUMN IF NOT EXISTS verified_shop_gid TEXT NULL,
				ADD COLUMN IF NOT EXISTS verified_shop_domain TEXT NULL,
				ADD COLUMN IF NOT EXISTS granted_scopes TEXT[] NOT NULL DEFAULT '{}',
				ADD COLUMN IF NOT EXISTS can_read_products BOOLEAN NOT NULL DEFAULT FALSE,
				ADD COLUMN IF NOT EXISTS can_write_products BOOLEAN NOT NULL DEFAULT FALSE,
				ADD COLUMN IF NOT EXISTS can_read_orders BOOLEAN NOT NULL DEFAULT FALSE,
				ADD COLUMN IF NOT EXISTS integration_version BIGINT NOT NULL DEFAULT 1,
				ADD COLUMN IF NOT EXISTS last_failure_category TEXT NULL,
				DROP COLUMN IF EXISTS encrypted_offline_access_token,
				DROP COLUMN IF EXISTS installed_at,
				DROP COLUMN IF EXISTS oauth_state,
				DROP COLUMN IF EXISTS oauth_state_created_at;

			ALTER TABLE ${schema}.shopify_integrations
				DROP CONSTRAINT IF EXISTS shopify_integrations_verification_status_check,
				DROP CONSTRAINT IF EXISTS shopify_integrations_failure_category_check,
				DROP CONSTRAINT IF EXISTS shopify_integrations_version_check;

			ALTER TABLE ${schema}.shopify_integrations
				ADD CONSTRAINT shopify_integrations_verification_status_check
					CHECK (verification_status IN ('unknown', 'ok', 'failed')),
				ADD CONSTRAINT shopify_integrations_failure_category_check
					CHECK (
						last_failure_category IS NULL OR last_failure_category IN (
							'credentials',
							'identity_mismatch',
							'shop_ownership_conflict',
							'missing_scope',
							'transport',
							'upstream'
						)
					),
				ADD CONSTRAINT shopify_integrations_version_check
					CHECK (integration_version > 0);

			CREATE OR REPLACE FUNCTION ${schema}.enforce_shopify_shop_ownership()
			RETURNS TRIGGER AS $$
			BEGIN
				PERFORM pg_advisory_xact_lock(hashtextextended(NEW.store_domain, 0));
				IF NEW.verified_shop_domain IS NOT NULL THEN
					PERFORM pg_advisory_xact_lock(
						hashtextextended(NEW.verified_shop_domain, 0)
					);
				END IF;
				IF EXISTS (
					SELECT 1
					FROM ${schema}.shopify_integrations existing
					WHERE existing.organization_id <> NEW.organization_id
						AND (
							existing.store_domain = NEW.store_domain
							OR existing.verified_shop_domain = NEW.store_domain
							OR (
								NEW.verified_shop_domain IS NOT NULL
								AND (
									existing.store_domain = NEW.verified_shop_domain
									OR existing.verified_shop_domain = NEW.verified_shop_domain
								)
							)
						)
				) THEN
					RAISE EXCEPTION 'Shopify shop ownership conflict'
						USING ERRCODE = '23505';
				END IF;
				RETURN NEW;
			END;
			$$ LANGUAGE plpgsql;

			DROP TRIGGER IF EXISTS enforce_shopify_shop_ownership
				ON ${schema}.shopify_integrations;
			CREATE TRIGGER enforce_shopify_shop_ownership
				BEFORE INSERT OR UPDATE OF store_domain, verified_shop_domain
				ON ${schema}.shopify_integrations
				FOR EACH ROW
				EXECUTE FUNCTION ${schema}.enforce_shopify_shop_ownership();

			ALTER TABLE ${schema}.memberships
				DROP CONSTRAINT IF EXISTS memberships_user_id_key;

			CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_user_org
				ON ${schema}.memberships (user_id, organization_id);

			CREATE UNIQUE INDEX IF NOT EXISTS idx_festivals_org_code
				ON ${schema}.festivals (organization_id, code);

			CREATE UNIQUE INDEX IF NOT EXISTS idx_festivals_org_name_lower
				ON ${schema}.festivals (organization_id, LOWER(name));

			CREATE UNIQUE INDEX IF NOT EXISTS idx_shopify_integrations_store_domain
				ON ${schema}.shopify_integrations (store_domain);

			CREATE UNIQUE INDEX IF NOT EXISTS idx_shopify_integrations_verified_domain
				ON ${schema}.shopify_integrations (verified_shop_domain)
				WHERE verified_shop_domain IS NOT NULL;

			CREATE UNIQUE INDEX IF NOT EXISTS idx_shopify_integrations_verified_gid
				ON ${schema}.shopify_integrations (verified_shop_gid)
				WHERE verified_shop_gid IS NOT NULL;

			CREATE INDEX IF NOT EXISTS idx_products_organization_id
				ON ${schema}.products (organization_id);

			CREATE UNIQUE INDEX IF NOT EXISTS idx_products_shopify_product_gid
				ON ${schema}.products (shopify_product_gid);

			CREATE UNIQUE INDEX IF NOT EXISTS idx_products_shopify_variant_gid
				ON ${schema}.products (shopify_variant_gid);

			CREATE UNIQUE INDEX IF NOT EXISTS idx_products_shopify_product_variant_gid
				ON ${schema}.products (shopify_product_gid, shopify_variant_gid);

			CREATE UNIQUE INDEX IF NOT EXISTS idx_products_org_membership_type
				ON ${schema}.products (organization_id, membership_type)
				WHERE product_category = 'membership';
		`);
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
				o.created_at AS organization_created_at
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
				o.created_at AS organization_created_at
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
			`SELECT id, name, slug, created_at
			 FROM ${this.schema}.organizations
			 WHERE slug = $1
			 LIMIT 1`,
			[slug],
		)) as Array<{
			id: string;
			name: string;
			slug: string;
			created_at: string;
		}>;

		return rows[0] ? mapOrganization(rows[0]) : null;
	}

	async findOrganizationByName(
		name: string,
	): Promise<OrganizationRecord | null> {
		await this.ensureReady();

		const rows = (await sql.unsafe(
			`SELECT id, name, slug, created_at
			 FROM ${this.schema}.organizations
			 WHERE LOWER(name) = LOWER($1)
			 LIMIT 1`,
			[name],
		)) as Array<{
			id: string;
			name: string;
			slug: string;
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
			 RETURNING id, name, slug, created_at`,
			[randomUUID(), input.name, input.slug],
		)) as Array<{
			id: string;
			name: string;
			slug: string;
			created_at: string;
		}>;

		return mapOrganization(row);
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
				o.created_at AS organization_created_at
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
				name,
				start_date,
				end_date
			) VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING
				id,
				organization_id,
				code,
				name,
				start_date::text AS start_date,
				end_date::text AS end_date,
				created_at`,
			[
				input.id,
				input.organizationId,
				input.code,
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
				verification_status,
				verified_shop_gid,
				verified_shop_domain,
				granted_scopes,
				can_read_products,
				can_write_products,
				can_read_orders,
				integration_version,
				verified_at,
				last_tested_at,
				last_error,
				last_failure_category,
				created_at,
				updated_at
			 FROM ${this.schema}.shopify_integrations
			 WHERE organization_id = $1
			 LIMIT 1`,
			[organizationId],
		)) as ShopifyIntegrationRow[];

		return rows[0] ? mapShopifyIntegration(rows[0]) : null;
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
				verification_status,
				verified_at,
				last_tested_at,
				last_error,
				last_failure_category,
				updated_at
			) VALUES ($1, $2, $3, $4, 'unknown', NULL, NULL, NULL, NULL, NOW())
			ON CONFLICT (organization_id) DO UPDATE SET
				store_domain = EXCLUDED.store_domain,
				client_id = EXCLUDED.client_id,
				encrypted_client_secret = EXCLUDED.encrypted_client_secret,
				verification_status = 'unknown',
				verified_shop_gid = NULL,
				verified_shop_domain = NULL,
				granted_scopes = '{}',
				can_read_products = FALSE,
				can_write_products = FALSE,
				can_read_orders = FALSE,
				integration_version = ${this.schema}.shopify_integrations.integration_version + 1,
				verified_at = NULL,
				last_tested_at = NULL,
				last_error = NULL,
				last_failure_category = NULL,
				updated_at = NOW()
			RETURNING
				organization_id,
				store_domain,
				client_id,
				encrypted_client_secret,
				verification_status,
				verified_shop_gid,
				verified_shop_domain,
				granted_scopes,
				can_read_products,
				can_write_products,
				can_read_orders,
				integration_version,
				verified_at,
				last_tested_at,
				last_error,
				last_failure_category,
				created_at,
				updated_at`,
				[
					input.organizationId,
					input.storeDomain,
					input.clientId,
					input.encryptedClientSecret,
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
				can_read_orders = $8,
				verified_at = $9,
				last_tested_at = $10,
				last_error = $11,
				last_failure_category = $12,
				updated_at = NOW()
			 WHERE organization_id = $1
			 RETURNING
				organization_id,
				store_domain,
				client_id,
				encrypted_client_secret,
				verification_status,
				verified_shop_gid,
				verified_shop_domain,
				granted_scopes,
				can_read_products,
				can_write_products,
				can_read_orders,
				integration_version,
				verified_at,
				last_tested_at,
				last_error,
				last_failure_category,
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

	async createMembershipProductRecord(
		input: CreateMembershipProductRecordInput,
	): Promise<ProductRecord> {
		await this.ensureReady();

		const [row] = (await sql.unsafe(
			`INSERT INTO ${this.schema}.products (
				id,
				organization_id,
				product_category,
				membership_type,
				entitlement_period,
				shopify_product_gid,
				shopify_variant_gid,
				product_name_snapshot,
				updated_at
			) VALUES ($1, $2, 'membership', $3, $4, $5, $6, $7, NOW())
			RETURNING
				id,
				organization_id,
				product_category,
				membership_type,
				entitlement_period,
				shopify_product_gid,
				shopify_variant_gid,
				product_name_snapshot,
				created_at,
				updated_at`,
			[
				randomUUID(),
				input.organizationId,
				input.membershipType,
				input.entitlementPeriod,
				input.shopifyProductGid,
				input.shopifyVariantGid,
				input.productNameSnapshot,
			],
		)) as ProductRow[];

		return mapProduct(row);
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
				membership_type,
				entitlement_period,
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

	async findMembershipProductRecordByType(
		organizationId: string,
		membershipType: MembershipProductType,
	): Promise<ProductRecord | null> {
		await this.ensureReady();

		const rows = (await sql.unsafe(
			`SELECT
				id,
				organization_id,
				product_category,
				membership_type,
				entitlement_period,
				shopify_product_gid,
				shopify_variant_gid,
				product_name_snapshot,
				created_at,
				updated_at
			 FROM ${this.schema}.products
			 WHERE organization_id = $1
			   AND product_category = 'membership'
			   AND membership_type = $2
			 LIMIT 1`,
			[organizationId, membershipType],
		)) as ProductRow[];

		return rows[0] ? mapProduct(rows[0]) : null;
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
				membership_type,
				entitlement_period,
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
				membership_type,
				entitlement_period,
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
}
