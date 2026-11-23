import { randomBytes, randomUUID } from "node:crypto";
import { CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION } from "@festival/common";
import type { CustomerAccountRepository } from "../../../packages/backend/src/customer/customer-account-repository.js";
import { CUSTOMER_SESSION_COOKIE } from "../../../packages/backend/src/domains/customer-identity/index.js";
import type { TokenBundle } from "../../../packages/backend/src/domains/customer-identity/oauth-tokens.js";
import type { RepertoireRepository } from "../../../packages/backend/src/repertoire/index.js";
import type { OrganizationRepository } from "../../../packages/backend/src/repo/organization-repository.js";
import { loadTestData } from "../../../packages/backend/src/seed/test-data-loader.js";
import {
	SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
	ShopifySecretKeyring,
} from "../../../packages/backend/src/shopify/encryption.js";
import {
	E2E_OIDC_ISSUER,
	E2E_STOREFRONT_DOMAIN,
	ensureE2eCustomerAccountIntegration,
	ensureE2eMembershipProducts,
	ensureE2eShopifyAdminIntegration,
} from "./e2e-shopify-mocks.js";

export { E2E_OIDC_ISSUER, E2E_STOREFRONT_DOMAIN };

export const E2E_SECRET_KEY_ID = "e2e-k1";
export const E2E_SECRET_KEY_B64 = Buffer.alloc(32, 0x42).toString("base64");
export const E2E_SECRET_KEYS_JSON = JSON.stringify({ [E2E_SECRET_KEY_ID]: E2E_SECRET_KEY_B64 });
export const E2E_ORG_SLUG = "pafe-northwest";

export type E2eCustomerRole = "teacher" | "accompanist-prospect" | "logout";

export interface MintedCustomerSession {
	sessionId: string;
	csrfToken: string;
	cookieName: string;
	slug: string;
}

export interface SeededE2eEnvironment {
	organizationId: string;
	slug: string;
	festivalId: string;
	mintCustomerSession(role: E2eCustomerRole): Promise<MintedCustomerSession>;
}

interface SeedE2eDeps {
	organizations: OrganizationRepository;
	accounts: CustomerAccountRepository;
	repertoire: RepertoireRepository;
	keyring: ShopifySecretKeyring;
}

interface RoleProfile {
	shopifyCustomerGid: string;
	name: string;
	email: string;
	phone: string;
	city: string;
	preseeded: boolean;
}

const ROLE_PROFILES: Record<E2eCustomerRole, RoleProfile> = {
	teacher: {
		shopifyCustomerGid: "gid://shopify/Customer/8001001",
		name: "Dr. Clara Schumann",
		email: "clara.schumann@pafe-teachers.example.org",
		phone: "+1 (206) 555-0101",
		city: "Seattle",
		preseeded: true,
	},
	"accompanist-prospect": {
		shopifyCustomerGid: "gid://shopify/Customer/8009001",
		name: "Jordan Ellis",
		email: "jordan.ellis@pafe-e2e.example.org",
		phone: "+1 (206) 555-0901",
		city: "Seattle",
		preseeded: false,
	},
	logout: {
		shopifyCustomerGid: "gid://shopify/Customer/8009002",
		name: "Taylor Reed",
		email: "taylor.reed@pafe-e2e.example.org",
		phone: "+1 (206) 555-0902",
		city: "Bellevue",
		preseeded: false,
	},
};

export function createE2eSecretKeyring(): ShopifySecretKeyring {
	const keyring = ShopifySecretKeyring.fromEnvironment(
		E2E_SECRET_KEYS_JSON,
		E2E_SECRET_KEY_ID,
	);
	if (!keyring) throw new Error("Failed to construct E2E ShopifySecretKeyring.");
	return keyring;
}

