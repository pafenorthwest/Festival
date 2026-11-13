import { expect, spyOn, test } from "bun:test";
import { createApp } from "../src/app.js";
import { PostgresMembershipCommerceRepository } from "../src/commerce/postgres-membership-commerce-repository.js";
import { ShopifyWebhookService } from "../src/commerce/shopify-webhook-service.js";
import { CustomerAccountService } from "../src/customer/customer-account-service.js";
import { PostgresCustomerAccountRepository } from "../src/customer/postgres-customer-account-repository.js";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";
import { OrganizationService } from "../src/services/organization-service.js";
import {
	SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
	ShopifySecretKeyring,
} from "../src/shopify/encryption.js";
import { PublicMembershipProductService } from "../src/shopify/public-membership-product-service.js";
import { ShopifyIntegrationService } from "../src/shopify/shopify-integration-service.js";
import { ShopifyMembershipProductService } from "../src/shopify/shopify-membership-product-service.js";
import type { PublicShopifyCatalogProduct } from "../src/shopify/shopify-public-catalog-client.js";
import type { ShopifyProductClient } from "../src/shopify/types.js";
import {
	type ApplicationPostgresFixture,
	withApplicationRollback,
} from "./postgres-application-fixture.js";

const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;
const ORIGIN = "https://festival.example.com";
const KEY = Buffer.alloc(32, 5).toString("base64");
const NOW = new Date("2026-11-12T12:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const SCOPES = [
	"read_products",
	"write_products",
	"write_inventory",
	"read_publications",
	"write_publications",
	"read_orders",
];
const [GID_P, GID_V] = [
	"gid://shopify/Product/501",
	"gid://shopify/ProductVariant/601",
];
const TOK = JSON.stringify({
	accessToken: "t",
	refreshToken: "r",
	idToken: "i",
	accessExpiresAtIso: "2027-01-01T00:00:00.000Z",
	issuer: "https://shopify.com/authentication/1",
});
const HEADERS = {
	Authorization: "Bearer admin",
	Origin: ORIGIN,
	"Content-Type": "application/json",
};

async function seedPgSession(
	cr: PostgresCustomerAccountRepository,
	k: ShopifySecretKeyring,
	target: { orgId: string; sid: string; domain: string },
) {
	const {
		orgId: organizationId,
		sid: sessionId,
		domain: storefrontDomain,
	} = target;
	await cr.upsertIntegration({
		organizationId,
		storefrontDomain,
		clientId: "c",
		encryptedClientSecret: "e",
	});
	await cr.setIntegrationReadiness(organizationId, {
		readiness: "ready",
		canReadOrders: true,
		verifiedAtIso: NOW_ISO,
	});
	const encryptedTokens = k.encrypt(TOK, {
		organizationId,
		purpose: SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
	});
	await cr.createCustomerSession({
		sessionId,
		organizationId,
		shopifyCustomerGid: `gid://shopify/Customer/${sessionId}`,
		encryptedTokens,
		csrfToken: "csrf-pg",
		integrationVersion: 1,
		createdAtIso: NOW_ISO,
		lastSeenAtIso: NOW_ISO,
		expiresAtIso: "2026-12-01T00:00:00.000Z",
	});
}

