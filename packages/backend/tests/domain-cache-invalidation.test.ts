import { describe, expect, it, spyOn } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "../src/app.js";
import { InMemoryMembershipCommerceRepository } from "../src/commerce/membership-commerce-repository.js";
import { ShopifyWebhookService } from "../src/commerce/shopify-webhook-service.js";
import { CustomerAccountService } from "../src/customer/customer-account-service.js";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";
import { AppError } from "../src/errors/app-error.js";
import { BoundedAsyncCache } from "../src/lib/bounded-async-cache.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { OrganizationService } from "../src/services/organization-service.js";
import {
	SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
	ShopifySecretKeyring,
} from "../src/shopify/encryption.js";
import { PublicMembershipProductService } from "../src/shopify/public-membership-product-service.js";
import { ShopifyIntegrationService } from "../src/shopify/shopify-integration-service.js";
import { ShopifyMembershipProductService } from "../src/shopify/shopify-membership-product-service.js";
import type { PublicShopifyCatalogProduct } from "../src/shopify/shopify-public-catalog-client.js";
import type {
	ShopifyProductClient,
	ShopifyProductDetails,
} from "../src/shopify/types.js";

const ORIGIN = "https://festival.example.com";
const KEY = Buffer.alloc(32, 9).toString("base64");
const ADMIN = { uid: "u1", email: "a@example.com", displayName: "Admin" };
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
	"gid://shopify/Product/101",
	"gid://shopify/ProductVariant/201",
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

function catalogEntry(
	title = "Teacher Membership",
	amount = "75.00",
): PublicShopifyCatalogProduct {
	const price = { amount, currencyCode: "USD" };
	const variant = { id: GID_V, availableForSale: true, price };
	return {
		id: GID_P,
		title,
		description: "Annual.",
		availableForSale: true,
		variant,
	};
}

function adminProduct(
	title = "Teacher Membership",
	amount = "75.00",
): ShopifyProductDetails {
	const v = {
		id: GID_V,
		title: "Standard",
		price: { amount, currencyCode: "USD" },
		productId: GID_P,
		selectedOptions: [{ name: "Plan", value: "Standard" }],
		requiresShipping: false,
		inventoryItemId: "gid://shopify/InventoryItem/301",
	};
	return {
		id: GID_P,
		title,
		description: "Annual.",
		status: "ACTIVE",
		variants: [v],
	};
}

function createFakeAdminClient(): ShopifyProductClient {
	let p = adminProduct();
	return {
		createProduct: async () => ({ value: p }),
		updateProductDetails: async (_c, i) => {
			p = adminProduct(i.name, p.variants[0]?.price.amount ?? "75.00");
			return { value: p };
		},
		updateVariantPrice: async (_c, i) => {
			p = adminProduct(p.title, i.price);
			return { value: p };
		},
		updateInventoryItem: async (_c, i) => ({
			value: { requiresShipping: i.requiresShipping },
		}),
		publishProductToHeadlessStorefront: async () => ({ value: undefined }),
		readProductsByGid: async () => ({ value: [p] }),
		deleteProduct: async () => ({ value: undefined }),
	};
}

async function seedSession(
	cr: InMemoryCustomerAccountRepository,
	k: ShopifySecretKeyring,
	target: { orgId: string; sid: string },
) {
	const { orgId: organizationId, sid: sessionId } = target;
	await cr.upsertIntegration({
		organizationId,
		storefrontDomain: "pafe-fest.myshopify.com",
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
		csrfToken: "csrf-1",
		integrationVersion: 1,
		createdAtIso: NOW_ISO,
		lastSeenAtIso: NOW_ISO,
		expiresAtIso: "2026-12-01T00:00:00.000Z",
	});
}

