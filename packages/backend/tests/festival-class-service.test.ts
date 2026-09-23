import { describe, expect, it } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";
import { InMemoryMembershipCommerceRepository } from "../src/commerce/membership-commerce-repository.js";
import { CustomerAccountService } from "../src/customer/customer-account-service.js";
import { CustomerAccountTransport } from "../src/customer/customer-account-transport.js";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { OrganizationService } from "../src/services/organization-service.js";
import { ShopifySecretKeyring } from "../src/shopify/encryption.js";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = keys.publicKey.export({ format: "jwk" });
const issuer = "https://shopify.com/authentication/shop-1";

function jwt(nonce?: string) {
	const header = Buffer.from(
		JSON.stringify({ alg: "RS256", kid: "test" }),
	).toString("base64url");
	const payload = Buffer.from(
		JSON.stringify({
			iss: issuer,
			aud: "customer-client",
			exp: Math.floor(Date.now() / 1000) + 3600,
			nonce,
		}),
	).toString("base64url");
	const body = `${header}.${payload}`;
	return `${body}.${sign("RSA-SHA256", Buffer.from(body), keys.privateKey).toString("base64url")}`;
}

function response(value: unknown, status = 200) {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function transportFor(fetcher: typeof fetch, now: () => Date) {
	return new CustomerAccountTransport({
		resolver: async () => [{ address: "8.8.8.8", family: 4, ttlSeconds: 60 }],
		now: () => now().getTime(),
		requester: async (url, _answer, _agent, init) => {
			const result = await fetcher(url, init);
			const bytes = new Uint8Array(await result.arrayBuffer());
			return {
				status: result.status,
				contentLength: bytes.byteLength,
				body: (async function* () {
					yield bytes;
				})(),
			};
		},
	});
}

async function setupCustomerFixture() {
	const customerRepo = new InMemoryCustomerAccountRepository();
	const orgRepo = new InMemoryOrganizationRepository();
	const checkoutRepo = new InMemoryCheckoutRepository();
	const commerceRepo = new InMemoryMembershipCommerceRepository(
		orgRepo,
		checkoutRepo,
	);

	const org = await orgRepo.createOrganization({
		name: "Test Org",
		slug: "test-org",
	});
	const festival = await orgRepo.createFestival({
		id: "fest-1",
		organizationId: org.id,
		code: "FEST26",
		shortName: "fest2026",
		name: "Festival 2026",
		startDate: "2026-06-01",
		endDate: "2026-06-10",
	});
	const festival2 = await orgRepo.createFestival({
		id: "fest-2",
		organizationId: org.id,
		code: "FEST27",
		shortName: "fest2027",
		name: "Festival 2027",
		startDate: "2027-06-01",
		endDate: "2027-06-10",
	});

	let nonce = "";
	const now = new Date();
	const fetcher: typeof fetch = async (input, init) => {
		const url = new URL(input.toString());
		if (url.pathname === "/.well-known/openid-configuration") {
			return response({
				issuer,
				authorization_endpoint: "https://accounts.shopify.com/auth",
				token_endpoint: "https://accounts.shopify.com/token",
				end_session_endpoint: "https://accounts.shopify.com/logout",
				jwks_uri: "https://accounts.shopify.com/jwks",
			});
		}
		if (url.pathname === "/.well-known/customer-account-api") {
			return response({
				graphql_api:
					"https://accounts.shopify.com/customer/api/2026-07/graphql",
			});
		}
		if (url.pathname === "/jwks") {
			return response({
				keys: [{ ...jwk, kid: "test", alg: "RS256", use: "sig" }],
			});
		}
		if (url.pathname === "/token") {
			const body = String(init?.body);
			return response({
				access_token: "access-token-1",
				refresh_token: "refresh-token-1",
				...(body.includes("authorization_code")
					? { id_token: jwt(nonce) }
					: {}),
				expires_in: 3600,
			});
		}
		if (url.pathname.endsWith("/graphql")) {
			return response({
				data: { customer: { id: "gid://shopify/Customer/100" } },
			});
		}
		throw new Error(`Unexpected URL ${url}`);
	};

	const keyring = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ test: Buffer.alloc(32, 7).toString("base64") }),
		"test",
	);
	if (!keyring) throw new Error("keyring");

	const service = new CustomerAccountService(
		customerRepo,
		orgRepo,
		keyring,
		{
			publicOrigin: "https://festival.example.com",
			transport: transportFor(fetcher, () => now),
			now: () => now,
		},
		commerceRepo,
		checkoutRepo,
	);

	await service.saveAndVerify(org.id, org.slug, {
		storefrontDomain: "store.example.com",
		clientId: "customer-client",
		clientSecret: "customer-secret",
	});

	const authorization = await service.start(org.slug);
	const authUrl = new URL(authorization);
	nonce = authUrl.searchParams.get("nonce") ?? "";
	const auth = await service.callback(
		authUrl.searchParams.get("state") ?? "",
		"code-1",
	);

	return {
		service,
		customerRepo,
		orgRepo,
		checkoutRepo,
		commerceRepo,
		org,
		festival,
		festival2,
		sessionId: auth.sessionId,
	};
}