async function seedPgTenant(
	fx: ApplicationPostgresFixture,
	deps: {
		r: PostgresOrganizationRepository;
		cr: PostgresCustomerAccountRepository;
		k: ShopifySecretKeyring;
	},
) {
	const tag = fx.id("t").slice(0, 12).toLowerCase();
	const [slug, newSlug, shop] = [
		`pg-${tag}`,
		`new-${tag}`,
		`shop-${tag}.myshopify.com`,
	];
	const admin = {
		uid: fx.id("u"),
		email: `${tag}@example.com`,
		displayName: "Admin",
	};
	const orgs = new OrganizationService(deps.r);
	const { organization } = await orgs.createOrganization(admin, {
		name: `PG Org ${tag}`,
		shortName: slug,
	});
	fx.trackOrganization(organization.id);
	await deps.r.updateOrganizationTimezone(
		organization.id,
		"America/Los_Angeles",
	);
	await deps.r.updateRegistrationAgeConfiguration({
		organizationId: organization.id,
		registrationAgeDate: "2026-09-01",
	});
	const offering = await deps.r.createMembershipProductRecord({
		organizationId: organization.id,
		entitlementClass: "teacher_membership",
		durationDays: 365,
		isActive: true,
		shopifyProductGid: GID_P,
		shopifyVariantGid: GID_V,
		productNameSnapshot: "PG Membership",
	});
	const sess = fx.id("s");
	await seedPgSession(deps.cr, deps.k, {
		orgId: organization.id,
		sid: sess,
		domain: shop,
	});
	return { tag, slug, newSlug, shop, sess, admin, orgs, offering };
}

function createPgServices(
	tag: string,
	deps: {
		r: PostgresOrganizationRepository;
		cr: PostgresCustomerAccountRepository;
		mr: PostgresMembershipCommerceRepository;
		k: ShopifySecretKeyring;
	},
) {
	const price = { amount: "80.00", currencyCode: "USD" };
	const item: PublicShopifyCatalogProduct = {
		id: GID_P,
		title: "PG Membership",
		description: "Annual.",
		availableForSale: true,
		variant: { id: GID_V, availableForSale: true, price },
	};
	const cat = {
		calls: 0,
		async readProduct(_d: string, gid: string) {
			this.calls += 1;
			return gid === GID_P ? item : null;
		},
	};
	const opts = { publicOrigin: ORIGIN, now: () => NOW };
	const cust = new CustomerAccountService(
		deps.cr,
		deps.r,
		deps.k,
		opts,
		deps.mr,
	);
	const pub = new PublicMembershipProductService(deps.r, cat, deps.k);
	const audit = { ensureReady: async () => {}, append: async () => {} };
	const adm = new ShopifyMembershipProductService(
		deps.r,
		deps.k,
		{} as ShopifyProductClient,
		audit,
	);
	const shopGid = `gid://shopify/Shop/${tag.replaceAll("-", "")}`;
	const intg = new ShopifyIntegrationService(deps.r, deps.k, {
		testCredentials: async (c) => ({
			shopGid,
			shopDomain: c.storeDomain,
			grantedScopes: SCOPES,
		}),
	});
	const wh = new ShopifyWebhookService(
		deps.r,
		deps.mr,
		deps.k,
		undefined,
		() => NOW,
	);
	return { cat, cust, pub, adm, intg, wh };
}

async function setupPgStack(fx: ApplicationPostgresFixture) {
	const keys = JSON.stringify({ t: KEY });
	const k = ShopifySecretKeyring.fromEnvironment(keys, "t");
	if (!k) throw new Error("Expected keyring.");
	const r = fx.repository(new PostgresOrganizationRepository(fx.schema));
	const cr = fx.repository(new PostgresCustomerAccountRepository(fx.schema));
	const mr = fx.repository(new PostgresMembershipCommerceRepository(fx.schema));
	const t = await seedPgTenant(fx, { r, cr, k });
	const s = createPgServices(t.tag, { r, cr, mr, k });
	const env = {
		port: 3000,
		publicOrigin: ORIGIN,
		allowedApiOrigins: [ORIGIN],
		festivalSecretKeysJson: keys,
		festivalActiveSecretKeyId: "t",
	};
	const { app } = await createApp({
		env,
		repository: r,
		commerceRepository: mr,
		customerAccountRepository: cr,
		customerAccountService: s.cust,
		publicMembershipProductService: s.pub,
		shopifyMembershipProductService: s.adm,
		shopifyIntegrationService: s.intg,
		shopifyWebhookService: s.wh,
		authVerifier: { verify: async () => t.admin },
	});
	const post = (p: string, b: unknown) =>
		app.request(p, {
			method: "POST",
			headers: HEADERS,
			body: JSON.stringify(b),
		});
	await post(`/api/organizations/${t.slug}/admin/shopify`, {
		storeUrl: t.shop,
		clientId: "a1",
		clientSecret: "test-shopify-secret-pg",
	});
	const seed = (orgId: string, sid: string, domain: string) =>
		seedPgSession(cr, k, { orgId, sid, domain });
	return { t, s, r, post, seed };
}