async function createInMemoryStack(k: ShopifySecretKeyring) {
	const r = new InMemoryOrganizationRepository();
	const cr = new InMemoryCustomerAccountRepository();
	const mr = new InMemoryMembershipCommerceRepository(r);
	const orgs = new OrganizationService(r);
	const { organization } = await orgs.createOrganization(ADMIN, {
		name: "PAFE Festival",
		shortName: "pafe",
	});
	await r.updateOrganizationTimezone(organization.id, "America/Los_Angeles");
	await r.updateRegistrationAgeConfiguration({
		organizationId: organization.id,
		registrationAgeDate: "2026-09-01",
	});
	await seedSession(cr, k, { orgId: organization.id, sid: "sess-1" });
	const cat = {
		calls: 0,
		failNext: false,
		products: new Map([[GID_P, catalogEntry()]]),
		async readProduct(_d: string, gid: string) {
			this.calls += 1;
			if (this.failNext) throw new AppError("Unavailable.", 503);
			return this.products.get(gid) ?? null;
		},
	};
	const cust = new CustomerAccountService(
		cr,
		r,
		k,
		{ publicOrigin: ORIGIN, now: () => NOW },
		mr,
	);
	const pub = new PublicMembershipProductService(r, cat, k);
	const audit = { ensureReady: async () => {}, append: async () => {} };
	const adm = new ShopifyMembershipProductService(
		r,
		k,
		createFakeAdminClient(),
		audit,
	);
	const intg = new ShopifyIntegrationService(r, k, {
		testCredentials: async (c) => ({
			shopGid: "gid://shopify/Shop/1",
			shopDomain: c.storeDomain,
			grantedScopes: SCOPES,
		}),
	});
	const wh = new ShopifyWebhookService(r, mr, k, undefined, () => NOW);
	return { r, cr, cat, orgs, cust, pub, adm, intg, wh };
}

async function buildHarness() {
	const keys = JSON.stringify({ t: KEY });
	const k = ShopifySecretKeyring.fromEnvironment(keys, "t");
	if (!k) throw new Error("Expected keyring.");
	const s = await createInMemoryStack(k);
	const env = {
		port: 3000,
		publicOrigin: ORIGIN,
		allowedApiOrigins: [ORIGIN],
		festivalSecretKeysJson: keys,
		festivalActiveSecretKeyId: "t",
	};
	const { app } = await createApp({
		env,
		repository: s.r,
		authVerifier: { verify: async () => ADMIN },
		customerAccountRepository: s.cr,
		customerAccountService: s.cust,
		publicMembershipProductService: s.pub,
		shopifyMembershipProductService: s.adm,
		shopifyIntegrationService: s.intg,
		shopifyWebhookService: s.wh,
	});
	const post = (p: string, b: unknown) =>
		app.request(p, {
			method: "POST",
			headers: HEADERS,
			body: JSON.stringify(b),
		});
	await post("/api/organizations/pafe/admin/shopify", {
		storeUrl: "pafe-fest.myshopify.com",
		clientId: "a1",
		clientSecret: "test-shopify-secret-1",
	});
	const access = (slug = "pafe", sid = "sess-1") =>
		s.cust.formAccess(slug, sid, "csrf-1", ORIGIN);
	let childSeq = 0;
	const addChild = () => {
		childSeq += 1;
		return s.cust.createChild("pafe", "sess-1", "csrf-1", ORIGIN, {
			displayName: `Ada ${childSeq}`,
			birthday: "2016-11-15",
		});
	};
	const seed = (orgId: string, sid: string) =>
		seedSession(s.cr, k, { orgId, sid });
	return { s, post, access, addChild, seed };
}