describe("OrganizationService - Festival Class Configuration", () => {
	it("lists, creates, and updates festival classes with validation", async () => {
		const repo = new InMemoryOrganizationRepository();
		const orgService = new OrganizationService(repo);

		const org = await repo.createOrganization({
			name: "Pafe Org",
			slug: "pafe-org",
		});
		const festival = await repo.createFestival({
			id: "fest-1",
			organizationId: org.id,
			code: "PF2026",
			shortName: "pf2026",
			name: "Pafe Festival 2026",
			startDate: "2026-05-01",
			endDate: "2026-05-10",
		});
		const division = await repo.createDivision({
			organizationId: org.id,
			displayName: "Strings",
			normalizedName: "strings",
		});
		const subtype = await repo.createRegistrationCatalogValue({
			organizationId: org.id,
			kind: "class_subtype",
			displayName: "Solo",
			normalizedName: "solo",
		});

		// 1. Errors on invalid org / festival
		await expect(
			orgService.listFestivalClasses("invalid-org", "pf2026"),
		).rejects.toThrow("Organization not found.");
		await expect(
			orgService.listFestivalClasses("pafe-org", "invalid-fest"),
		).rejects.toThrow("Festival not found.");

		// 2. Errors on invalid division / subtype during create
		await expect(
			orgService.createFestivalClass("pafe-org", "pf2026", {
				displayName: "Class A",
				classSubtypeId: subtype.id,
				divisionId: "non-existent-div",
				minimumAge: 5,
				maximumAge: 8,
				price: "30.00",
				maximumPerformancePieces: 1,
				performanceMinutes: 5,
				capacity: 10,
				shopifyProductGid: "gid://shopify/Product/1",
				shopifyVariantGid: "gid://shopify/ProductVariant/1",
			}),
		).rejects.toThrow("Division not found.");

		await expect(
			orgService.createFestivalClass("pafe-org", "pf2026", {
				displayName: "Class A",
				classSubtypeId: "non-existent-subtype",
				divisionId: division.id,
				minimumAge: 5,
				maximumAge: 8,
				price: "30.00",
				maximumPerformancePieces: 1,
				performanceMinutes: 5,
				capacity: 10,
				shopifyProductGid: "gid://shopify/Product/1",
				shopifyVariantGid: "gid://shopify/ProductVariant/1",
			}),
		).rejects.toThrow("Class subtype not found.");

		// 3. Successfully creates a festival class
		const createdClass = await orgService.createFestivalClass(
			"pafe-org",
			"pf2026",
			{
				displayName: "Violin Solo Beginner",
				classSubtypeId: subtype.id,
				divisionId: division.id,
				minimumAge: 6,
				maximumAge: 10,
				price: "35.00",
				maximumPerformancePieces: 1,
				performanceMinutes: 5,
				capacity: 15,
				isActive: true,
				shopifyProductGid: "gid://shopify/Product/10",
				shopifyVariantGid: "gid://shopify/ProductVariant/10",
			},
		);

		expect(createdClass.id).toBeDefined();
		expect(createdClass.organizationId).toBe(org.id);
		expect(createdClass.festivalId).toBe(festival.id);
		expect(createdClass.displayName).toBe("Violin Solo Beginner");
		expect(createdClass.isActive).toBe(true);

		// 4. Lists classes for festival
		const list = await orgService.listFestivalClasses("pafe-org", "pf2026");
		expect(list.length).toBe(1);
		expect(list[0].id).toBe(createdClass.id);

		// 5. Updates festival class
		await expect(
			orgService.updateFestivalClass(
				"pafe-org",
				"pf2026",
				"non-existent-class",
				{
					displayName: "Updated Name",
				},
			),
		).rejects.toThrow("Festival class configuration not found.");

		await expect(
			orgService.updateFestivalClass("pafe-org", "pf2026", createdClass.id, {
				divisionId: "invalid-div",
			}),
		).rejects.toThrow("Division not found.");

		await expect(
			orgService.updateFestivalClass("pafe-org", "pf2026", createdClass.id, {
				classSubtypeId: "invalid-subtype",
			}),
		).rejects.toThrow("Class subtype not found.");

		const updated = await orgService.updateFestivalClass(
			"pafe-org",
			"pf2026",
			createdClass.id,
			{
				displayName: "Violin Solo Intermediate",
				price: "45.00",
				isActive: false,
			},
		);

		expect(updated.id).toBe(createdClass.id);
		expect(updated.displayName).toBe("Violin Solo Intermediate");
		expect(updated.price).toBe("45.00");
		expect(updated.isActive).toBe(false);
	});
});