async function ensureExtraCustomerProfile(
	accounts: CustomerAccountRepository,
	organizationId: string,
	profile: RoleProfile,
	integrationVersion: number,
	nowIso: string,
): Promise<void> {
	let customer = await accounts.getCustomerByShopifyGid(
		organizationId,
		profile.shopifyCustomerGid,
	);
	if (!customer) {
		const sanitized = profile.shopifyCustomerGid.replace(/[^a-zA-Z0-9]/g, "_");
		customer = (
			await accounts.createCustomerSession({
				sessionId: `e2e_seed_${sanitized}`,
				organizationId,
				shopifyCustomerGid: profile.shopifyCustomerGid,
				encryptedTokens: "e2e-seed-revoked",
				csrfToken: "e2e-seed-csrf",
				integrationVersion,
				createdAtIso: nowIso,
				lastSeenAtIso: nowIso,
				expiresAtIso: nowIso,
				revokedAtIso: nowIso,
			})
		).customer;
	}
	await accounts.applyCustomerProfile({
		customerId: customer.id,
		organizationId,
		source: "festival",
		updatedAtIso: nowIso,
		profile: {
			name: profile.name,
			email: profile.email,
			phone: profile.phone,
			mailingAddress: { line1: "500 Festival Way", city: profile.city, region: "WA", postalCode: "98101", countryCode: "US" },
		},
	});
	await accounts.recordVerifiedShopifyEmail({ organizationId, customerId: customer.id, email: profile.email, verifiedAtIso: nowIso });
	await accounts.recordStaffAccessConsent({
		customerId: customer.id,
		organizationId,
		privacyNoticeVersion: CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
		consentedAtIso: nowIso,
	});
}

async function ensureConcertoAndUpcomingFestival(
	deps: SeedE2eDeps,
	organizationId: string,
): Promise<void> {
	const concertos =
		await deps.repertoire.listCatalogConcertoSnapshot(organizationId);
	if (!concertos.some((work) => work.isConcerto)) {
		await deps.repertoire.addCatalogWork({
			organizationId,
			title: "Piano Concerto No. 21 in C major, K. 467",
			composerName: "Wolfgang Amadeus Mozart",
			classifications: ["concerto"],
		});
	}
	const upcomingShortName = "e2e-upcoming";
	const existing = await deps.organizations.findFestivalByShortName(
		organizationId,
		upcomingShortName,
	);
	if (existing) return;
	const startDate = new Date(Date.now() + 60 * 86_400_000)
		.toISOString()
		.slice(0, 10);
	const endDate = new Date(Date.now() + 70 * 86_400_000)
		.toISOString()
		.slice(0, 10);
	await deps.organizations.createFestival({
		id: randomUUID(),
		organizationId,
		code: "E2EUP",
		shortName: upcomingShortName,
		name: "PAFE Northwest Spring Festival",
		startDate,
		endDate,
		isPrimary: false,
	});
}

async function ensureApprovedDirectoryProfiles(
	deps: SeedE2eDeps,
	organizationId: string,
): Promise<void> {
	const divisions = await deps.organizations.listDivisions(organizationId);
	const pianoDiv = divisions.find((d) => d.displayName === "Piano");
	const divisionIds = pianoDiv ? [pianoDiv.id] : [];

	const clara = await deps.accounts.getCustomerByShopifyGid(
		organizationId,
		ROLE_PROFILES.teacher.shopifyCustomerGid,
	);
	if (clara) {
		const claraProfile = await deps.organizations.upsertTeacherProfile({
			organizationId,
			customerId: clara.id,
			displayName: ROLE_PROFILES.teacher.name,
			publicDirectoryOptIn: true,
			divisionIds,
		});
		await deps.organizations.updateTeacherProfileApproval(
			organizationId,
			claraProfile.id,
			"approved",
		);
	}

	const gerald = await deps.accounts.getCustomerByShopifyGid(
		organizationId,
		"gid://shopify/Customer/8002001",
	);
	if (gerald) {
		const geraldProfile = await deps.organizations.upsertAccompanistProfile({
			organizationId,
			customerId: gerald.id,
			displayName: "Gerald Moore",
			publicDirectoryOptIn: true,
			divisionIds,
		});
		await deps.organizations.updateAccompanistProfileApproval(
			organizationId,
			geraldProfile.id,
			"approved",
		);
	}
}