describe("domain cache invalidation and public membership caching ([G1], [G4])", () => {
	it("exposes canonical bounded-async-cache and domain-cache-invalidator modules", () => {
		const dir = import.meta.dir;
		expect(existsSync(resolve(dir, "../src/lib/bounded-async-cache.ts"))).toBe(
			true,
		);
		expect(
			existsSync(resolve(dir, "../src/lib/domain-cache-invalidator.ts")),
		).toBe(true);
	});

	it("never negative-caches missing slugs or evicts active tenants under 300 random 404s ([G1])", async () => {
		const { s, access, seed } = await buildHarness();
		await access();
		const slugSpy = spyOn(s.r, "findOrganizationBySlug");
		for (let i = 0; i < 300; i += 1) {
			await expect(s.cust.start(`missing-${i}`)).rejects.toMatchObject({
				status: 404,
			});
		}
		expect(s.cust.cacheMetrics().organizationBySlug.evictions).toBe(0);
		slugSpy.mockClear();
		await access();
		expect(slugSpy).toHaveBeenCalledTimes(0);

		await expect(s.cust.start("brand-new-org")).rejects.toMatchObject({
			status: 404,
		});
		const { organization } = await s.orgs.createOrganization(ADMIN, {
			name: "Brand New Org",
			shortName: "brand-new-org",
		});
		await seed(organization.id, "sess-new");
		expect((await access("brand-new-org", "sess-new")).organizationId).toBe(
			organization.id,
		);
	});

	it("invalidates dependent caches on OrganizationService updates and ShopifyWebhookService.clearCaches ([G1])", async () => {
		const { s, post, access, addChild } = await buildHarness();
		await post("/api/organizations/pafe/admin/membership-products", {
			name: "Teacher Membership",
			description: "Annual.",
			price: "75.00",
		});
		const [c1, a1] = [await addChild(), await access()];
		expect([c1.ageSnapshot.age, a1.organizationTimezone]).toEqual([
			9,
			"America/Los_Angeles",
		]);

		const rAge = await post(
			"/api/organizations/pafe/admin/registration-age-date",
			{
				registrationAgeDate: "2027-01-01",
			},
		);
		const rTz = await post("/api/organizations/pafe/admin/timezone", {
			timezone: "America/New_York",
		});
		expect([rAge.status, rTz.status]).toEqual([200, 200]);
		const [c2, a2] = [await addChild(), await access()];
		expect([c2.ageSnapshot.age, a2.organizationTimezone]).toEqual([
			10,
			"America/New_York",
		]);

		await s.pub.list("pafe");
		s.cat.calls = 0;
		const slugSpy = spyOn(s.r, "findOrganizationBySlug");
		const ageSpy = spyOn(s.r, "getRegistrationAgeConfiguration");
		s.wh.clearCaches();
		await addChild();
		await s.pub.list("pafe");
		expect([
			slugSpy.mock.calls.length >= 2,
			ageSpy.mock.calls.length,
			s.cat.calls,
		]).toEqual([true, 1, 1]);
	});

	it("caches PublicMembershipProductService.list defensively, skips errors, and invalidates on writes ([G4])", async () => {
		const { s, post } = await buildHarness();
		const list = () => s.pub.list("pafe");
		await expect(s.pub.list("unknown-org")).rejects.toMatchObject({
			status: 404,
		});
		expect((await list()).membershipProducts).toEqual([]);

		const body = {
			name: "Teacher Membership",
			description: "Annual.",
			price: "75.00",
		};
		const cRes = await post(
			"/api/organizations/pafe/admin/membership-products",
			body,
		);
		const { membershipProduct: prod } = (await cRes.json()) as {
			membershipProduct: { id: string };
		};
		s.cat.failNext = true;
		await expect(list()).rejects.toMatchObject({ status: 503 });
		s.cat.failNext = false;
		s.cat.calls = 0;

		const [r1, r2, r3] = await Promise.all([list(), list(), list()]);
		const [r4, r5] = [await list(), await list()];
		expect([s.cat.calls, r2, r3, r4, r5]).toEqual([1, r1, r1, r1, r1]);

		r1.organization.name = "Mutated";
		if (r1.membershipProducts[0]) r1.membershipProducts[0].name = "Mutated";
		r1.membershipProducts.pop();
		expect([(await list()).membershipProducts[0]?.name, s.cat.calls]).toEqual([
			"Teacher Membership",
			1,
		]);

		s.cat.products.set(GID_P, catalogEntry("Updated Membership", "90.00"));
		await post(`/api/organizations/pafe/admin/membership-products/${prod.id}`, {
			...body,
			name: "Updated Membership",
			price: "90.00",
		});
		expect([(await list()).membershipProducts[0]?.name, s.cat.calls]).toEqual([
			"Updated Membership",
			2,
		]);

		await post("/api/organizations/pafe/admin/shopify", {
			storeUrl: "pafe-rotated.myshopify.com",
			clientId: "a2",
			clientSecret: "test-shopify-secret-2",
		});
		await list();
		expect(s.cat.calls).toBe(3);

		await post(
			`/api/organizations/pafe/admin/membership-products/${prod.id}/retire`,
			{ confirmed: true },
		);
		expect((await list()).membershipProducts).toEqual([]);
	});

	it("prevents in-flight PublicMembershipProductService.list from coalescing or repopulating stale data after invalidation ([G1], [G4])", async () => {
		const { s, post } = await buildHarness();
		const created = await post(
			"/api/organizations/pafe/admin/membership-products",
			{ name: "Teacher Membership", description: "Annual.", price: "75.00" },
		);
		const { membershipProduct: prod } = (await created.json()) as {
			membershipProduct: { id: string };
		};
		s.cat.calls = 0;

		const load1Started = Promise.withResolvers<void>();
		const load1Gate =
			Promise.withResolvers<PublicShopifyCatalogProduct | null>();
		let pauseFirst = true;
		const baseRead = s.cat.readProduct.bind(s.cat);
		s.cat.readProduct = async (domain: string, gid: string) => {
			if (pauseFirst) {
				pauseFirst = false;
				s.cat.calls += 1;
				load1Started.resolve();
				return load1Gate.promise;
			}
			return baseRead(domain, gid);
		};

		const load1 = s.pub.list("pafe");
		await load1Started.promise;

		s.cat.products.set(GID_P, catalogEntry("Updated Membership", "90.00"));
		await post(`/api/organizations/pafe/admin/membership-products/${prod.id}`, {
			name: "Updated Membership",
			description: "Annual.",
			price: "90.00",
		});

		const load2 = s.pub.list("pafe");
		for (let i = 0; i < 12; i += 1) await Promise.resolve();
		try {
			expect(s.cat.calls).toBe(2);
			const r2 = await load2;
			expect(r2.membershipProducts[0]?.name).toBe("Updated Membership");
		} finally {
			load1Gate.resolve(catalogEntry("Teacher Membership", "75.00"));
			await load1;
		}
		const r3 = await s.pub.list("pafe");
		expect([r3.membershipProducts[0]?.name, s.cat.calls]).toEqual([
			"Updated Membership",
			2,
		]);
	});

	it("discards invalidated or force-superseded in-flight BoundedAsyncCache loads", async () => {
		const cache = new BoundedAsyncCache<string, { orgId: string; v: string }>({
			maxEntries: 16,
			maxEntryBytes: 1024,
			maxTotalBytes: 4096,
		});
		const gate1 = Promise.withResolvers<{ orgId: string; v: string }>();
		const p1 = cache.getOrLoad("pafe", async () => ({
			value: await gate1.promise,
			ttlMs: 60_000,
			bytes: 16,
		}));
		cache.deleteWhere((_k, val) => val.orgId === "other");
		cache.deleteWhere((_k, val) => val.orgId === "org-1");
		gate1.resolve({ orgId: "org-1", v: "stale-1" });
		await p1;
		expect(cache.get("pafe")).toBeUndefined();

		const gate2 = Promise.withResolvers<{ orgId: string; v: string }>();
		const p2 = cache.getOrLoad("pafe", async () => ({
			value: await gate2.promise,
			ttlMs: 60_000,
			bytes: 16,
		}));
		const p3 = cache.getOrLoad(
			"pafe",
			async () => ({
				value: { orgId: "org-1", v: "fresh-2" },
				ttlMs: 60_000,
				bytes: 16,
			}),
			true,
		);
		expect((await p3).v).toBe("fresh-2");
		gate2.resolve({ orgId: "org-1", v: "stale-2" });
		await p2;
		expect(cache.get("pafe")?.v).toBe("fresh-2");
	});
});