describe("CustomerAccountService - Customer Class Registrations", () => {
	it("lists customer class registrations across festivals and filtered by festival", async () => {
		const f = await setupCustomerFixture();

		// Add a child for customer
		const session = await f.customerRepo.getSession(f.sessionId);
		if (!session) throw new Error("session missing");
		const customerId = session.customerId;

		const child = await f.customerRepo.createChild({
			organizationId: f.org.id,
			parentCustomerId: customerId,
			displayName: "Emma Watson",
		});

		// Create divisions and subtypes
		const division = await f.orgRepo.createDivision({
			organizationId: f.org.id,
			displayName: "Piano",
			normalizedName: "piano",
		});
		const subtype = await f.orgRepo.createRegistrationCatalogValue({
			organizationId: f.org.id,
			kind: "class_subtype",
			displayName: "Solo",
			normalizedName: "solo",
		});

		// Create festival class in festival 1
		const festClass1 = await f.orgRepo.createFestivalClassConfiguration({
			organizationId: f.org.id,
			festivalId: f.festival.id,
			displayName: "Piano Solo Level 1",
			classSubtypeId: subtype.id,
			divisionId: division.id,
			minimumAge: 5,
			maximumAge: 8,
			price: "30.00",
			maximumPerformancePieces: 1,
			performanceMinutes: 5,
			capacity: 10,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
		});

		// Create festival class in festival 2
		const festClass2 = await f.orgRepo.createFestivalClassConfiguration({
			organizationId: f.org.id,
			festivalId: f.festival2.id,
			displayName: "Piano Solo Level 2",
			classSubtypeId: subtype.id,
			divisionId: division.id,
			minimumAge: 8,
			maximumAge: 12,
			price: "35.00",
			maximumPerformancePieces: 2,
			performanceMinutes: 8,
			capacity: 10,
			shopifyProductGid: "gid://shopify/Product/2",
			shopifyVariantGid: "gid://shopify/ProductVariant/2",
		});

		// Create class entitlements
		const entitlement1 = await f.commerceRepo.createClassEntitlement({
			organizationId: f.org.id,
			festivalId: f.festival.id,
			festivalClassId: festClass1.id,
			parentCustomerId: customerId,
			childId: child.id,
			checkoutIntentId: "intent-1",
			shopifyOrderGid: "gid://shopify/Order/1",
			shopifyOrderLineGid: "gid://shopify/LineItem/1",
			paidAmountCents: 3000,
			paidCurrencyCode: "USD",
			status: "confirmed",
		});

		const entitlement2 = await f.commerceRepo.createClassEntitlement({
			organizationId: f.org.id,
			festivalId: f.festival2.id,
			festivalClassId: festClass2.id,
			parentCustomerId: customerId,
			childId: child.id,
			checkoutIntentId: "intent-2",
			shopifyOrderGid: "gid://shopify/Order/2",
			shopifyOrderLineGid: "gid://shopify/LineItem/2",
			paidAmountCents: 3500,
			paidCurrencyCode: "USD",
			status: "confirmed",
		});

		// Create registration metadata for intent 1 and link it
		const meta1 = await f.checkoutRepo.insertRegistrationMetadata({
			id: "reg-meta-1",
			organizationId: f.org.id,
			festivalId: f.festival.id,
			checkoutIntentId: "intent-1",
			teacherMembershipId: "teacher-1",
			accompanistMembershipId: null,
			repertoireJson: [
				{
					title: "Minuet in G",
					composer: "Bach",
					durationSeconds: 120,
				},
			],
		});
		await f.checkoutRepo.linkRegistrationMetadataToEntitlement({
			checkoutIntentId: "intent-1",
			classEntitlementId: entitlement1.id,
		});

		// 1. Invalid session throws 401
		await expect(
			f.service.listClassRegistrations(f.org.slug, "invalid-session-token"),
		).rejects.toThrow("Customer session is invalid.");

		// 2. Non-existent festival throws 404
		await expect(
			f.service.listClassRegistrations(
				f.org.slug,
				f.sessionId,
				"non-existent-fest",
			),
		).rejects.toThrow("Festival not found.");

		// 3. List all registrations across festivals (no festivalShortName)
		const allRegistrations = await f.service.listClassRegistrations(
			f.org.slug,
			f.sessionId,
		);
		expect(allRegistrations.registrations.length).toBe(2);

		const reg1 = allRegistrations.registrations.find(
			(r) => r.entitlement.id === entitlement1.id,
		);
		expect(reg1).toBeDefined();
		expect(reg1?.festivalClass?.id).toBe(festClass1.id);
		expect(reg1?.festivalClass?.displayName).toBe("Piano Solo Level 1");
		expect(reg1?.child?.id).toBe(child.id);
		expect(reg1?.child?.name).toBe("Emma Watson");
		expect(reg1?.metadata?.id).toBe(meta1.id);
		expect(reg1?.metadata?.repertoireJson[0].title).toBe("Minuet in G");

		const reg2 = allRegistrations.registrations.find(
			(r) => r.entitlement.id === entitlement2.id,
		);
		expect(reg2).toBeDefined();
		expect(reg2?.festivalClass?.id).toBe(festClass2.id);
		expect(reg2?.festivalClass?.displayName).toBe("Piano Solo Level 2");
		expect(reg2?.child?.id).toBe(child.id);
		expect(reg2?.child?.name).toBe("Emma Watson");
		expect(reg2?.metadata).toBeNull(); // No metadata linked for intent 2

		// 4. List registrations filtered by festival 1
		const fest1Registrations = await f.service.listClassRegistrations(
			f.org.slug,
			f.sessionId,
			"fest2026",
		);
		expect(fest1Registrations.registrations.length).toBe(1);
		expect(fest1Registrations.registrations[0].entitlement.id).toBe(
			entitlement1.id,
		);

		// 5. List registrations filtered by festival 2
		const fest2Registrations = await f.service.listClassRegistrations(
			f.org.slug,
			f.sessionId,
			"fest2027",
		);
		expect(fest2Registrations.registrations.length).toBe(1);
		expect(fest2Registrations.registrations[0].entitlement.id).toBe(
			entitlement2.id,
		);
	});

	it("throws 500 when commerce or checkout repository is missing", async () => {
		const f = await setupCustomerFixture();
		const serviceWithoutCommerce = new CustomerAccountService(
			f.customerRepo,
			f.orgRepo,
			(f.service as unknown as { keyring: ShopifySecretKeyring }).keyring,
			{
				publicOrigin: "https://festival.example.com",
			},
		);

		await expect(
			serviceWithoutCommerce.listClassRegistrations(f.org.slug, f.sessionId),
		).rejects.toThrow("Commerce or checkout repository is not configured.");
	});
});
