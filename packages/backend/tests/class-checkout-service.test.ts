import { describe, expect, it } from "bun:test";
import type {
	AccompanistMembershipGrant,
	EntitlementGrantSnapshot,
	FestivalRecord,
	RepertoirePiece,
} from "@festival/common";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";
import {
	ClassCheckoutService,
	type ClassCheckoutStorefront,
	type StartClassCheckoutInput,
} from "../src/checkout/class-checkout-service.js";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";

interface FixtureOptions {
	now?: Date;
	classMinAge?: number;
	classMaxAge?: number;
	childAge?: number;
	isClassActive?: boolean;
	snapshotValidDays?: number;
	snapshotCreatedDaysAgo?: number;
	isPrimaryFestival?: boolean;
	maximumPerformancePieces?: number;
	performanceMinutes?: number;
	storeDomain?: string;
	mockStorefront?: Partial<ClassCheckoutStorefront>;
}

async function createFixture(options: FixtureOptions = {}) {
	const now = options.now ?? new Date("2026-09-21T12:00:00.000Z");
	const nowFn = () => now;

	const organizations = new InMemoryOrganizationRepository();
	const customers = new InMemoryCustomerAccountRepository();
	const checkout = new InMemoryCheckoutRepository();

	const organization = await organizations.createOrganization({
		name: "Pacific Northwest Music Festival",
		slug: "pnw-festival",
	});

	const division = await organizations.createDivision({
		organizationId: organization.id,
		displayName: "Junior Piano",
		normalizedName: "junior piano",
	});

	const storeDomain = options.storeDomain ?? "festival.myshopify.com";
	await organizations.upsertShopifyIntegration({
		organizationId: organization.id,
		storeDomain,
		clientId: "client-id",
		encryptedClientSecret: "encrypted-secret",
	});

	const subtype = await organizations.createRegistrationCatalogValue({
		organizationId: organization.id,
		kind: "class_subtype",
		displayName: "Solo Piano",
		normalizedName: "solo piano",
	});

	let festival: FestivalRecord | undefined;
	let classConfig: {
		id: string;
		divisionId?: string;
		maximumPerformancePieces: number;
		performanceMinutes: number;
	} = {
		id: "dummy-class-id",
		maximumPerformancePieces: options.maximumPerformancePieces ?? 2,
		performanceMinutes: options.performanceMinutes ?? 10,
	};

	if (options.isPrimaryFestival !== false) {
		festival = await organizations.createFestival({
			id: "fest-2026",
			organizationId: organization.id,
			code: "PNW2026",
			shortName: "pnw2026",
			name: "PNW Festival 2026",
			startDate: "2026-11-01",
			endDate: "2026-11-10",
		});
		await organizations.setPrimaryFestival(organization.id, festival.id);

		classConfig = await organizations.createFestivalClassConfiguration({
			organizationId: organization.id,
			festivalId: festival.id,
			displayName: "Junior Solo Piano Level 1",
			classSubtypeId: subtype.id,
			divisionId: division.id,
			minimumAge: options.classMinAge ?? 8,
			maximumAge: options.classMaxAge ?? 12,
			price: "45.00",
			maximumPerformancePieces: options.maximumPerformancePieces ?? 2,
			performanceMinutes: options.performanceMinutes ?? 10,
			capacity: 25,
			isActive: options.isClassActive !== false,
			shopifyProductGid: "gid://shopify/Product/100",
			shopifyVariantGid: "gid://shopify/ProductVariant/200",
		});
	}

	const { customer, session } = await customers.createCustomerSession({
		sessionId: "session-test-parent-1",
		organizationId: organization.id,
		shopifyCustomerGid: "gid://shopify/Customer/999",
		encryptedTokens: "encrypted-token-test",
		csrfToken: "csrf-token-12345",
		integrationVersion: 1,
		createdAtIso: now.toISOString(),
		lastSeenAtIso: now.toISOString(),
		expiresAtIso: new Date(now.getTime() + 8 * 3600_000).toISOString(),
	});

	const child = await customers.createChild({
		organizationId: organization.id,
		parentCustomerId: customer.id,
		displayName: "Alice Smith",
	});

	const snapshotCreatedDaysAgo = options.snapshotCreatedDaysAgo ?? 0;
	const snapshotCreatedAt = new Date(
		now.getTime() - snapshotCreatedDaysAgo * 24 * 3600_000,
	);
	const snapshotValidDays = options.snapshotValidDays ?? 90;
	const validUntilIso = new Date(
		snapshotCreatedAt.getTime() + snapshotValidDays * 24 * 3600_000,
	).toISOString();

	if (options.childAge !== undefined || options.snapshotValidDays !== 0) {
		await customers.createChildAgeSnapshot({
			organizationId: organization.id,
			childId: child.id,
			age: options.childAge ?? 10,
			validUntilIso,
			createdAtIso: snapshotCreatedAt.toISOString(),
		});
	}

	const teacherOffering = await organizations.createMembershipProductRecord({
		organizationId: organization.id,
		entitlementClass: "teacher_membership",
		durationDays: 365,
		isActive: true,
		shopifyProductGid: "gid://shopify/Product/1",
		shopifyVariantGid: "gid://shopify/ProductVariant/1",
		productNameSnapshot: "Teacher Membership",
	});

	const teacherId = "teacher-customer-1";
	const teacherEntitlement: EntitlementGrantSnapshot =
		await organizations.createEntitlementGrantSnapshot({
			organizationId: organization.id,
			customerId: teacherId,
			entitlementClass: "teacher_membership",
			offeringId: teacherOffering.id,
			durationDays: 365,
			divisionId: division.id,
			divisionNameSnapshot: division.displayName,
			paidAmount: "50.00",
			paidCurrencyCode: "USD",
			checkoutIntentId: "teacher-intent-1",
			shopifyOrderGid: "gid://shopify/Order/teacher",
			shopifyOrderLineGid: "gid://shopify/LineItem/teacher",
			startsOn: "2026-01-01",
			endsOn: "2027-01-01",
			status: "active",
			verifiedIdentityEmail: "teacher@example.com",
		});

	const accompanistId = "accompanist-customer-1";
	const accompanistGrant: AccompanistMembershipGrant =
		await organizations.createAccompanistMembershipGrant({
			organizationId: organization.id,
			customerId: accompanistId,
			normalizedEmail: "accompanist@example.com",
			offeringNameSnapshot: "Accompanist Membership",
			source: "accompanist_form",
			contact: {
				name: "Sam Accompanist",
				email: "accompanist@example.com",
				city: "Seattle",
				phone: "555-555-5555",
			},
			divisions: [
				{ divisionId: division.id, divisionName: division.displayName },
			],
			startsOn: "2026-01-01",
			endsOn: "2027-01-01",
		});

	const storefront: ClassCheckoutStorefront = {
		createCart: async () => ({
			shopifyCartId: "gid://shopify/Cart/test-cart-1",
		}),
		checkout: async () => ({
			checkoutUrl: `https://${storeDomain}/checkouts/c123`,
		}),
		...options.mockStorefront,
	};

	const service = new ClassCheckoutService(
		organizations,
		customers,
		checkout,
		storefront,
		undefined,
		nowFn,
	);

	const defaultPieces: RepertoirePiece[] = [
		{
			title: "Sonatina in C Major, Op. 36 No. 1",
			composer: "Muzio Clementi",
			durationSeconds: 150,
		},
	];

	const defaultInput: StartClassCheckoutInput = {
		organizationId: organization.id,
		customerId: customer.id,
		sessionId: session.sessionId,
		idempotencyKey: "11111111-2222-3333-4444-555555555555",
		festivalClassId: classConfig.id,
		childId: child.id,
		buyerAccessToken: "buyer-token-test",
		teacherId,
		pieces: defaultPieces,
		currency: "USD",
	};

	return {
		organizations,
		customers,
		checkout,
		organization,
		division,
		festival,
		classConfig,
		customer,
		session,
		child,
		teacherId,
		teacherEntitlement,
		accompanistId,
		accompanistGrant,
		storefront,
		storeDomain,
		service,
		defaultPieces,
		defaultInput,
		now,
	};
}