async function ensureExtraRolesAndProspectProfile(
	deps: SeedE2eDeps,
	organizationId: string,
	integrationVersion: number,
	nowIso: string,
): Promise<void> {
	for (const profile of Object.values(ROLE_PROFILES)) {
		if (!profile.preseeded) {
			await ensureExtraCustomerProfile(deps.accounts, organizationId, profile, integrationVersion, nowIso);
		}
	}
	const prospect = await deps.accounts.getCustomerByShopifyGid(
		organizationId,
		ROLE_PROFILES["accompanist-prospect"].shopifyCustomerGid,
	);
	if (prospect) {
		await deps.organizations.upsertAccompanistProfile({
			organizationId,
			customerId: prospect.id,
			displayName: ROLE_PROFILES["accompanist-prospect"].name,
			publicDirectoryOptIn: false,
			divisionIds: [],
		});
	}
}

function createSessionMinter(
	deps: SeedE2eDeps,
	organizationId: string,
	slug: string,
): (role: E2eCustomerRole) => Promise<MintedCustomerSession> {
	return async (role) => {
		const profile = ROLE_PROFILES[role];
		const current = await deps.accounts.getIntegration(organizationId);
		const now = Date.now();
		const nowStr = new Date(now).toISOString();
		const expiresAtIso = new Date(now + 7 * 86_400_000).toISOString();
		const sessionId = `e2e_sess_${randomBytes(16).toString("base64url")}`;
		const csrfToken = `e2e_csrf_${randomBytes(16).toString("base64url")}`;
		const bundle: TokenBundle = {
			accessToken: `e2e-access-${role}-${sessionId}`,
			refreshToken: `e2e-refresh-${role}-${sessionId}`,
			idToken: `e2e-id-token-${role}`,
			accessExpiresAtIso: new Date(now + 24 * 3_600_000).toISOString(),
			refreshExpiresAtIso: expiresAtIso,
			issuer: E2E_OIDC_ISSUER,
		};
		await deps.accounts.createCustomerSession({
			sessionId,
			organizationId,
			shopifyCustomerGid: profile.shopifyCustomerGid,
			encryptedTokens: deps.keyring.encrypt(JSON.stringify(bundle), {
				organizationId,
				purpose: SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
			}),
			csrfToken,
			integrationVersion: current?.integrationVersion ?? 1,
			createdAtIso: nowStr,
			lastSeenAtIso: nowStr,
			expiresAtIso,
		});
		return { sessionId, csrfToken, cookieName: CUSTOMER_SESSION_COOKIE, slug };
	};
}

export async function seedE2eEnvironment(
	deps: SeedE2eDeps,
): Promise<SeededE2eEnvironment> {
	const summary = await loadTestData({
		organizations: deps.organizations,
		accounts: deps.accounts,
	});
	const pafe = summary.organizations.find((o) => o.slug === E2E_ORG_SLUG);
	if (!pafe) throw new Error(`Expected seeded organization "${E2E_ORG_SLUG}".`);

	const nowIso = new Date().toISOString();
	const integrationVersion = await ensureE2eCustomerAccountIntegration({
		accounts: deps.accounts,
		keyring: deps.keyring,
		organizationId: pafe.organizationId,
		nowIso,
	});
	await ensureE2eShopifyAdminIntegration({
		organizations: deps.organizations,
		keyring: deps.keyring,
		organizationId: pafe.organizationId,
		nowIso,
	});
	await ensureE2eMembershipProducts(deps.organizations, pafe.organizationId);
	await ensureConcertoAndUpcomingFestival(deps, pafe.organizationId);
	await ensureApprovedDirectoryProfiles(deps, pafe.organizationId);
	await ensureExtraRolesAndProspectProfile(
		deps,
		pafe.organizationId,
		integrationVersion,
		nowIso,
	);

	return {
		organizationId: pafe.organizationId,
		slug: pafe.slug,
		festivalId: pafe.festivalId,
		mintCustomerSession: createSessionMinter(
			deps,
			pafe.organizationId,
			pafe.slug,
		),
	};
}