integrationTest(
	"Postgres 17 [G1]: newly created slug has zero 404 negative-cache lockout",
	async () => {
		await withApplicationRollback(async (fx) => {
			const { t, s, seed } = await setupPgStack(fx);
			await expect(s.cust.start(t.newSlug)).rejects.toMatchObject({
				status: 404,
			});
			const created = await t.orgs.createOrganization(t.admin, {
				name: `New ${t.tag}`,
				shortName: t.newSlug,
			});
			fx.trackOrganization(created.organization.id);
			const newSess = fx.id("sn");
			await seed(created.organization.id, newSess, `n-${t.shop}`);
			const res = await s.cust.formAccess(
				t.newSlug,
				newSess,
				"csrf-pg",
				ORIGIN,
			);
			expect(res.organizationId).toBe(created.organization.id);
		});
	},
);

integrationTest(
	"Postgres 17 [G1]: timezone and registrationAgeDate updates invalidate immediately",
	async () => {
		await withApplicationRollback(async (fx) => {
			const { t, s, post } = await setupPgStack(fx);
			const addChild = (displayName: string) =>
				s.cust.createChild(t.slug, t.sess, "csrf-pg", ORIGIN, {
					displayName,
					birthday: "2016-11-15",
				});
			const c1 = await addChild("Ada One");
			const a1 = await s.cust.formAccess(t.slug, t.sess, "csrf-pg", ORIGIN);
			expect([c1.ageSnapshot.age, a1.organizationTimezone]).toEqual([
				9,
				"America/Los_Angeles",
			]);

			await post(`/api/organizations/${t.slug}/admin/registration-age-date`, {
				registrationAgeDate: "2027-01-01",
			});
			await post(`/api/organizations/${t.slug}/admin/timezone`, {
				timezone: "America/New_York",
			});
			const c2 = await addChild("Ada Two");
			const a2 = await s.cust.formAccess(t.slug, t.sess, "csrf-pg", ORIGIN);
			expect([c2.ageSnapshot.age, a2.organizationTimezone]).toEqual([
				10,
				"America/New_York",
			]);
		});
	},
);

integrationTest(
	"Postgres 17 [G4]: PublicMembershipProductService caches warm reads and invalidates",
	async () => {
		await withApplicationRollback(async (fx) => {
			const { t, s, r, post } = await setupPgStack(fx);
			s.cat.calls = 0;
			await Promise.all([s.pub.list(t.slug), s.pub.list(t.slug)]);
			await s.pub.list(t.slug);
			expect(s.cat.calls).toBe(1);

			await post(`/api/organizations/${t.slug}/admin/shopify`, {
				storeUrl: `rot-${t.shop}`,
				clientId: "a2",
				clientSecret: "test-shopify-secret-rot",
			});
			await s.pub.list(t.slug);
			expect(s.cat.calls).toBe(2);

			const slugSpy = spyOn(r, "findOrganizationBySlug");
			s.wh.clearCaches();
			await s.pub.list(t.slug);
			expect([s.cat.calls, slugSpy.mock.calls.length > 0]).toEqual([3, true]);

			await post(
				`/api/organizations/${t.slug}/admin/membership-products/${t.offering.id}/retire`,
				{
					confirmed: true,
				},
			);
			expect((await s.pub.list(t.slug)).membershipProducts).toEqual([]);
		});
	},
);