describe("ClassCheckoutService", () => {
	it("successfully creates a checkout intent for a valid parent and eligible child", async () => {
		const f = await createFixture({
			classMinAge: 8,
			classMaxAge: 12,
			childAge: 10,
		});

		const result = await f.service.start(f.defaultInput);

		expect(result).toBeDefined();
		expect(result.correlationId).toBeDefined();
		expect(result.intentId).toBeDefined();
		expect(result.checkoutUrl).toBe(`https://${f.storeDomain}/checkouts/c123`);

		// Stored in checkout repository and findable by correlationId
		const stored = await f.checkout.findIntentByCorrelation(
			f.organization.id,
			result.correlationId,
		);
		expect(stored).toBeDefined();
		expect(stored?.id).toBe(result.intentId);
		expect(stored?.intentType).toBe("class_entry");
		expect(stored?.festivalClassId).toBe(f.classConfig.id);
		expect(stored?.childId).toBe(f.child.id);
		expect(stored?.shopifyProductGid).toBe("gid://shopify/Product/100");
		expect(stored?.shopifyVariantGid).toBe("gid://shopify/ProductVariant/200");
		expect(stored?.amount).toBe("45.00");
		expect(stored?.currencyCode).toBe("USD");
		expect(stored?.organizationId).toBe(f.organization.id);
		expect(stored?.customerId).toBe(f.customer.id);
		expect(stored?.status).toBe("checkout_started");

		// Registration metadata record inserted
		const metadata = (
			f.checkout as unknown as {
				registrationMetadata: Map<
					string,
					{
						teacherMembershipId: string;
						accompanistMembershipId: string | null;
						repertoireJson: RepertoirePiece[];
					}
				>;
			}
		).registrationMetadata.get(result.intentId);
		expect(metadata).toBeDefined();
		expect(metadata?.teacherMembershipId).toBe(f.teacherEntitlement.id);
		expect(metadata?.accompanistMembershipId).toBeNull();
		expect(metadata?.repertoireJson).toEqual(f.defaultPieces);
	});

	it("handles exact boundary ages for minimum_age and maximum_age", async () => {
		// Minimum age boundary
		const fMin = await createFixture({
			classMinAge: 8,
			classMaxAge: 12,
			childAge: 8,
		});
		const resultMin = await fMin.service.start(fMin.defaultInput);
		expect(resultMin.intentId).toBeDefined();

		// Maximum age boundary
		const fMax = await createFixture({
			classMinAge: 8,
			classMaxAge: 12,
			childAge: 12,
		});
		const resultMax = await fMax.service.start({
			...fMax.defaultInput,
			idempotencyKey: "boundary-max-idempotency",
		});
		expect(resultMax.intentId).toBeDefined();
	});

	it("fails when customer session is invalid or revoked", async () => {
		const f = await createFixture();

		// Invalid session ID
		await expect(
			f.service.start({
				...f.defaultInput,
				sessionId: "non-existent-session",
			}),
		).rejects.toMatchObject({
			status: 401,
		});

		// Revoked session
		await f.customers.revokeSession(f.session.sessionId, f.now.toISOString());
		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			status: 401,
		});
	});

	it("fails when customer session is expired", async () => {
		const now = new Date("2026-09-21T12:00:00.000Z");
		const f = await createFixture({ now });

		// Fast forward 10 hours beyond session expiry
		const laterNow = new Date(now.getTime() + 10 * 3600_000);
		const laterService = new ClassCheckoutService(
			f.organizations,
			f.customers,
			f.checkout,
			f.storefront,
			undefined,
			() => laterNow,
		);

		await expect(laterService.start(f.defaultInput)).rejects.toMatchObject({
			status: 401,
		});
	});

	it("fails when child does not belong to parent customer", async () => {
		const f = await createFixture();

		// Create another parent customer and child
		const { customer: otherParent } = await f.customers.createCustomerSession({
			sessionId: "session-other-parent",
			organizationId: f.organization.id,
			shopifyCustomerGid: "gid://shopify/Customer/888",
			encryptedTokens: "encrypted",
			csrfToken: "csrf",
			integrationVersion: 1,
			createdAtIso: f.now.toISOString(),
			lastSeenAtIso: f.now.toISOString(),
			expiresAtIso: new Date(f.now.getTime() + 3600_000).toISOString(),
		});

		const otherChild = await f.customers.createChild({
			organizationId: f.organization.id,
			parentCustomerId: otherParent.id,
			displayName: "Bob Jones",
		});

		// Attempting to register otherParent's child with parent 1 session
		await expect(
			f.service.start({
				...f.defaultInput,
				childId: otherChild.id,
			}),
		).rejects.toMatchObject({
			status: 404,
		});
	});

	it("fails when child has no age snapshot", async () => {
		const f = await createFixture({
			childAge: undefined,
			snapshotValidDays: 0,
		});

		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			status: 400,
		});
	});

	it("fails when child age snapshot is expired", async () => {
		const f = await createFixture({
			snapshotValidDays: -1,
		});

		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			status: 400,
		});
	});

	it("fails when child age snapshot exceeds 90 days validity window", async () => {
		const f = await createFixture({
			snapshotCreatedDaysAgo: 95,
			snapshotValidDays: 120,
		});

		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			status: 400,
		});
	});

	it("fails when child age is below minimum age requirement", async () => {
		const f = await createFixture({
			classMinAge: 8,
			classMaxAge: 12,
			childAge: 7,
		});

		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			status: 400,
		});
	});

	it("fails when child age exceeds maximum age requirement", async () => {
		const f = await createFixture({
			classMinAge: 8,
			classMaxAge: 12,
			childAge: 13,
		});

		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			status: 400,
		});
	});

	it("fails when festival class configuration is inactive", async () => {
		const f = await createFixture({
			isClassActive: false,
		});

		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			status: 400,
		});
	});

	it("fails when festival class configuration does not exist", async () => {
		const f = await createFixture();

		await expect(
			f.service.start({
				...f.defaultInput,
				festivalClassId: "non-existent-class-id",
			}),
		).rejects.toMatchObject({
			status: 404,
		});
	});

	it("fails when active festival is not configured", async () => {
		const f = await createFixture({
			isPrimaryFestival: false,
		});

		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			status: 404,
		});
	});

	it("successfully checks out with explicit festivalShortName", async () => {
		const f = await createFixture();

		const result = await f.service.start({
			...f.defaultInput,
			festivalShortName: "pnw2026",
		});

		expect(result.checkoutUrl).toBeDefined();
	});

	it("successfully checks out with explicit festivalId for non-primary festival", async () => {
		const f = await createFixture();

		const secondFest = await f.organizations.createFestival({
			id: "fest-secondary",
			organizationId: f.organization.id,
			code: "PNW2027",
			shortName: "pnw2027",
			name: "PNW Festival 2027",
			startDate: "2027-11-01",
			endDate: "2027-11-10",
		});

		const subtype = await f.organizations.createRegistrationCatalogValue({
			organizationId: f.organization.id,
			kind: "class_subtype",
			displayName: "Solo Strings",
			normalizedName: "solo strings",
		});

		const secondClass = await f.organizations.createFestivalClassConfiguration({
			organizationId: f.organization.id,
			festivalId: secondFest.id,
			displayName: "Junior Solo Violin",
			classSubtypeId: subtype.id,
			divisionId: f.division.id,
			minimumAge: 8,
			maximumAge: 12,
			price: "50.00",
			maximumPerformancePieces: 2,
			performanceMinutes: 10,
		});

		const result = await f.service.start({
			...f.defaultInput,
			idempotencyKey: "22222222-3333-4444-5555-666666666666",
			festivalId: secondFest.id,
			festivalClassId: secondClass.id,
		});

		expect(result.checkoutUrl).toBeDefined();
	});

	it("fails when explicit festivalId does not exist", async () => {
		const f = await createFixture();

		await expect(
			f.service.start({
				...f.defaultInput,
				festivalId: "non-existent-festival-id",
			}),
		).rejects.toMatchObject({
			status: 404,
		});
	});

	it("fails when class configuration does not belong to specified festival", async () => {
		const f = await createFixture();

		const otherFest = await f.organizations.createFestival({
			id: "fest-other",
			organizationId: f.organization.id,
			code: "PNWOTHER",
			shortName: "pnwother",
			name: "PNW Other 2026",
			startDate: "2026-11-01",
			endDate: "2026-11-10",
		});

		await expect(
			f.service.start({
				...f.defaultInput,
				festivalId: otherFest.id,
				festivalClassId: f.classConfig.id,
			}),
		).rejects.toMatchObject({
			status: 400,
		});
	});

	it("verifies that providing a divisionId matching classConfig.divisionId succeeds", async () => {
		const f = await createFixture();

		const result = await f.service.start({
			...f.defaultInput,
			divisionId: f.division.id,
		});

		expect(result.checkoutUrl).toBeDefined();
		expect(result.intentId).toBeDefined();
	});

	it("verifies that providing a mismatched divisionId throws 400 'Selected class does not belong to the requested division.'", async () => {
		const f = await createFixture();

		await expect(
			f.service.start({
				...f.defaultInput,
				divisionId: "mismatched-division-id",
			}),
		).rejects.toMatchObject({
			status: 400,
			message: "Selected class does not belong to the requested division.",
		});
	});

	it("prevents multiple concurrent checkouts in progress", async () => {
		const f = await createFixture();

		// Start first checkout
		await f.service.start(f.defaultInput);

		// Attempting another checkout with a different idempotency key while the first is in progress
		await expect(
			f.service.start({
				...f.defaultInput,
				idempotencyKey: "99999999-8888-7777-6666-555555555555",
			}),
		).rejects.toMatchObject({
			status: 409,
			code: "checkout_in_progress",
		});
	});

	it("fails when repertoire piece count exceeds maximumPerformancePieces", async () => {
		const f = await createFixture({
			maximumPerformancePieces: 2,
		});

		const threePieces: RepertoirePiece[] = [
			{ title: "Piece 1", composer: "Composer 1", durationSeconds: 60 },
			{ title: "Piece 2", composer: "Composer 2", durationSeconds: 60 },
			{ title: "Piece 3", composer: "Composer 3", durationSeconds: 60 },
		];

		await expect(
			f.service.start({
				...f.defaultInput,
				pieces: threePieces,
			}),
		).rejects.toMatchObject({
			status: 400,
		});
	});

	it("fails when repertoire total duration exceeds performanceMinutes", async () => {
		const f = await createFixture({
			performanceMinutes: 5, // 300 seconds max
			maximumPerformancePieces: 3,
		});

		const longPieces: RepertoirePiece[] = [
			{ title: "Piece 1", composer: "Composer 1", durationSeconds: 200 },
			{
				title: "Piece 2",
				composer: "Composer 2",
				durationSeconds: 150,
			}, // 350s = 5.83 mins > 5 mins
		];

		await expect(
			f.service.start({
				...f.defaultInput,
				pieces: longPieces,
			}),
		).rejects.toMatchObject({
			status: 400,
		});
	});

	it("rejects a repertoire piece without a composer before persistence", async () => {
		const f = await createFixture();
		await expect(
			f.service.start({
				...f.defaultInput,
				pieces: [{ title: "Untitled", composer: "   ", durationSeconds: 60 }],
			}),
		).rejects.toMatchObject({
			status: 400,
			message: "Each repertoire piece must have a valid composer.",
		});
	});

	it("rejects a repertoire piece with a non-string movement before persistence", async () => {
		const f = await createFixture();
		await expect(
			f.service.start({
				...f.defaultInput,
				pieces: [
					{
						title: "Untitled",
						composer: "Composer",
						movement: 42 as never,
						durationSeconds: 60,
					},
				],
			}),
		).rejects.toMatchObject({
			status: 400,
			message: "Each repertoire piece must have a valid movement.",
		});
		expect(
			await f.checkout.getOutcome({
				organizationId: f.organization.id,
				customerId: f.customer.id,
				sessionId: f.session.sessionId,
				idempotencyKey: f.defaultInput.idempotencyKey,
			}),
		).toBeNull();
	});

	it("accepts null movement and normalizes repertoire snapshot text", async () => {
		const f = await createFixture();
		const result = await f.service.start({
			...f.defaultInput,
			pieces: [
				{
					title: "  Sonata in C  ",
					composer: "  Wolfgang Amadeus Mozart  ",
					movement: null as never,
					durationSeconds: 240,
				},
			],
		});
		const metadata = (
			f.checkout as unknown as {
				registrationMetadata: Map<
					string,
					{
						repertoireJson: RepertoirePiece[];
						repertoireItems: Array<{
							titleSnapshot: string;
							performedMovementText: string | null;
							contributors: Array<{ displayNameSnapshot: string }>;
						}>;
					}
				>;
			}
		).registrationMetadata.get(result.intentId);

		expect(metadata?.repertoireJson).toEqual([
			{
				title: "  Sonata in C  ",
				composer: "  Wolfgang Amadeus Mozart  ",
				movement: null,
				durationSeconds: 240,
			},
		]);
		expect(metadata?.repertoireItems[0]).toMatchObject({
			titleSnapshot: "Sonata in C",
			performedMovementText: null,
			contributors: [{ displayNameSnapshot: "Wolfgang Amadeus Mozart" }],
		});
	});

	it.each([
		["a fractional duration", 1.5],
		["zero duration", 0],
		["a negative duration", -1],
		["NaN duration", Number.NaN],
		["an infinite duration", Number.POSITIVE_INFINITY],
		["a duration above the PostgreSQL INTEGER limit", 2_147_483_648],
		["an unsafe integer duration", Number.MAX_SAFE_INTEGER + 1],
	])("rejects %s before persistence", async (_description, durationSeconds) => {
		const f = await createFixture();

		await expect(
			f.service.start({
				...f.defaultInput,
				pieces: [
					{
						title: "Invalid duration piece",
						composer: "Composer",
						durationSeconds,
					},
				],
			}),
		).rejects.toMatchObject({
			status: 400,
			message:
				"Each repertoire piece must have a positive whole-number duration in seconds.",
		});
	});

	it("fails when teacherId is invalid or inactive", async () => {
		const f = await createFixture();

		// Unknown teacher ID
		await expect(
			f.service.start({
				...f.defaultInput,
				teacherId: "unknown-teacher-id",
			}),
		).rejects.toMatchObject({
			status: 400,
		});

		// Revoked teacher entitlement
		await f.organizations.revokeEntitlement({
			organizationId: f.organization.id,
			entitlementId: f.teacherEntitlement.id,
			actorUserId: "admin",
			reason: "Test revocation",
			revokedAtIso: f.now.toISOString(),
		});

		await expect(
			f.service.start({
				...f.defaultInput,
				idempotencyKey: "after-revoke-key",
			}),
		).rejects.toMatchObject({
			status: 400,
		});
	});

	it("fails when accompanistId is invalid or inactive", async () => {
		const f = await createFixture();

		// Unknown accompanist ID
		await expect(
			f.service.start({
				...f.defaultInput,
				accompanistId: "unknown-accompanist-id",
			}),
		).rejects.toMatchObject({
			status: 400,
		});

		// Revoked accompanist entitlement
		await f.organizations.revokeEntitlement({
			organizationId: f.organization.id,
			entitlementId: f.accompanistGrant.id,
			actorUserId: "admin",
			reason: "Test revocation",
			revokedAtIso: f.now.toISOString(),
		});

		await expect(
			f.service.start({
				...f.defaultInput,
				accompanistId: f.accompanistId,
				idempotencyKey: "accompanist-revoked-key",
			}),
		).rejects.toMatchObject({
			status: 400,
		});
	});

	it("successfully checks out with optional accompanistId and records metadata", async () => {
		const f = await createFixture();

		const result = await f.service.start({
			...f.defaultInput,
			accompanistId: f.accompanistId,
		});

		expect(result).toBeDefined();
		expect(result.checkoutUrl).toBe(`https://${f.storeDomain}/checkouts/c123`);
		expect(result.intentId).toBeDefined();

		const metadata = (
			f.checkout as unknown as {
				registrationMetadata: Map<
					string,
					{
						teacherMembershipId: string;
						accompanistMembershipId: string | null;
						repertoireJson: RepertoirePiece[];
					}
				>;
			}
		).registrationMetadata.get(result.intentId);
		expect(metadata).toBeDefined();
		expect(metadata?.teacherMembershipId).toBe(f.teacherEntitlement.id);
		expect(metadata?.accompanistMembershipId).toBe(f.accompanistGrant.id);
		expect(metadata?.repertoireJson).toEqual(f.defaultPieces);
	});

	it("triggers markFailed compensation and throws 503 on upstream storefront failure", async () => {
		const f = await createFixture({
			mockStorefront: {
				checkout: async () => {
					throw new Error("Storefront unavailable");
				},
			},
		});

		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			status: 503,
			code: "checkout_retryable_upstream",
		});

		// Intent should be marked failed in repository
		const intents = (
			f.checkout as unknown as {
				intents: Map<string, { status: string }>;
			}
		).intents;
		const createdIntent = [...intents.values()][0];
		expect(createdIntent).toBeDefined();
		expect(createdIntent?.status).toBe("failed");
	});

	it("triggers markFailed compensation and throws 503 on disallowed checkout URL domain", async () => {
		const f = await createFixture({
			mockStorefront: {
				checkout: async () => ({
					checkoutUrl: "https://evil-phishing-domain.com/checkout",
				}),
			},
		});

		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			status: 503,
			code: "checkout_retryable_upstream",
		});

		// Intent should be marked failed in repository
		const intents = (
			f.checkout as unknown as {
				intents: Map<string, { status: string }>;
			}
		).intents;
		const createdIntent = [...intents.values()][0];
		expect(createdIntent).toBeDefined();
		expect(createdIntent?.status).toBe("failed");
	});
});
