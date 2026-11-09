import { describe, expect, it, mock, spyOn } from "bun:test";
import type {
	AccompanistMembershipGrant,
	ClassRegistrationMetadata,
	EntitlementGrantSnapshot,
	FestivalRecord,
	RepertoirePiece,
} from "@festival/common";
import {
	CHECKOUT_INTENT_LINE_ID_ATTRIBUTE_KEY,
	type ExpectedClassCheckoutIntentLine,
	requireClassCheckoutIntentLineMapping,
} from "../src/checkout/checkout-line-helpers.js";
import {
	type CheckoutIntentLineItemRecord,
	type CheckoutIntentRecord,
	CLASS_CHECKOUT_LINE_IDENTITY_PROTOCOL,
	InMemoryCheckoutRepository,
} from "../src/checkout/checkout-repository.js";
import {
	ClassCheckoutCartObservationError,
	type ClassCheckoutFailureLogger,
	ClassCheckoutRecoveryRequiredError,
	ClassCheckoutService,
	type ClassCheckoutStorefront,
	ClassCheckoutStorefrontChangedBeforeRequestError,
	type StartClassCheckoutInput,
} from "../src/checkout/class-checkout-service.js";
import { InMemoryMembershipCommerceRepository } from "../src/commerce/membership-commerce-repository.js";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";
import { AppError } from "../src/errors/app-error.js";
import { InMemoryRepertoireRepository } from "../src/repertoire/index.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";

interface FixtureOptions {
	legacyCheckout?: boolean;
	customerAccountIntegrationVersion?: number;
	now?: Date;
	classMinAge?: number;
	classMaxAge?: number;
	childAge?: number;
	isClassActive?: boolean;
	snapshotValidDays?: number;
	snapshotCreatedDaysAgo?: number;
	isPrimaryFestival?: boolean;
	registrationOpensAt?: string | null;
	registrationClosesAt?: string | null;
	maximumPerformancePieces?: number;
	performanceMinutes?: number;
	storeDomain?: string;
	mockStorefront?: Partial<ClassCheckoutStorefront>;
	defaultCurrencyCode?: string;
	commerce?: InMemoryMembershipCommerceRepository;
	failureLogger?: ClassCheckoutFailureLogger;
}

class CapturingClassCheckoutFailureLogger
	implements ClassCheckoutFailureLogger
{
	readonly entries: Array<{
		message: string;
		context: Parameters<ClassCheckoutFailureLogger["error"]>[1];
	}> = [];

	error(
		message: string,
		context: Parameters<ClassCheckoutFailureLogger["error"]>[1],
	): void {
		this.entries.push({ message, context });
	}
}

function required<T>(value: T | null | undefined): T {
	if (value === null || value === undefined)
		throw new Error("Expected persisted checkout test evidence.");
	return value;
}

async function createFixture(options: FixtureOptions = {}) {
	const now = options.now ?? new Date("2026-09-21T12:00:00.000Z");
	const nowFn = () => now;

	const organizations = new InMemoryOrganizationRepository(nowFn);
	const customers = new InMemoryCustomerAccountRepository();
	const checkout = new InMemoryCheckoutRepository(nowFn);

	const organization = await organizations.createOrganization({
		name: "Pacific Northwest Music Festival",
		slug: "pnw-festival",
		defaultCurrencyCode: options.defaultCurrencyCode,
	});

	const division = await organizations.createDivision({
		organizationId: organization.id,
		displayName: "Junior Piano",
		normalizedName: "junior piano",
	});

	const storeDomain = options.storeDomain ?? "festival.myshopify.com";
	const storefrontIntegration = await organizations.upsertShopifyIntegration({
		organizationId: organization.id,
		storeDomain,
		clientId: "client-id",
		encryptedClientSecret: "encrypted-secret",
		encryptedStorefrontPrivateToken: "encrypted-storefront-token",
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
			registrationOpensAt:
				options.registrationOpensAt !== undefined
					? options.registrationOpensAt
					: "2026-01-01T00:00:00.000Z",
			registrationClosesAt:
				options.registrationClosesAt !== undefined
					? options.registrationClosesAt
					: "2027-12-31T23:59:59.999Z",
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
		integrationVersion: options.customerAccountIntegrationVersion ?? 1,
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

	const commerce =
		options.commerce ?? new InMemoryMembershipCommerceRepository();
	const repertoire = new InMemoryRepertoireRepository();

	const service = new (
		ClassCheckoutService as unknown as new (
			...args: unknown[]
		) => ClassCheckoutService
	)(
		organizations,
		customers,
		options.legacyCheckout
			? new Proxy(checkout, {
					get(target, key) {
						if (key === "classExecutions") return undefined;
						const value = Reflect.get(target, key);
						return typeof value === "function" ? value.bind(target) : value;
					},
				})
			: checkout,
		storefront,
		commerce,
		nowFn,
		options.failureLogger,
		repertoire,
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
	};

	return {
		organizations,
		customers,
		checkout,
		commerce,
		repertoire,
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
		storefrontIntegration,
		service,
		defaultPieces,
		defaultInput,
		now,
	};
}

function omitLegacyStorefrontBinding(checkout: InMemoryCheckoutRepository) {
	const transition = checkout.classExecutions.transition.bind(
		checkout.classExecutions,
	);
	checkout.classExecutions.transition = (input) =>
		transition(
			input.checkpoint === "create_dispatched"
				? { ...input, storefrontBinding: undefined }
				: input,
		);
}

function cartEvidence(intent: CheckoutIntentRecord, customerGid: string) {
	return {
		correlationId: intent.correlationId,
		customerGid,
		lines: required(intent.lines).map((line) => ({
			intentLineId: line.id,
			variantGid: line.shopifyVariantGid,
			quantity: 1,
		})),
	};
}

describe("ClassCheckoutService", () => {
	for (const [accountVersion, storefrontVersion] of [
		[1, 2],
		[2, 1],
	] as const) {
		it(`binds Storefront version ${storefrontVersion} independently of Customer Account version ${accountVersion}`, async () => {
			const f = await createFixture({
				customerAccountIntegrationVersion: accountVersion,
			});
			if (storefrontVersion === 2) {
				await f.organizations.upsertShopifyIntegration({
					...f.storefrontIntegration,
					encryptedStorefrontPrivateToken: "rotated-storefront-token",
				});
			}
			const binding = {
				shopDomain: f.storeDomain,
				integrationVersion: storefrontVersion,
			};
			const checkout = spyOn(f.storefront, "checkout");
			f.storefront.createCart = async (input) => {
				const intent = required(
					await f.checkout.findIntentByKey(f.defaultInput),
				);
				expect(
					await f.checkout.classExecutions.get(f.organization.id, intent.id),
				).toMatchObject({
					checkpoint: "create_dispatched",
					storefrontBinding: binding,
				});
				expect(input.expectedStorefrontBinding).toEqual(binding);
				return { shopifyCartId: "gid://shopify/Cart/bound-cart" };
			};

			const result = await f.service.start({
				...f.defaultInput,
				integrationVersion: accountVersion,
			});
			expect(checkout).toHaveBeenCalledWith(
				expect.objectContaining({ expectedStorefrontBinding: binding }),
			);
			expect(
				await f.checkout.classExecutions.get(
					f.organization.id,
					result.intentId,
				),
			).toMatchObject({ checkpoint: "attached", storefrontBinding: binding });
		});
	}

	it("retries after the adapter proves a Storefront rotation prevented dispatch", async () => {
		const f = await createFixture();
		const create = spyOn(f.storefront, "createCart");
		create.mockImplementationOnce(async () => {
			await f.organizations.upsertShopifyIntegration({
				...f.storefrontIntegration,
				encryptedStorefrontPrivateToken: "rotated-storefront-token",
			});
			throw new ClassCheckoutStorefrontChangedBeforeRequestError();
		});
		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			code: "checkout_retryable_upstream",
		});
		const intent = required(await f.checkout.findIntentByKey(f.defaultInput));
		expect(
			await f.checkout.classExecutions.get(f.organization.id, intent.id),
		).toMatchObject({
			checkpoint: "prepared",
			state: "retryable",
			storefrontBinding: null,
			leaseOwner: null,
		});
		await expect(f.service.start(f.defaultInput)).resolves.toMatchObject({
			intentId: intent.id,
		});
		expect(create).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				expectedStorefrontBinding: {
					shopDomain: f.storeDomain,
					integrationVersion: 2,
				},
			}),
		);
	});

	it("keeps a legacy dispatched checkout with unknown outcome from creating another cart", async () => {
		const f = await createFixture({
			mockStorefront: {
				createCart: async () => {
					throw new AppError(
						"Adapter could not prove no dispatch",
						503,
						"checkout_storefront_binding_changed",
					);
				},
			},
		});
		omitLegacyStorefrontBinding(f.checkout);
		const create = spyOn(f.storefront, "createCart");
		const unknownCreation = {
			code: "checkout_recovery_required",
			recovery: {
				reasonCode: "checkout_creation_unknown",
				retryAllowed: false,
			},
		};
		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject(
			unknownCreation,
		);
		const intent = required(await f.checkout.findIntentByKey(f.defaultInput));
		expect(
			await f.checkout.classExecutions.get(f.organization.id, intent.id),
		).toMatchObject({
			checkpoint: "create_dispatched",
			storefrontBinding: null,
		});
		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject(
			unknownCreation,
		);
		expect(create).toHaveBeenCalledTimes(1);
	});

	it("keeps an invalid Shopify cart unresumable if its recovery write fails", async () => {
		const f = await createFixture({
			mockStorefront: {
				createCart: async () => {
					throw new ClassCheckoutCartObservationError(
						"gid://shopify/Cart/invalid",
					);
				},
			},
		});
		const create = spyOn(f.storefront, "createCart");
		const checkout = spyOn(f.storefront, "checkout");
		const executions = f.checkout.classExecutions;
		const transition = executions.transition.bind(executions);
		const failRecoveryWrite = spyOn(
			executions,
			"transition",
		).mockImplementation(async (input) => {
			if (input.eventType === "invalid_remote_cart_observed")
				throw new Error("Recovery storage unavailable");
			return transition(input);
		});

		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			code: "checkout_persistence_unavailable",
		});
		const intent = required(await f.checkout.findIntentByKey(f.defaultInput));
		expect(await executions.get(f.organization.id, intent.id)).toMatchObject({
			checkpoint: "create_dispatched",
			shopifyCartId: null,
		});
		failRecoveryWrite.mockRestore();
		f.now.setTime(f.now.getTime() + 31_000);
		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			code: "checkout_recovery_required",
		});
		expect(create).toHaveBeenCalledTimes(1);
		expect(checkout).not.toHaveBeenCalled();
	});

	async function strandLegacyInvalidCart() {
		const f = await createFixture();
		const create = spyOn(f.storefront, "createCart").mockRejectedValueOnce(
			new ClassCheckoutCartObservationError(
				"gid://shopify/Cart/legacy-invalid",
			),
		);
		const checkout = spyOn(f.storefront, "checkout");
		const executions = f.checkout.classExecutions;
		const transition = executions.transition.bind(executions);
		const legacyWrite = spyOn(executions, "transition").mockImplementation(
			async (input) => {
				if (input.eventType === "create_dispatched")
					return transition({ ...input, storefrontBinding: undefined });
				if (input.eventType === "invalid_remote_cart_observed") {
					await transition({
						claim: input.claim,
						checkpoint: input.checkpoint,
						shopifyCartId: input.shopifyCartId,
						eventType: input.eventType,
					});
					throw new Error(
						"Worker interrupted before its separate recovery write",
					);
				}
				return transition(input);
			},
		);
		const submission = {
			...f.defaultInput,
			festivalShortName: required(f.festival).shortName,
		};
		await expect(f.service.start(submission)).rejects.toMatchObject({
			code: "checkout_persistence_unavailable",
		});
		legacyWrite.mockRestore();
		f.now.setTime(f.now.getTime() + 31_000);
		const intent = required(await f.checkout.findIntentByKey(submission));
		const execution = required(
			await executions.get(f.organization.id, intent.id),
		);
		const recovery = {
			organizationId: f.organization.id,
			customerId: f.customer.id,
			festivalShortName: submission.festivalShortName,
			recoveryReference: execution.recoveryReference,
		};
		return { ...f, create, handoff: checkout, intent, recovery, submission };
	}

	it("restores a legacy invalid submission and converges concurrent parent restarts", async () => {
		const f = await strandLegacyInvalidCart();
		await expect(f.service.start(f.submission)).rejects.toMatchObject({
			code: "checkout_recovery_required",
			recovery: { retryAllowed: false, restartAllowed: true },
		});
		expect(f.handoff).not.toHaveBeenCalled();
		await expect(
			f.service.findUnissuedCartRestart(f.recovery),
		).resolves.toEqual({
			recoveryReference: f.recovery.recoveryReference,
		});
		const [first, second] = await Promise.all([
			f.service.restartUnissuedCart(f.recovery),
			f.service.restartUnissuedCart(f.recovery),
		]);
		expect(first).toEqual(second);
		expect(first.replacementKey).not.toBe(f.submission.idempotencyKey);
		expect(first.registrations).toMatchObject([
			{
				childId: f.child.id,
				childName: f.child.displayName,
				classId: f.classConfig.id,
				teacherId: f.teacherId,
				priceCents: 4500,
				pieces: f.defaultPieces,
			},
		]);
		expect(f.create).toHaveBeenCalledTimes(1);
		const replacement = {
			...f.submission,
			idempotencyKey: first.replacementKey,
		};
		const starts = await Promise.allSettled([
			f.service.start(replacement),
			f.service.start(replacement),
		]);
		expect(starts.some((attempt) => attempt.status === "fulfilled")).toBe(true);
		await expect(f.service.start(replacement)).resolves.toMatchObject({
			checkoutUrl: `https://${f.storeDomain}/checkouts/c123`,
		});
		expect(f.create).toHaveBeenCalledTimes(2);
		await expect(f.service.start(f.submission)).rejects.toMatchObject({
			status: 409,
		});
	});

	it("keeps replacement blocked if payment evidence appears before restart", async () => {
		const f = await strandLegacyInvalidCart();
		await f.checkout.classExecutions.observePayment({
			organizationId: f.organization.id,
			intentId: f.intent.id,
			shopifyOrderGid: "gid://shopify/Order/unconfirmed",
			approved: false,
		});
		await expect(
			f.service.findUnissuedCartRestart(f.recovery),
		).resolves.toEqual({
			recoveryReference: null,
		});
		await expect(
			f.service.restartUnissuedCart(f.recovery),
		).rejects.toMatchObject({
			status: 409,
			code: "checkout_restart_unavailable",
		});
		expect(f.create).toHaveBeenCalledTimes(1);
		expect(f.handoff).not.toHaveBeenCalled();
	});

	it("withholds a replacement payment link when late payment evidence appears during handoff", async () => {
		const f = await strandLegacyInvalidCart();
		const { replacementKey } = await f.service.restartUnissuedCart(f.recovery);
		f.handoff.mockImplementationOnce(async () => {
			await f.checkout.classExecutions.observePayment({
				organizationId: f.organization.id,
				intentId: f.intent.id,
				shopifyOrderGid: "gid://shopify/Order/late",
				approved: false,
			});
			return { checkoutUrl: `https://${f.storeDomain}/checkouts/c123` };
		});
		const replacement = { ...f.submission, idempotencyKey: replacementKey };
		const blocked = { status: 409, code: "checkout_restart_payment_uncertain" };
		await expect(f.service.start(replacement)).rejects.toMatchObject(blocked);
		await expect(
			f.service.preflightRecovery(replacement),
		).rejects.toMatchObject(blocked);
		await expect(
			f.service.restartUnissuedCart(f.recovery),
		).rejects.toMatchObject({
			status: 409,
		});
		expect(f.create).toHaveBeenCalledTimes(2);
		expect(f.handoff).toHaveBeenCalledTimes(1);
	});

	it("resumes an invalid legacy cart after an operator verifies and adopts it", async () => {
		const f = await strandLegacyInvalidCart();
		const executions = f.checkout.classExecutions;
		await executions.reapExpired(f.organization.id, f.intent.id);
		const claim = {
			organizationId: f.organization.id,
			intentId: f.intent.id,
			owner: "worker",
		};
		const claimed = required(await executions.claim(claim));
		await executions.recordRecoveryRequired({
			claim: { ...claim, generation: claimed.generation },
			reason: "checkout_attachment_incomplete",
		});
		f.storefront.inspectCart = async () =>
			cartEvidence(f.intent, f.customer.shopifyCustomerGid);
		await f.service.resolveRecovery({
			organizationId: f.organization.id,
			recoveryReference: f.recovery.recoveryReference,
			expectedGeneration: claimed.generation,
			actorId: "admin",
			reason: "Verified the original Shopify cart",
			action: "adopt_cart",
		});
		await expect(
			f.service.preflightRecovery(f.submission),
		).resolves.toBeUndefined();
		await expect(f.service.start(f.submission)).resolves.toMatchObject({
			intentId: f.intent.id,
		});
		expect(f.create).toHaveBeenCalledTimes(1);
	});

	for (const matchingEvidence of [true, false]) {
		it(`${matchingEvidence ? "resumes" : "blocks"} a legacy attached cart based on its Shopify evidence`, async () => {
			const f = await createFixture();
			omitLegacyStorefrontBinding(f.checkout);
			const create = spyOn(f.storefront, "createCart");
			const result = await f.service.start(f.defaultInput);
			const intent = required(await f.checkout.findIntentByKey(f.defaultInput));
			expect(
				await f.checkout.classExecutions.get(f.organization.id, intent.id),
			).toMatchObject({ checkpoint: "attached", storefrontBinding: null });
			const evidence = cartEvidence(intent, f.customer.shopifyCustomerGid);
			if (!matchingEvidence) evidence.lines[0].quantity = 2;
			const inspect = mock(async () => evidence);
			f.storefront.inspectCart = inspect;
			const checkout = spyOn(f.storefront, "checkout");
			const replay = f.service.start(f.defaultInput);

			if (matchingEvidence) {
				await expect(replay).resolves.toMatchObject({
					intentId: intent.id,
					checkoutUrl: result.checkoutUrl,
				});
				expect(checkout).toHaveBeenCalledTimes(1);
				expect(
					await f.checkout.classExecutions.get(f.organization.id, intent.id),
				).toMatchObject({
					storefrontBinding: {
						shopDomain: f.storeDomain,
						integrationVersion: 1,
					},
				});
			} else {
				await expect(replay).rejects.toMatchObject({
					code: "checkout_recovery_required",
					recovery: { reasonCode: "checkout_storefront_verification_required" },
				});
				expect(checkout).not.toHaveBeenCalled();
			}
			expect(inspect).toHaveBeenCalledTimes(1);
			expect(create).toHaveBeenCalledTimes(1);
		});
	}

	it("retries a legacy cart after a temporary evidence lookup failure", async () => {
		const f = await createFixture();
		omitLegacyStorefrontBinding(f.checkout);
		const create = spyOn(f.storefront, "createCart");
		const first = await f.service.start(f.defaultInput);
		const intent = required(await f.checkout.findIntentByKey(f.defaultInput));
		f.storefront.inspectCart = async () =>
			cartEvidence(intent, f.customer.shopifyCustomerGid);
		const inspect = spyOn(f.storefront, "inspectCart").mockRejectedValueOnce(
			new Error("Temporary Shopify outage"),
		);
		const checkout = spyOn(f.storefront, "checkout");

		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			status: 503,
		});
		expect(checkout).not.toHaveBeenCalled();
		expect(
			await f.checkout.classExecutions.get(f.organization.id, intent.id),
		).toMatchObject({
			state: "retryable",
			checkpoint: "attached",
			storefrontBinding: null,
		});
		await expect(f.service.start(f.defaultInput)).resolves.toMatchObject({
			intentId: intent.id,
			checkoutUrl: first.checkoutUrl,
		});
		expect(inspect).toHaveBeenCalledTimes(2);
		expect(create).toHaveBeenCalledTimes(1);
	});

	it("verifies a legacy known cart before retrying an interrupted attachment", async () => {
		const f = await createFixture();
		omitLegacyStorefrontBinding(f.checkout);
		const create = spyOn(f.storefront, "createCart");
		spyOn(f.checkout, "markIntentReady").mockImplementationOnce(async () => {
			f.now.setTime(f.now.getTime() + 31_000);
			throw new Error("Attachment interrupted");
		});
		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			code: "checkout_execution_changed",
		});
		const intent = required(await f.checkout.findIntentByKey(f.defaultInput));
		const record = required(
			await f.checkout.classExecutions.get(f.organization.id, intent.id),
		);
		expect(record).toMatchObject({
			checkpoint: "remote_cart_known",
			storefrontBinding: null,
		});
		expect(intent.cartReference).toBeNull();
		f.storefront.inspectCart = async () =>
			cartEvidence(intent, f.customer.shopifyCustomerGid);
		const inspect = spyOn(f.storefront, "inspectCart");

		await expect(f.service.start(f.defaultInput)).resolves.toMatchObject({
			intentId: intent.id,
		});
		expect(inspect).toHaveBeenCalledWith({
			organizationId: f.organization.id,
			shopifyCartId: record.shopifyCartId,
			expectedStorefrontBinding: {
				shopDomain: f.storeDomain,
				integrationVersion: 1,
			},
		});
		expect(create).toHaveBeenCalledTimes(1);
	});

	it("preserves checkout and replay without a managed execution repository", async () => {
		const f = await createFixture({
			legacyCheckout: true,
			customerAccountIntegrationVersion: 2,
		});
		const create = spyOn(f.storefront, "createCart");
		const first = await f.service.start(f.defaultInput);
		await expect(f.service.start(f.defaultInput)).resolves.toMatchObject({
			intentId: first.intentId,
			checkoutUrl: first.checkoutUrl,
		});
		expect(create).toHaveBeenCalledTimes(1);
		expect(
			await f.checkout.classExecutions.get(f.organization.id, first.intentId),
		).toBeNull();
	});

	it("records unknown creation before returning recovery, clears its lease, and deterministically replays without another mutation", async () => {
		const f = await createFixture({
			mockStorefront: {
				createCart: async () => {
					throw new Error("response lost after remote acceptance");
				},
			},
		});
		const create = spyOn(f.storefront, "createCart");
		const first = await f.service.start(f.defaultInput).catch((error) => error);
		expect(first).toBeInstanceOf(ClassCheckoutRecoveryRequiredError);
		const intent = await f.checkout.findIntentByKey(f.defaultInput);
		const record = await f.checkout.classExecutions.get(
			f.organization.id,
			required(intent).id,
		);
		expect(record).toMatchObject({
			state: "recovery_required",
			checkpoint: "create_dispatched",
			leaseOwner: null,
			leaseExpiresAtIso: null,
		});
		expect(first.recovery.recoveryReference).toBe(
			required(record).recoveryReference,
		);
		const second = await f.service
			.start(f.defaultInput)
			.catch((error) => error);
		expect(second.recovery).toEqual(first.recovery);
		expect(create).toHaveBeenCalledTimes(1);
		const evidence = JSON.stringify(
			await f.checkout.classExecutions.events(
				f.organization.id,
				required(intent).id,
			),
		);
		expect(evidence).toContain("create_dispatched");
		expect(evidence).toContain("recovery_required");
		expect(evidence).not.toContain("response lost after remote acceptance");
		expect(JSON.stringify(required(record).requestSnapshot)).not.toContain(
			f.defaultInput.buyerAccessToken,
		);
		expect(JSON.stringify(required(record).requestSnapshot)).not.toContain(
			f.defaultInput.idempotencyKey,
		);
	});

	it("rejects changed-payload identity reuse before either failed or successful replay", async () => {
		const f = await createFixture();
		await f.service.start(f.defaultInput);
		const checkout = spyOn(f.storefront, "checkout");
		await expect(
			f.service.start({
				...f.defaultInput,
				pieces: [{ ...f.defaultPieces[0], title: "Different submission" }],
			}),
		).rejects.toMatchObject({ status: 409, code: "checkout_payload_conflict" });
		expect(checkout).not.toHaveBeenCalled();
	});

	for (const entryPoint of ["start", "recovery status"] as const) {
		it(`withholds a completed cart URL on ${entryPoint} when payment is approved during Shopify lookup`, async () => {
			const f = await createFixture();
			const first = await f.service.start(f.defaultInput);
			const record = required(
				await f.checkout.classExecutions.get(f.organization.id, first.intentId),
			);
			expect(record).toMatchObject({
				state: "completed",
				checkpoint: "attached",
			});
			const entered = Promise.withResolvers<void>();
			const release = Promise.withResolvers<{ checkoutUrl: string }>();
			const create = spyOn(f.storefront, "createCart");
			spyOn(f.storefront, "checkout").mockImplementationOnce(() => {
				entered.resolve();
				return release.promise;
			});
			const replay =
				entryPoint === "start"
					? f.service.start(f.defaultInput)
					: f.service.recoveryStatus({
							organizationId: f.organization.id,
							customerId: f.customer.id,
							sessionId: f.session.sessionId,
							recoveryReference: record.recoveryReference,
							idempotencyKey: f.defaultInput.idempotencyKey,
						});
			void replay.catch(() => undefined);
			await entered.promise;
			try {
				await f.checkout.resolveIntent(first.intentId, "approved");
			} finally {
				release.resolve({ checkoutUrl: first.checkoutUrl });
			}
			if (entryPoint === "start") {
				await expect(replay).rejects.toBeInstanceOf(AppError);
				await expect(replay).rejects.toMatchObject({
					status: 409,
					code: "checkout_already_completed",
				});
			} else {
				const status = await replay;
				expect(status).toMatchObject({
					status: "resolved",
					reasonCode: "checkout_already_completed",
					retryAllowed: false,
				});
				expect(status.checkoutUrl).toBeUndefined();
			}
			expect(create).not.toHaveBeenCalled();
		});
	}

	it("withholds a completed cart URL when another worker changes its execution generation during Shopify lookup", async () => {
		const f = await createFixture();
		const first = await f.service.start(f.defaultInput);
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<{ checkoutUrl: string }>();
		spyOn(f.storefront, "checkout").mockImplementationOnce(() => {
			entered.resolve();
			return release.promise;
		});
		const replay = f.service.start(f.defaultInput);
		void replay.catch(() => undefined);
		await entered.promise;
		try {
			const claim = {
				organizationId: f.organization.id,
				intentId: first.intentId,
				owner: "revalidating-worker",
			};
			const claimed = required(
				await f.checkout.classExecutions.claim({
					...claim,
					allowCompleted: true,
				}),
			);
			expect(
				await f.checkout.classExecutions.transition({
					claim: { ...claim, generation: claimed.generation },
					state: "completed",
					releaseLease: true,
				}),
			).toBe(true);
		} finally {
			release.resolve({ checkoutUrl: first.checkoutUrl });
		}
		await expect(replay).rejects.toMatchObject({
			status: 409,
			code: "checkout_execution_changed",
		});
	});

	it("withholds a completed cart URL when it expires during the final replay-state read", async () => {
		const f = await createFixture();
		const first = await f.service.start(f.defaultInput);
		const expiresAt = Date.parse(first.intent.expiresAtIso);
		f.now.setTime(expiresAt - 1);
		const readState = f.checkout.getClassCheckoutReplayState.bind(f.checkout);
		const snapshot = spyOn(f.checkout, "getClassCheckoutReplayState");
		snapshot.mockImplementationOnce(async (organizationId, intentId) => {
			const state = await readState(organizationId, intentId);
			f.now.setTime(expiresAt);
			return state;
		});

		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			code: "checkout_recovery_required",
			recovery: { reasonCode: "checkout_expired", retryAllowed: false },
		});
		expect(snapshot).toHaveBeenCalledTimes(1);
		expect(
			await f.checkout.classExecutions.get(f.organization.id, first.intentId),
		).toMatchObject({
			state: "recovery_required",
			resultCode: "checkout_expired",
		});
	});

	it("times out a stalled completed cart replay and retries the same cart with the same key", async () => {
		const f = await createFixture();
		const create = spyOn(f.storefront, "createCart");
		const checkout = spyOn(f.storefront, "checkout");
		const first = await f.service.start(f.defaultInput);
		expect(checkout.mock.calls[0][0].signal).toBeUndefined();
		const record = required(
			await f.checkout.classExecutions.get(f.organization.id, first.intentId),
		);
		checkout.mockImplementationOnce(() => new Promise(() => {}));
		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			status: 503,
			code: "checkout_replay_timeout",
		});
		expect(checkout.mock.calls[1][0].signal?.aborted).toBe(true);
		expect(
			await f.checkout.classExecutions.get(f.organization.id, first.intentId),
		).toEqual(record);
		expect(
			await f.checkout.classExecutions.events(
				f.organization.id,
				first.intentId,
			),
		).toContainEqual(
			expect.objectContaining({
				eventType: "checkout_url_unavailable",
				evidence: {
					stage: "resume_checkout_url",
					code: "checkout_replay_timeout",
				},
			}),
		);
		await expect(f.service.start(f.defaultInput)).resolves.toMatchObject({
			intentId: first.intentId,
			checkoutUrl: first.checkoutUrl,
		});
		expect(checkout.mock.calls[2][0].shopifyCartId).toBe(record.shopifyCartId);
		expect(create).toHaveBeenCalledTimes(1);
	}, 6_000);

	it("reuses the admitted Shopify cart after transient checkout URL failure", async () => {
		const f = await createFixture();
		const create = spyOn(f.storefront, "createCart");
		const original = f.storefront.checkout;
		f.storefront.checkout = async () => {
			throw new Error("temporary read failure");
		};
		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			status: 503,
		});
		const intent = await f.checkout.findIntentByKey(f.defaultInput);
		expect(
			await f.checkout.classExecutions.get(
				f.organization.id,
				required(intent).id,
			),
		).toMatchObject({
			state: "retryable",
			checkpoint: "attached",
			leaseOwner: null,
		});
		f.storefront.checkout = original;
		await expect(f.service.start(f.defaultInput)).resolves.toMatchObject({
			intentId: required(intent).id,
		});
		expect(create).toHaveBeenCalledTimes(1);
	});

	it("reports persistence unavailable rather than claiming unrecorded recovery, then reaps the dispatch checkpoint", async () => {
		const f = await createFixture({
			mockStorefront: {
				createCart: async () => {
					throw new Error("unknown");
				},
			},
		});
		const original = f.checkout.classExecutions.recordRecoveryRequired.bind(
			f.checkout.classExecutions,
		);
		f.checkout.classExecutions.recordRecoveryRequired = async () => {
			throw new Error("database unavailable");
		};
		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			status: 503,
			code: "checkout_persistence_unavailable",
		});
		const intent = await f.checkout.findIntentByKey(f.defaultInput);
		expect(
			await f.checkout.classExecutions.get(
				f.organization.id,
				required(intent).id,
			),
		).toMatchObject({ state: "running", checkpoint: "create_dispatched" });
		f.checkout.classExecutions.recordRecoveryRequired = original;
		f.now.setTime(f.now.getTime() + 31_000);
		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			code: "checkout_recovery_required",
		});
		expect(
			await f.checkout.classExecutions.get(
				f.organization.id,
				required(intent).id,
			),
		).toMatchObject({ state: "recovery_required", leaseOwner: null });
	});

	it("blocks alternate keys while creation remains unknown, even after application expiry", async () => {
		const f = await createFixture({
			mockStorefront: {
				createCart: async () => {
					throw new Error("unknown");
				},
			},
		});
		await f.service.start(f.defaultInput).catch(() => undefined);
		f.now.setTime(f.now.getTime() + 31 * 60_000);
		const create = spyOn(f.storefront, "createCart");
		await expect(
			f.service.start({
				...f.defaultInput,
				idempotencyKey: "another-submission",
			}),
		).rejects.toMatchObject({ code: "checkout_recovery_required" });
		expect(create).not.toHaveBeenCalled();
	});

	it("records a late cart observation without allowing a stale worker to attach it", async () => {
		let release!: (cart: { shopifyCartId: string }) => void;
		let created!: () => void;
		const started = new Promise<void>((resolve) => {
			created = resolve;
		});
		const deferred = new Promise<{ shopifyCartId: string }>((resolve) => {
			release = resolve;
		});
		const f = await createFixture({
			mockStorefront: {
				createCart: () => {
					created();
					return deferred;
				},
			},
		});
		const create = spyOn(f.storefront, "createCart");
		const pending = f.service.start(f.defaultInput).catch((error) => error);
		await started;
		const intent = await f.checkout.findIntentByKey(f.defaultInput);
		expect(intent).not.toBeNull();
		f.now.setTime(f.now.getTime() + 31_000);
		await f.checkout.classExecutions.reapExpired(
			f.organization.id,
			required(intent).id,
		);
		release({ shopifyCartId: "gid://shopify/Cart/late-result" });
		await expect(pending).resolves.toBeInstanceOf(
			ClassCheckoutRecoveryRequiredError,
		);
		expect(
			required(await f.checkout.findIntentByKey(f.defaultInput)).cartReference,
		).toBeNull();
		expect(
			await f.checkout.classExecutions.events(
				f.organization.id,
				required(intent).id,
			),
		).toContainEqual(
			expect.objectContaining({
				eventType: "late_remote_cart_observed",
				evidence: {
					shopifyCartId: "gid://shopify/Cart/late-result",
					stage: "create_cart",
				},
			}),
		);
		const listing = await f.service.listRecoveries({
			organizationId: f.organization.id,
		});
		const observation = required(
			listing[0].events.find(
				(event) => event.eventType === "late_remote_cart_observed",
			),
		);
		expect(observation.hasCartEvidence).toBe(true);
		expect(JSON.stringify(listing)).not.toContain(
			"gid://shopify/Cart/late-result",
		);
		f.storefront.inspectCart = async () => ({
			correlationId: required(intent).correlationId,
			customerGid: f.customer.shopifyCustomerGid,
			lines: required(required(intent).lines).map((line) => ({
				intentLineId: line.id,
				variantGid: line.shopifyVariantGid,
				quantity: 1,
			})),
		});
		await f.service.resolveRecovery({
			organizationId: f.organization.id,
			recoveryReference: listing[0].recoveryReference,
			expectedGeneration: listing[0].generation,
			actorId: "admin",
			reason: "Validate late observation",
			action: "adopt_cart",
			evidenceEventId: observation.id,
		});
		await expect(f.service.start(f.defaultInput)).resolves.toMatchObject({
			intentId: required(intent).id,
		});
		expect(create).toHaveBeenCalledTimes(1);
	});

	it("adopts verified legacy cart evidence against the current Storefront binding", async () => {
		const f = await createFixture({
			mockStorefront: {
				createCart: async () => {
					throw new Error("unknown");
				},
			},
		});
		omitLegacyStorefrontBinding(f.checkout);
		const error = await f.service.start(f.defaultInput).catch((error) => error);
		const intent = required(await f.checkout.findIntentByKey(f.defaultInput));
		const execution = required(
			await f.checkout.classExecutions.get(f.organization.id, intent.id),
		);
		expect(execution.storefrontBinding).toBeNull();
		await f.organizations.upsertShopifyIntegration({
			...f.storefrontIntegration,
			encryptedStorefrontPrivateToken: "rotated-storefront-token",
		});
		const binding = { shopDomain: f.storeDomain, integrationVersion: 2 };
		const create = spyOn(f.storefront, "createCart");
		f.storefront.inspectCart = async () =>
			cartEvidence(intent, f.customer.shopifyCustomerGid);
		const inspect = spyOn(f.storefront, "inspectCart");
		const resolved = await f.service.resolveRecovery({
			organizationId: f.organization.id,
			recoveryReference: error.recovery.recoveryReference,
			expectedGeneration: execution.generation,
			actorId: "admin",
			reason: "Verified cart evidence",
			action: "adopt_cart",
			shopifyCartId: "gid://shopify/Cart/recovered",
		});
		expect(resolved.retryAllowed).toBe(true);
		expect(inspect).toHaveBeenCalledWith({
			organizationId: f.organization.id,
			shopifyCartId: "gid://shopify/Cart/recovered",
			expectedStorefrontBinding: binding,
		});
		expect(
			await f.checkout.classExecutions.get(f.organization.id, intent.id),
		).toMatchObject({ storefrontBinding: binding });
		f.now.setTime(f.now.getTime() + 15 * 60_000);
		await expect(f.service.start(f.defaultInput)).resolves.toMatchObject({
			intentId: intent.id,
		});
		expect(create).not.toHaveBeenCalled();
		const attachedIntent = required(
			await f.checkout.findIntentByKey(f.defaultInput),
		);
		const cart = await f.checkout.getCart(
			required(attachedIntent.cartReference),
			f.organization.id,
			f.customer.id,
			f.now.toISOString(),
		);
		expect(cart?.expiresAtIso).toBe(intent.expiresAtIso);
	});

	it("records application expiry of an admitted cart without extending its window or querying Shopify", async () => {
		const f = await createFixture();
		await f.service.start(f.defaultInput);
		const intent = required(await f.checkout.findIntentByKey(f.defaultInput));
		const before = required(
			await f.checkout.classExecutions.get(f.organization.id, intent.id),
		);
		f.now.setTime(f.now.getTime() + 31 * 60_000);
		const create = spyOn(f.storefront, "createCart");
		const checkout = spyOn(f.storefront, "checkout");
		const status = await f.service.recoveryStatus({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			sessionId: f.session.sessionId,
			recoveryReference: before.recoveryReference,
			idempotencyKey: f.defaultInput.idempotencyKey,
		});
		expect(status).toMatchObject({
			status: "recovery_required",
			reasonCode: "checkout_expired",
			retryAllowed: false,
		});
		expect(status.checkoutUrl).toBeUndefined();
		const replay = await f.service
			.preflightRecovery({ ...f.defaultInput, buyerAccessToken: "" })
			.catch((error) => error);
		expect(replay.recovery).toEqual(status);
		expect(create).not.toHaveBeenCalled();
		expect(checkout).not.toHaveBeenCalled();
		expect(
			required(await f.checkout.findIntentByKey(f.defaultInput)).expiresAtIso,
		).toBe(intent.expiresAtIso);
		expect(
			await f.checkout.classExecutions.get(f.organization.id, intent.id),
		).toMatchObject({
			state: "recovery_required",
			checkpoint: "attached",
			shopifyCartId: before.shopifyCartId,
			leaseOwner: null,
			leaseExpiresAtIso: null,
		});
		expect(
			(
				await f.checkout.classExecutions.events(f.organization.id, intent.id)
			).filter((event) => event.eventType === "application_checkout_expired"),
		).toHaveLength(1);
	});

	it("records expired unfulfilled known carts before allowing replacement keys or sessions, while approved operations do not block", async () => {
		const f = await createFixture();
		await f.service.start(f.defaultInput);
		const intent = required(await f.checkout.findIntentByKey(f.defaultInput));
		f.now.setTime(f.now.getTime() + 31 * 60_000);
		const replacement = await f.customers.createCustomerSession({
			sessionId: "replacement-session",
			organizationId: f.organization.id,
			shopifyCustomerGid: f.customer.shopifyCustomerGid,
			encryptedTokens: "replacement-token",
			csrfToken: "replacement-csrf",
			integrationVersion: 1,
			createdAtIso: f.now.toISOString(),
			lastSeenAtIso: f.now.toISOString(),
			expiresAtIso: new Date(f.now.getTime() + 8 * 3600_000).toISOString(),
		});
		expect(replacement.customer.id).toBe(f.customer.id);
		const submission = {
			...f.defaultInput,
			sessionId: replacement.session.sessionId,
			idempotencyKey: "replacement-key",
		};
		const create = spyOn(f.storefront, "createCart");
		const first = await f.service
			.preflightRecovery({ ...submission, buyerAccessToken: "" })
			.catch((error) => error);
		expect(first).toBeInstanceOf(ClassCheckoutRecoveryRequiredError);
		expect(first.recovery).toMatchObject({
			status: "recovery_required",
			reasonCode: "checkout_expired",
			retryAllowed: false,
		});
		const replay = await f.service.start(submission).catch((error) => error);
		expect(replay.recovery).toEqual(first.recovery);
		expect(create).not.toHaveBeenCalled();
		expect(
			await f.checkout.classExecutions.get(f.organization.id, intent.id),
		).toMatchObject({
			state: "recovery_required",
			checkpoint: "attached",
			leaseOwner: null,
			leaseExpiresAtIso: null,
		});

		const approved = await createFixture();
		await approved.service.start(approved.defaultInput);
		const paidIntent = required(
			await approved.checkout.findIntentByKey(approved.defaultInput),
		);
		await approved.checkout.resolveIntent(paidIntent.id, "approved");
		approved.now.setTime(approved.now.getTime() + 31 * 60_000);
		await expect(
			approved.service.preflightRecovery({
				...approved.defaultInput,
				idempotencyKey: "new-work-after-completion",
				buyerAccessToken: "",
			}),
		).resolves.toBeUndefined();
	});

	it("rejects mismatching operator cart evidence without changing recovery", async () => {
		const f = await createFixture({
			mockStorefront: {
				createCart: async () => {
					throw new Error("unknown");
				},
				inspectCart: async () => ({
					correlationId: "wrong",
					customerGid: "another-buyer",
					lines: [],
				}),
			},
		});
		const error = await f.service.start(f.defaultInput).catch((error) => error);
		const intent = required(await f.checkout.findIntentByKey(f.defaultInput));
		const record = required(
			await f.checkout.classExecutions.get(f.organization.id, intent.id),
		);
		await expect(
			f.service.resolveRecovery({
				organizationId: f.organization.id,
				recoveryReference: error.recovery.recoveryReference,
				expectedGeneration: record.generation,
				actorId: "admin",
				reason: "Verified evidence",
				action: "adopt_cart",
				shopifyCartId: "gid://shopify/Cart/wrong",
			}),
		).rejects.toMatchObject({ code: "checkout_recovery_evidence_invalid" });
		expect(
			await f.checkout.classExecutions.get(f.organization.id, intent.id),
		).toEqual(record);
	});

	it("requires audited acknowledgement to abandon unknown work and preserves the closed operation when a new one starts", async () => {
		const f = await createFixture({
			mockStorefront: {
				createCart: async () => {
					throw new Error("unknown");
				},
			},
		});
		const error = await f.service.start(f.defaultInput).catch((error) => error);
		const intent = required(await f.checkout.findIntentByKey(f.defaultInput));
		const record = required(
			await f.checkout.classExecutions.get(f.organization.id, intent.id),
		);
		const resolution = {
			organizationId: f.organization.id,
			recoveryReference: error.recovery.recoveryReference,
			expectedGeneration: record.generation,
			actorId: "admin",
			reason: "Close unresolved checkout with retained evidence",
			action: "abandon_unknown" as const,
		};
		await expect(f.service.resolveRecovery(resolution)).rejects.toMatchObject({
			code: "checkout_recovery_acknowledgement_required",
		});
		await expect(
			f.service.resolveRecovery({ ...resolution, acknowledgeUnknown: true }),
		).resolves.toMatchObject({
			status: "resolved",
			reasonCode: "abandoned_unknown",
			retryAllowed: false,
		});
		await expect(
			f.service.recoveryStatus({
				organizationId: f.organization.id,
				customerId: f.customer.id,
				sessionId: f.session.sessionId,
				recoveryReference: error.recovery.recoveryReference,
				idempotencyKey: f.defaultInput.idempotencyKey,
			}),
		).resolves.toMatchObject({
			status: "resolved",
			reasonCode: "abandoned_unknown",
			retryAllowed: false,
		});
		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			code: "abandoned_unknown",
		});
		f.storefront.createCart = async () => ({
			shopifyCartId: "gid://shopify/Cart/explicitly-new-operation",
		});
		await expect(
			f.service.start({
				...f.defaultInput,
				idempotencyKey: "explicitly-new-operation",
			}),
		).resolves.toHaveProperty("checkoutUrl");
		expect(
			await f.checkout.classExecutions.get(f.organization.id, intent.id),
		).toMatchObject({ state: "rejected", checkpoint: "create_dispatched" });
		expect(
			await f.checkout.classExecutions.events(f.organization.id, intent.id),
		).toContainEqual(
			expect.objectContaining({
				eventType: "resolved",
				evidence: expect.objectContaining({
					actorId: "admin",
					resolution: "abandon",
				}),
			}),
		);
	});

	it("replays the recorded recovery result in local preflight without a provider token", async () => {
		const f = await createFixture({
			mockStorefront: {
				createCart: async () => {
					throw new Error("unknown");
				},
			},
		});
		const first = await f.service.start(f.defaultInput).catch((error) => error);
		const create = spyOn(f.storefront, "createCart");
		const replay = await f.service
			.preflightRecovery({ ...f.defaultInput, buyerAccessToken: "" })
			.catch((error) => error);
		expect(replay.recovery).toEqual(first.recovery);
		expect(create).not.toHaveBeenCalled();
	});

	it("preserves paid-order review evidence consistently across status reads and checkout replay", async () => {
		const f = await createFixture({
			mockStorefront: {
				createCart: async () => {
					throw new Error("unknown");
				},
			},
		});
		await f.service.start(f.defaultInput).catch(() => undefined);
		const intent = required(await f.checkout.findIntentByKey(f.defaultInput));
		await f.checkout.classExecutions.observePayment({
			organizationId: f.organization.id,
			intentId: intent.id,
			shopifyOrderGid: "gid://shopify/Order/review-evidence",
			approved: false,
		});
		await f.checkout.resolveIntent(intent.id, "needs_review");
		const record = required(
			await f.checkout.classExecutions.get(f.organization.id, intent.id),
		);
		const status = await f.service.recoveryStatus({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			sessionId: f.session.sessionId,
			recoveryReference: record.recoveryReference,
			idempotencyKey: f.defaultInput.idempotencyKey,
		});
		expect(status).toMatchObject({
			status: "recovery_required",
			reasonCode: "paid_order_requires_review",
			retryAllowed: false,
		});
		const replay = await f.service
			.start(f.defaultInput)
			.catch((error) => error);
		expect(replay.recovery).toEqual(status);
		expect(status.checkoutUrl).toBeUndefined();
	});

	it("serializes simultaneous same-key and alternate-key requests around one external creation", async () => {
		let release!: (value: { shopifyCartId: string }) => void;
		let dispatch!: () => void;
		const dispatched = new Promise<void>((resolve) => {
			dispatch = resolve;
		});
		const remote = new Promise<{ shopifyCartId: string }>((resolve) => {
			release = resolve;
		});
		const f = await createFixture({
			mockStorefront: {
				createCart: () => {
					dispatch();
					return remote;
				},
			},
		});
		const create = spyOn(f.storefront, "createCart");
		const first = f.service.start(f.defaultInput);
		await dispatched;
		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			code: "checkout_in_progress",
		});
		await expect(
			f.service.start({
				...f.defaultInput,
				idempotencyKey: "competing-submission",
			}),
		).rejects.toMatchObject({ code: "checkout_in_progress" });
		release({ shopifyCartId: "gid://shopify/Cart/one-creation" });
		await expect(first).resolves.toHaveProperty("checkoutUrl");
		expect(create).toHaveBeenCalledTimes(1);
	});

	it("rechecks current capacity for a recovered remote cart and records recovery again without grandfathering it", async () => {
		const f = await createFixture({
			mockStorefront: {
				createCart: async () => {
					throw new Error("unknown");
				},
			},
		});
		const failure = await f.service
			.start(f.defaultInput)
			.catch((error) => error);
		const intent = required(await f.checkout.findIntentByKey(f.defaultInput));
		const record = required(
			await f.checkout.classExecutions.get(f.organization.id, intent.id),
		);
		f.storefront.inspectCart = async () => ({
			correlationId: intent.correlationId,
			customerGid: f.customer.shopifyCustomerGid,
			lines: required(intent.lines).map((line) => ({
				intentLineId: line.id,
				variantGid: line.shopifyVariantGid,
				quantity: 1,
			})),
		});
		await f.service.resolveRecovery({
			organizationId: f.organization.id,
			recoveryReference: record.recoveryReference,
			expectedGeneration: record.generation,
			actorId: "admin",
			reason: "Verified remote cart",
			action: "adopt_cart",
			shopifyCartId: "gid://shopify/Cart/recovered-unadmitted",
		});
		await f.organizations.updateFestivalClassConfiguration({
			organizationId: f.organization.id,
			festivalId: required(f.festival).id,
			id: f.classConfig.id,
			capacity: 1,
		});
		await f.commerce.createClassEntitlement({
			organizationId: f.organization.id,
			festivalId: required(f.festival).id,
			festivalClassId: f.classConfig.id,
			parentCustomerId: "other-parent",
			childId: "other-child",
			checkoutIntentId: "other-intent",
			shopifyOrderGid: "gid://shopify/Order/other",
			shopifyOrderLineGid: "gid://shopify/LineItem/other",
			paidAmountCents: 4500,
			paidCurrencyCode: "USD",
			status: "confirmed",
		});
		const create = spyOn(f.storefront, "createCart");
		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			code: "checkout_recovery_required",
			recovery: {
				recoveryReference: failure.recovery.recoveryReference,
				reasonCode: "checkout_attachment_incomplete",
			},
		});
		expect(create).not.toHaveBeenCalled();
		expect(
			required(await f.checkout.findIntentByKey(f.defaultInput)).cartReference,
		).toBeNull();
		expect(
			await f.checkout.classExecutions.get(f.organization.id, intent.id),
		).toMatchObject({
			state: "recovery_required",
			checkpoint: "remote_cart_known",
			leaseOwner: null,
		});
	});

	it("permits same-owner recovery reads across sessions but never returns a different submission's checkout URL", async () => {
		const f = await createFixture();
		await f.service.start(f.defaultInput);
		const intent = required(await f.checkout.findIntentByKey(f.defaultInput));
		const record = required(
			await f.checkout.classExecutions.get(f.organization.id, intent.id),
		);
		const status = await f.service.recoveryStatus({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			sessionId: "new-session",
			recoveryReference: record.recoveryReference,
			idempotencyKey: "different-submission",
		});
		expect(status.retryAllowed).toBe(false);
		expect(status.checkoutUrl).toBeUndefined();
		await expect(
			f.service.recoveryStatus({
				organizationId: f.organization.id,
				customerId: "other-customer",
				sessionId: f.session.sessionId,
				recoveryReference: record.recoveryReference,
				idempotencyKey: f.defaultInput.idempotencyKey,
			}),
		).rejects.toMatchObject({ status: 404 });
	});
	it("captures an explicit unknown instrument when an existing client omits selection", async () => {
		const f = await createFixture();
		const insert = spyOn(f.checkout, "insertRegistrationMetadata");
		await f.service.start(f.defaultInput);
		expect(insert.mock.calls[0][0].registrationSnapshot?.instrument).toBe(
			"unknown",
		);
	});

	it("freezes the validated selection before checkout and preserves it after catalog and registration edits", async () => {
		const f = await createFixture();
		const instrument = await f.organizations.createRegistrationCatalogValue({
			organizationId: f.organization.id,
			kind: "instrument",
			displayName: "Piano",
			normalizedName: "piano",
		});
		f.organizations.setCustomerName(f.teacherId, "Original Teacher");
		const captured: ClassRegistrationMetadata[] = [];
		const insert = f.checkout.insertRegistrationMetadata.bind(f.checkout);
		f.checkout.insertRegistrationMetadata = async (params) => {
			const metadata = await insert(params);
			captured.push(metadata);
			return metadata;
		};
		const result = await f.service.start({
			...f.defaultInput,
			accompanistId: f.accompanistId,
			instrumentId: instrument.id,
			pieces: [{ ...f.defaultPieces[0], movement: "Variation II" }],
		});
		expect(captured).toHaveLength(1);
		const metadata = captured[0];
		if (!metadata.checkoutIntentLineId || !f.festival)
			throw new Error("Expected a class checkout line and festival.");
		const original = structuredClone(metadata.registrationSnapshot);
		expect(original).toMatchObject({
			version: 1,
			capturedAtIso: f.now.toISOString(),
			class: {
				id: f.classConfig.id,
				displayName: "Junior Solo Piano Level 1",
				classSubtypeName: "Solo Piano",
				price: "45.00",
				currencyCode: "USD",
				capacity: 25,
			},
			division: { id: f.division.id, name: "Junior Piano" },
			instrument: { id: instrument.id, name: "Piano" },
			teacher: {
				customerId: f.teacherId,
				membershipId: f.teacherEntitlement.id,
				name: "Original Teacher",
			},
			accompanist: {
				customerId: f.accompanistId,
				membershipId: f.accompanistGrant.id,
				name: "Sam Accompanist",
			},
			repertoire: [
				{ title: f.defaultPieces[0].title, movement: "Variation II" },
			],
		});
		expect(result.intent?.lines?.[0].divisionNameSnapshot).toBe("Junior Piano");
		expect(JSON.stringify(original)).not.toMatch(
			/shopify|buyer-token|encrypted|@example|555-555/,
		);
		await f.checkout.linkRegistrationMetadataToEntitlement({
			checkoutIntentLineId: metadata.checkoutIntentLineId,
			classEntitlementId: "paid-entitlement",
		});
		await f.organizations.updateFestivalClassConfiguration({
			organizationId: f.organization.id,
			festivalId: f.festival.id,
			id: f.classConfig.id,
			displayName: "Renamed class",
			capacity: 100,
			price: "60.00",
		});
		await f.organizations.updateDivision({
			organizationId: f.organization.id,
			divisionId: f.division.id,
			displayName: "Renamed division",
		});
		f.organizations.setCustomerName(f.teacherId, "Changed Teacher");
		await f.organizations.updateRegistrationCatalogValue({
			organizationId: f.organization.id,
			kind: "instrument",
			id: instrument.id,
			displayName: "Renamed instrument",
		});
		await f.checkout.updateRegistrationMetadata(
			metadata.id,
			f.organization.id,
			{
				pieces: [
					{ title: "Replacement", composer: "Other", durationSeconds: 60 },
				],
				accompanistMembershipId: null,
			},
		);
		const saved = await f.checkout.getRegistrationMetadataByEntitlementId(
			f.organization.id,
			"paid-entitlement",
		);
		expect(saved?.registrationSnapshot).toEqual(original);
		expect(saved?.repertoireJson[0].title).toBe("Replacement");
		expect(saved?.accompanistMembershipId).toBeNull();
		// Returned nested values must not provide a mutation path into the record.
		if (!saved?.registrationSnapshot)
			throw new Error("Expected the original selection.");
		saved.registrationSnapshot.class.displayName = "Mutated response";
		expect(
			(
				await f.checkout.getRegistrationMetadataByEntitlementId(
					f.organization.id,
					"paid-entitlement",
				)
			)?.registrationSnapshot,
		).toEqual(original);
	});

	it("rejects malformed, missing, inactive and cross-tenant instrument selections before creating commerce state", async () => {
		const f = await createFixture();
		const inactive = await f.organizations.createRegistrationCatalogValue({
			organizationId: f.organization.id,
			kind: "instrument",
			displayName: "Inactive",
			normalizedName: "inactive",
		});
		await f.organizations.updateRegistrationCatalogValue({
			organizationId: f.organization.id,
			kind: "instrument",
			id: inactive.id,
			isActive: false,
		});
		const other = await f.organizations.createOrganization({
			name: "Other",
			slug: "other",
		});
		const foreign = await f.organizations.createRegistrationCatalogValue({
			organizationId: other.id,
			kind: "instrument",
			displayName: "Foreign",
			normalizedName: "foreign",
		});
		const createIntent = spyOn(f.checkout, "createIntent");
		for (const instrumentId of [
			"",
			" ",
			"unknown",
			"missing",
			inactive.id,
			foreign.id,
			null,
			42,
			{},
		]) {
			await expect(
				f.service.start({
					...f.defaultInput,
					instrumentId: instrumentId as string,
				}),
			).rejects.toMatchObject({ status: 400, code: "instrument_invalid" });
		}
		expect(createIntent).not.toHaveBeenCalled();
	});

	it("keeps each purchased line's original instrument, repertoire and accompanist selection separate", async () => {
		const f = await createFixture();
		const instrumentA = await f.organizations.createRegistrationCatalogValue({
			organizationId: f.organization.id,
			kind: "instrument",
			displayName: "Piano",
			normalizedName: "piano",
		});
		const instrumentB = await f.organizations.createRegistrationCatalogValue({
			organizationId: f.organization.id,
			kind: "instrument",
			displayName: "Violin",
			normalizedName: "violin",
		});
		const child = await f.customers.createChild({
			organizationId: f.organization.id,
			parentCustomerId: f.customer.id,
			displayName: "Second child",
		});
		await f.customers.createChildAgeSnapshot({
			organizationId: f.organization.id,
			childId: child.id,
			age: 10,
			createdAtIso: f.now.toISOString(),
			validUntilIso: new Date(f.now.getTime() + 30 * 86400_000).toISOString(),
		});
		const captured: ClassRegistrationMetadata[] = [];
		const insert = f.checkout.insertRegistrationMetadata.bind(f.checkout);
		f.checkout.insertRegistrationMetadata = async (params) => {
			const record = await insert(params);
			captured.push(record);
			return record;
		};
		await f.service.start({
			...f.defaultInput,
			lineItems: [
				{
					festivalClassId: f.classConfig.id,
					childId: f.child.id,
					teacherId: f.teacherId,
					instrumentId: instrumentA.id,
					accompanistId: f.accompanistId,
					pieces: f.defaultPieces,
				},
				{
					festivalClassId: f.classConfig.id,
					childId: child.id,
					teacherId: f.teacherId,
					instrumentId: instrumentB.id,
					pieces: [
						{
							title: "Second work",
							composer: "Second composer",
							movement: "II",
							durationSeconds: 90,
						},
					],
				},
			],
		});
		expect(captured).toHaveLength(2);
		expect(captured[0].checkoutIntentLineId).not.toBe(
			captured[1].checkoutIntentLineId,
		);
		expect(captured[0].registrationSnapshot).toMatchObject({
			instrument: { id: instrumentA.id, name: "Piano" },
			accompanist: { membershipId: f.accompanistGrant.id },
			repertoire: [{ title: f.defaultPieces[0].title }],
		});
		expect(captured[1].registrationSnapshot).toMatchObject({
			instrument: { id: instrumentB.id, name: "Violin" },
			accompanist: null,
			repertoire: [{ title: "Second work", movement: "II" }],
		});
	});

	it("waits for audited capacity publication before durable cart admission", async () => {
		const f = await createFixture();
		await f.commerce.createClassEntitlement({
			organizationId: f.organization.id,
			festivalId: f.festival?.id ?? "",
			festivalClassId: f.classConfig.id,
			parentCustomerId: "other",
			childId: "other",
			checkoutIntentId: "paid",
			shopifyOrderGid: "paid",
			shopifyOrderLineGid: "paid-line",
			paidAmountCents: 4500,
			paidCurrencyCode: "USD",
			status: "confirmed",
		});
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const original = f.checkout.markIntentReady.bind(f.checkout);
		let update: Promise<unknown> | undefined;
		f.checkout.markIntentReady = async (input) => {
			update =
				f.organizations.updateFestivalClassConfigurationWithCapacityAudit(
					{
						organizationId: f.organization.id,
						festivalId: f.festival?.id ?? "",
						id: f.classConfig.id,
						capacity: 1,
					},
					"admin",
					async () => {
						entered.resolve();
						await release.promise;
						return 1;
					},
				);
			await entered.promise;
			const attached = original(input);
			void attached.catch(() => undefined);
			try {
				await new Promise<void>((resolve) => setImmediate(resolve));
				expect(
					(
						await f.organizations.findFestivalClassConfigurationById(
							f.organization.id,
							f.festival?.id ?? "",
							f.classConfig.id,
						)
					)?.capacity,
				).toBe(25);
			} finally {
				release.resolve();
			}
			await update;
			return attached;
		};
		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			code: "checkout_recovery_required",
		});
		await update;
	});

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
		expect(stored?.lineIdentityProtocol).toBe(
			CLASS_CHECKOUT_LINE_IDENTITY_PROTOCOL,
		);
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
		const lookup = spyOn(f.organizations, "findActiveFestivalClassByShortName");
		const listFestivals = spyOn(f.organizations, "listFestivals");

		const result = await f.service.start({
			...f.defaultInput,
			festivalShortName: " PNW2026 ",
		});

		expect(result.checkoutUrl).toBeDefined();
		expect(lookup).toHaveBeenCalledTimes(1);
		expect(lookup).toHaveBeenCalledWith(
			f.organization.id,
			"PNW2026",
			f.classConfig.id,
			undefined,
		);
		// Eligibility and the final cart window guard refresh the festival; class resolution does not scan festivals.
		expect(listFestivals).toHaveBeenCalledTimes(2);
	});

	it("returns 404 for an inactive class on the named festival checkout", async () => {
		const f = await createFixture({ isClassActive: false });
		await expect(
			f.service.start({ ...f.defaultInput, festivalShortName: "pnw2026" }),
		).rejects.toMatchObject({
			status: 404,
			message: "Festival class configuration not found.",
		});
	});

	it("returns 404 when festival ID conflicts with the named festival", async () => {
		const f = await createFixture();
		await expect(
			f.service.start({
				...f.defaultInput,
				festivalShortName: "pnw2026",
				festivalId: "other-festival",
			}),
		).rejects.toMatchObject({ status: 404 });
	});

	it("returns 404 for a cross-tenant class on the named festival checkout", async () => {
		const f = await createFixture();
		const org2 = await f.organizations.createOrganization({
			name: "Other",
			slug: "other",
		});
		const fest2 = await f.organizations.createFestival({
			id: "fest-other-org",
			organizationId: org2.id,
			code: "PNW2026",
			shortName: "pnw2026",
			name: "Other festival",
			startDate: "2026-11-01",
			endDate: "2026-11-10",
		});
		const otherClass = await f.organizations.createFestivalClassConfiguration({
			organizationId: org2.id,
			festivalId: fest2.id,
			displayName: "Other class",
			classSubtypeId: f.classConfig.classSubtypeId,
			divisionId: f.division.id,
			minimumAge: 8,
			maximumAge: 12,
			price: "50.00",
			maximumPerformancePieces: 2,
			performanceMinutes: 10,
		});
		await expect(
			f.service.start({
				...f.defaultInput,
				festivalShortName: "pnw2026",
				festivalClassId: otherClass.id,
			}),
		).rejects.toMatchObject({ status: 404 });
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
			registrationOpensAt: "2026-01-01T00:00:00.000Z",
			registrationClosesAt: "2027-12-31T23:59:59.999Z",
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

	it("fails when festival class configuration belongs to a different organization", async () => {
		const f = await createFixture();

		const org2 = await f.organizations.createOrganization({
			name: "Other Organization",
			slug: "other-org",
		});

		const fest2 = await f.organizations.createFestival({
			id: "fest-org-2",
			organizationId: org2.id,
			code: "ORG2FEST",
			shortName: "org2fest",
			name: "Org 2 Festival",
			startDate: "2026-11-01",
			endDate: "2026-11-10",
		});

		const subtype2 = await f.organizations.createRegistrationCatalogValue({
			organizationId: org2.id,
			kind: "class_subtype",
			displayName: "Solo Piano",
			normalizedName: "solo piano",
		});

		const division2 = await f.organizations.createDivision({
			organizationId: org2.id,
			displayName: "Junior Piano",
			normalizedName: "junior piano",
		});

		const classInOrg2 = await f.organizations.createFestivalClassConfiguration({
			organizationId: org2.id,
			festivalId: fest2.id,
			displayName: "Org 2 Solo Piano",
			classSubtypeId: subtype2.id,
			divisionId: division2.id,
			minimumAge: 8,
			maximumAge: 12,
			price: "45.00",
			maximumPerformancePieces: 2,
			performanceMinutes: 10,
			capacity: 25,
			isActive: true,
		});

		await expect(
			f.service.start({
				...f.defaultInput,
				festivalClassId: classInOrg2.id,
			}),
		).rejects.toMatchObject({
			status: 404,
			message: "Festival class configuration not found.",
		});
	});

	it("returns 404 when requested festivalShortName targets another festival", async () => {
		const f = await createFixture();

		await f.organizations.createFestival({
			id: "fest-2027",
			organizationId: f.organization.id,
			code: "PNW2027",
			shortName: "pnw2027",
			name: "PNW Festival 2027",
			startDate: "2027-11-01",
			endDate: "2027-11-10",
		});

		await expect(
			f.service.start({
				...f.defaultInput,
				festivalShortName: "pnw2027",
				festivalClassId: f.classConfig.id,
			}),
		).rejects.toMatchObject({
			status: 404,
			message: "Festival class configuration not found.",
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

	it("rejects a repertoire piece with missing composer with 400", async () => {
		const f = await createFixture();
		await expect(
			f.service.start({
				...f.defaultInput,
				pieces: [
					{
						title: "Untitled",
						composer: undefined as never,
						durationSeconds: 60,
					},
				],
			}),
		).rejects.toMatchObject({
			status: 400,
			message: "Each repertoire piece must have a valid composer.",
		});
	});

	it("rejects a repertoire piece with whitespace-only composer with 400", async () => {
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

	it("rejects a repertoire piece with a non-string movement with 400 if passed", async () => {
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

	it("persists trimmed composer and movement in registration metadata", async () => {
		const f = await createFixture();
		const result = await f.service.start({
			...f.defaultInput,
			pieces: [
				{
					title: "  Moonlight Sonata  ",
					composer: "  Ludwig van Beethoven  ",
					movement: "  I. Adagio sostenuto  ",
					durationSeconds: 300,
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
				title: "Moonlight Sonata",
				composer: "Ludwig van Beethoven",
				movement: "I. Adagio sostenuto",
				durationSeconds: 300,
			},
		]);
		expect(metadata?.repertoireItems[0]).toMatchObject({
			titleSnapshot: "Moonlight Sonata",
			performedMovementText: "I. Adagio sostenuto",
			contributors: [{ displayNameSnapshot: "Ludwig van Beethoven" }],
		});
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
				title: "Sonata in C",
				composer: "Wolfgang Amadeus Mozart",
				movement: undefined,
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

	it("preserves the admitted cart when checkout URL retrieval fails", async () => {
		const failureLogger = new CapturingClassCheckoutFailureLogger();
		const rawErrorText = "storefront provider detail";
		const f = await createFixture({
			failureLogger,
			mockStorefront: {
				checkout: async () => {
					throw new Error(rawErrorText);
				},
			},
		});

		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			status: 503,
			code: "checkout_retryable_upstream",
		});

		// The admitted cart remains available for a same-operation retry.
		const intents = (
			f.checkout as unknown as {
				intents: Map<string, { status: string }>;
			}
		).intents;
		const createdIntent = [...intents.values()][0];
		expect(createdIntent).toBeDefined();
		expect(createdIntent?.status).toBe("checkout_started");
		expect(failureLogger.entries[0]).toEqual({
			message: "Class checkout failed.",
			context: expect.objectContaining({
				stage: "checkout_url",
				errorName: "Error",
			}),
		});
		expect(JSON.stringify(failureLogger.entries)).not.toContain(rawErrorText);
	});

	it("preserves the admitted cart when checkout URL verification fails", async () => {
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

		// The admitted cart remains available for a same-operation retry.
		const intents = (
			f.checkout as unknown as {
				intents: Map<string, { status: string }>;
			}
		).intents;
		const createdIntent = [...intents.values()][0];
		expect(createdIntent).toBeDefined();
		expect(createdIntent?.status).toBe("checkout_started");
	});

	it("returns a safe database failure and records SQLSTATE for metadata persistence errors", async () => {
		const failureLogger = new CapturingClassCheckoutFailureLogger();
		const f = await createFixture({ failureLogger });
		const rawErrorText = "database driver detail";
		const databaseError = Object.assign(new Error(rawErrorText), {
			name: "PostgresError",
			code: "ERR_POSTGRES_SERVER_ERROR",
			errno: "22023",
		});

		f.checkout.insertRegistrationMetadata = async () => {
			throw databaseError;
		};

		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			message: "We couldn't save this class registration. Please try again.",
			status: 500,
			code: "checkout_database_failure",
		});

		const intents = (
			f.checkout as unknown as {
				intents: Map<string, { status: string }>;
			}
		).intents;
		const createdIntent = [...intents.values()][0];
		expect(createdIntent).toBeDefined();
		expect(createdIntent?.status).toBe("creating");
		expect(failureLogger.entries).toEqual([
			{
				message: "Class checkout failed.",
				context: expect.objectContaining({
					operation: "checkout.class",
					stage: "registration_metadata",
					organizationId: f.organization.id,
					checkoutIntentId: createdIntent?.id,
					correlationId: expect.any(String),
					lineCount: 1,
					errorName: "PostgresError",
					errorCode: "ERR_POSTGRES_SERVER_ERROR",
					databaseSqlState: "22023",
				}),
			},
		]);
		const loggedContext = failureLogger.entries[0]?.context;
		expect(loggedContext).not.toHaveProperty("errorMessage");
		expect(loggedContext).not.toHaveProperty("errorDetail");
		expect(JSON.stringify(failureLogger.entries)).not.toContain(rawErrorText);
	});

	for (const scenario of [
		{
			name: "has no persisted lines",
			corrupt: () => [],
		},
		{
			name: "has a noncanonical persisted line ID",
			corrupt: (lines: readonly CheckoutIntentLineItemRecord[]) =>
				lines.map((line, index) =>
					index === 0 ? { ...line, id: line.id.toUpperCase() } : line,
				),
		},
		{
			name: "does not match the validated child mapping",
			corrupt: (lines: readonly CheckoutIntentLineItemRecord[]) =>
				lines.map((line, index) =>
					index === 0 ? { ...line, childId: "wrong-child" } : line,
				),
		},
	] as const) {
		it(`fails safely before metadata or cart creation when the durable intent ${scenario.name}`, async () => {
			const f = await createFixture();
			const createCartSpy = spyOn(f.storefront, "createCart");
			const insertMetadataSpy = spyOn(f.checkout, "insertRegistrationMetadata");
			const markFailedSpy = spyOn(f.checkout, "markFailed");
			const originalCreateIntent = f.checkout.createIntent.bind(f.checkout);

			f.checkout.createIntent = async (input) => {
				const outcome = await originalCreateIntent(input);
				if (outcome.kind !== "created") return outcome;
				const corruptedLines = scenario.corrupt(outcome.intent.lines ?? []);
				return {
					...outcome,
					intent: { ...outcome.intent, lines: corruptedLines },
				};
			};

			await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
				status: 503,
				code: "checkout_retryable_upstream",
			});

			expect(createCartSpy).not.toHaveBeenCalled();
			expect(insertMetadataSpy).not.toHaveBeenCalled();
			const intents = (
				f.checkout as unknown as {
					intents: Map<string, { id: string; status: string }>;
				}
			).intents;
			const createdIntent = [...intents.values()][0];
			expect(markFailedSpy).not.toHaveBeenCalled();
			expect(createdIntent.status).toBe("creating");
		});
	}

	it("rejects duplicate durable intent-line IDs rather than mapping by position", () => {
		const checkoutIntentId = "12345678-1234-4234-8234-123456789abc";
		const duplicateLineId = "87654321-1234-4234-8234-123456789abc";
		const lines = [
			{
				id: duplicateLineId,
				checkoutIntentId,
				lineIndex: 0,
			},
			{
				id: duplicateLineId,
				checkoutIntentId,
				lineIndex: 1,
			},
		] as CheckoutIntentLineItemRecord[];
		const expectedLines: ExpectedClassCheckoutIntentLine[] = [
			{
				festivalClassId: "class-1",
				childId: "child-1",
				shopifyProductGid: "gid://shopify/Product/1",
				shopifyVariantGid: "gid://shopify/ProductVariant/1",
				amount: "50.00",
				currencyCode: "USD",
			},
			{
				festivalClassId: "class-2",
				childId: "child-2",
				shopifyProductGid: "gid://shopify/Product/2",
				shopifyVariantGid: "gid://shopify/ProductVariant/2",
				amount: "50.00",
				currencyCode: "USD",
			},
		];

		expect(() =>
			requireClassCheckoutIntentLineMapping(
				{ id: checkoutIntentId, lines },
				expectedLines,
			),
		).toThrow("Checkout intent line persistence");
	});

	it("retries local metadata preparation under the original checkout identity", async () => {
		const f = await createFixture();
		const markFailedSpy = spyOn(f.checkout, "markFailed");
		const prepare = f.checkout.classExecutions.prepare.bind(
			f.checkout.classExecutions,
		);
		f.checkout.classExecutions.prepare = (input) =>
			prepare({
				...input,
				requestSnapshot: {
					...(input.requestSnapshot as Record<string, unknown>),
					integrationVersion: 1,
				},
			});

		const originalInsert = f.checkout.insertRegistrationMetadata.bind(
			f.checkout,
		);
		f.checkout.insertRegistrationMetadata = mock(async () => {
			throw new Error("Database connection failed");
		});

		let thrownError: unknown;
		try {
			await f.service.start(f.defaultInput);
		} catch (error) {
			thrownError = error;
		}

		expect(thrownError).toBeInstanceOf(AppError);
		expect((thrownError as AppError).status).toBe(503);
		expect((thrownError as AppError).code).toBe("checkout_retryable_upstream");

		const intents = (
			f.checkout as unknown as {
				intents: Map<string, { id: string; status: string }>;
			}
		).intents;
		const createdIntent = [...intents.values()][0];
		expect(createdIntent).toBeDefined();
		expect(createdIntent?.status).toBe("creating");
		expect(markFailedSpy).not.toHaveBeenCalled();
		expect(
			await f.checkout.classExecutions.get(
				f.organization.id,
				required(createdIntent).id,
			),
		).toMatchObject({ checkpoint: "prepared", storefrontBinding: null });

		await f.organizations.upsertShopifyIntegration({
			...f.storefrontIntegration,
			encryptedStorefrontPrivateToken: "rotated-storefront-token",
		});
		f.checkout.insertRegistrationMetadata = originalInsert;
		const retryResult = await f.service.start({
			...f.defaultInput,
			idempotencyKey: f.defaultInput.idempotencyKey,
		});
		expect(retryResult.intentId).toBe(required(createdIntent).id);
		expect(retryResult.checkoutUrl).toBe(
			`https://${f.storeDomain}/checkouts/c123`,
		);
		expect(
			await f.checkout.classExecutions.get(
				f.organization.id,
				retryResult.intentId,
			),
		).toMatchObject({
			storefrontBinding: { shopDomain: f.storeDomain, integrationVersion: 2 },
		});
	});

	for (const firstRetry of ["start", "preflightRecovery"] as const) {
		it(`allows a fresh checkout after ${firstRetry} confirms pre-dispatch expiry`, async () => {
			const f = await createFixture();
			const create = spyOn(f.storefront, "createCart");
			const checkout = spyOn(f.storefront, "checkout");
			const integration = spyOn(
				f.organizations,
				"getShopifyIntegration",
			).mockResolvedValueOnce(null);

			await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
				status: 503,
			});
			const intent = required(await f.checkout.findIntentByKey(f.defaultInput));
			const executions = f.checkout.classExecutions;
			expect(await executions.get(f.organization.id, intent.id)).toMatchObject({
				checkpoint: "prepared",
				state: "retryable",
				shopifyCartId: null,
			});
			f.now.setTime(Date.parse(intent.expiresAtIso) + 1);

			const safeRejection = {
				status: 409,
				code: "checkout_pre_dispatch_rejected",
			};
			const preflightInput = { ...f.defaultInput, buyerAccessToken: "" };
			await expect(
				f.service[firstRetry](
					firstRetry === "start" ? f.defaultInput : preflightInput,
				),
			).rejects.toMatchObject(safeRejection);
			await expect(
				f.service.preflightRecovery(preflightInput),
			).rejects.toMatchObject(safeRejection);
			await expect(f.service.start(f.defaultInput)).rejects.toMatchObject(
				safeRejection,
			);
			expect(await executions.get(f.organization.id, intent.id)).toMatchObject({
				checkpoint: "prepared",
				state: "rejected",
				resultCode: "checkout_expired",
				leaseOwner: null,
				shopifyCartId: null,
			});
			expect(await f.checkout.findIntentByKey(f.defaultInput)).toMatchObject({
				status: "superseded",
				cartReference: null,
			});
			expect(create).not.toHaveBeenCalled();
			expect(checkout).not.toHaveBeenCalled();
			expect(integration).toHaveBeenCalledTimes(1);

			await expect(
				f.service.start({
					...f.defaultInput,
					idempotencyKey: crypto.randomUUID(),
				}),
			).resolves.toMatchObject({
				checkoutUrl: `https://${f.storeDomain}/checkouts/c123`,
			});
			expect(create).toHaveBeenCalledTimes(1);
			expect(checkout).toHaveBeenCalledTimes(1);
		});
	}

	it("does not release an expired prepared checkout when its terminal write fails", async () => {
		const f = await createFixture();
		spyOn(f.organizations, "getShopifyIntegration").mockResolvedValueOnce(null);
		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			status: 503,
		});
		const intent = required(await f.checkout.findIntentByKey(f.defaultInput));
		f.now.setTime(Date.parse(intent.expiresAtIso) + 1);
		const executions = f.checkout.classExecutions;
		const transition = executions.transition.bind(executions);
		const failedWrite = spyOn(executions, "transition").mockImplementation(
			async (input) => {
				if (input.state === "rejected") throw new Error("Write unavailable");
				return transition(input);
			},
		);
		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			status: 503,
			code: "checkout_persistence_unavailable",
		});
		failedWrite.mockRestore();
		expect(await executions.get(f.organization.id, intent.id)).toMatchObject({
			checkpoint: "prepared",
			state: "running",
		});
		expect(await f.checkout.findIntentByKey(f.defaultInput)).toMatchObject({
			status: "creating",
		});
	});

	it("keeps a legacy pre-dispatch rejection terminal under a safe result code", async () => {
		const f = await createFixture();
		const create = spyOn(f.storefront, "createCart");
		const originalInsert = f.checkout.insertRegistrationMetadata;
		f.checkout.insertRegistrationMetadata = async () => {
			throw new AppError(
				"Legacy version mismatch",
				409,
				"checkout_integration_changed",
			);
		};
		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			status: 409,
		});
		f.checkout.insertRegistrationMetadata = originalInsert;
		const intent = required(await f.checkout.findIntentByKey(f.defaultInput));
		expect(
			await f.checkout.classExecutions.get(f.organization.id, intent.id),
		).toMatchObject({
			checkpoint: "prepared",
			state: "rejected",
			storefrontBinding: null,
			resultCode: "checkout_integration_changed",
		});
		const replayError = { status: 409, code: "checkout_pre_dispatch_rejected" };
		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject(
			replayError,
		);
		await expect(
			f.service.preflightRecovery(f.defaultInput),
		).rejects.toMatchObject(replayError);
		expect(create).not.toHaveBeenCalled();
	});

	it("keeps the admitted cart retryable when integration changes during URL retrieval", async () => {
		const f = await createFixture();
		const create = spyOn(f.storefront, "createCart");
		const checkout = spyOn(f.storefront, "checkout");
		checkout.mockImplementationOnce(async () => {
			await f.organizations.upsertShopifyIntegration({
				...f.storefrontIntegration,
				encryptedStorefrontPrivateToken: "rotated-storefront-token",
			});
			return { checkoutUrl: `https://${f.storeDomain}/checkouts/stale` };
		});

		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			status: 503,
			code: "checkout_retryable_upstream",
		});

		const intent = required(await f.checkout.findIntentByKey(f.defaultInput));
		expect(intent.status).toBe("checkout_started");
		const record = required(
			await f.checkout.classExecutions.get(f.organization.id, intent.id),
		);
		expect(record).toMatchObject({
			checkpoint: "attached",
			state: "retryable",
			storefrontBinding: { shopDomain: f.storeDomain, integrationVersion: 1 },
		});
		f.storefront.inspectCart = async () =>
			cartEvidence(intent, f.customer.shopifyCustomerGid);
		const inspect = spyOn(f.storefront, "inspectCart");
		const binding = { shopDomain: f.storeDomain, integrationVersion: 2 };
		await expect(f.service.start(f.defaultInput)).resolves.toMatchObject({
			intentId: intent.id,
			checkoutUrl: `https://${f.storeDomain}/checkouts/c123`,
		});
		expect(inspect).toHaveBeenCalledWith({
			organizationId: f.organization.id,
			shopifyCartId: record.shopifyCartId,
			expectedStorefrontBinding: binding,
		});
		expect(checkout).toHaveBeenLastCalledWith({
			organizationId: f.organization.id,
			shopifyCartId: record.shopifyCartId,
			expectedStorefrontBinding: binding,
		});
		expect(create).toHaveBeenCalledTimes(1);
	});

	it("fails with 404 when organization is not found", async () => {
		const f = await createFixture();
		spyOn(f.organizations, "findOrganizationById").mockResolvedValue(null);

		await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
			message: "Organization was not found.",
			status: 404,
		});
	});

	it("uses organization defaultCurrencyCode and passes it to createIntent and createCart", async () => {
		let capturedCartInput: unknown;
		const f = await createFixture({
			defaultCurrencyCode: "CAD",
			mockStorefront: {
				createCart: async (input) => {
					capturedCartInput = input;
					return { shopifyCartId: "gid://shopify/Cart/cad-cart" };
				},
			},
		});

		const result = await f.service.start(f.defaultInput);
		expect(result).toBeDefined();

		const stored = await f.checkout.findIntentByCorrelation(
			f.organization.id,
			result.correlationId,
		);
		expect(stored?.currencyCode).toBe("CAD");
		expect(capturedCartInput).toMatchObject({
			currencyCode: "CAD",
		});
	});

	it("falls back to USD when organization defaultCurrencyCode is empty", async () => {
		let capturedCartInput: unknown;
		const f = await createFixture({
			mockStorefront: {
				createCart: async (input) => {
					capturedCartInput = input;
					return { shopifyCartId: "gid://shopify/Cart/fallback-cart" };
				},
			},
		});
		spyOn(f.organizations, "findOrganizationById").mockResolvedValue({
			...f.organization,
			defaultCurrencyCode: "",
		});

		const result = await f.service.start(f.defaultInput);
		expect(result).toBeDefined();

		const stored = await f.checkout.findIntentByCorrelation(
			f.organization.id,
			result.correlationId,
		);
		expect(stored?.currencyCode).toBe("USD");
		expect(capturedCartInput).toMatchObject({
			currencyCode: "USD",
		});
	});

	it("successfully creates a multi-line checkout intent and cart with multiple line items", async () => {
		const f = await createFixture();
		const festivalId = f.festival?.id ?? "";

		const secondSubtype = await f.organizations.createRegistrationCatalogValue({
			organizationId: f.organization.id,
			kind: "class_subtype",
			displayName: "Violin Solo",
			normalizedName: "violin solo",
		});
		const secondClass = await f.organizations.createFestivalClassConfiguration({
			organizationId: f.organization.id,
			festivalId,
			displayName: "Junior Violin Level 1",
			classSubtypeId: secondSubtype.id,
			divisionId: f.division.id,
			minimumAge: 8,
			maximumAge: 12,
			price: "55.00",
			maximumPerformancePieces: 2,
			performanceMinutes: 10,
			capacity: 20,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/101",
			shopifyVariantGid: "gid://shopify/ProductVariant/201",
		});

		const secondChild = await f.customers.createChild({
			organizationId: f.organization.id,
			parentCustomerId: f.customer.id,
			displayName: "Bob Smith",
		});
		await f.customers.createChildAgeSnapshot({
			organizationId: f.organization.id,
			childId: secondChild.id,
			age: 11,
			validUntilIso: new Date(
				f.now.getTime() + 90 * 24 * 3600_000,
			).toISOString(),
			createdAtIso: f.now.toISOString(),
		});

		let capturedCartInput: unknown;
		f.storefront.createCart = async (input) => {
			capturedCartInput = input;
			return { shopifyCartId: "gid://shopify/Cart/multi-cart-1" };
		};
		const insertMetadataSpy = spyOn(f.checkout, "insertRegistrationMetadata");
		const scopedLookup = spyOn(
			f.organizations,
			"findActiveFestivalClassByShortName",
		);

		const result = await f.service.start({
			organizationId: f.organization.id,
			festivalShortName: "pnw2026",
			customerId: f.customer.id,
			sessionId: f.session.sessionId,
			idempotencyKey: "22222222-3333-4444-5555-666666666666",
			buyerAccessToken: "buyer-token-test",
			lineItems: [
				{
					festivalClassId: f.classConfig.id,
					childId: f.child.id,
					teacherId: f.teacherId,
					pieces: f.defaultPieces,
				},
				{
					festivalClassId: secondClass.id,
					childId: secondChild.id,
					teacherId: f.teacherId,
					pieces: [
						{
							title: "Violin Partita No. 2",
							composer: "J.S. Bach",
							durationSeconds: 240,
						},
					],
				},
			],
		});

		expect(result.checkoutUrl).toBe(`https://${f.storeDomain}/checkouts/c123`);
		expect(result.intent?.lines).toHaveLength(2);
		expect(scopedLookup).toHaveBeenCalledTimes(2);
		expect(result.intent?.amount).toBe("100.00");

		const [line1, line2] = result.intent?.lines ?? [];
		expect(line1.festivalClassId).toBe(f.classConfig.id);
		expect(line1.childId).toBe(f.child.id);
		expect(line1.amount).toBe("45.00");
		expect(line2.festivalClassId).toBe(secondClass.id);
		expect(line2.childId).toBe(secondChild.id);
		expect(line2.amount).toBe("55.00");

		const cartInput = capturedCartInput as {
			lines: Array<{
				merchandiseId: string;
				quantity: number;
				attributes?: Array<{ key: string; value: string }>;
			}>;
		};
		expect(cartInput.lines).toHaveLength(2);
		expect(cartInput.lines[0].merchandiseId).toBe(
			"gid://shopify/ProductVariant/200",
		);
		expect(cartInput.lines[0].attributes?.[0].key).toBe(
			CHECKOUT_INTENT_LINE_ID_ATTRIBUTE_KEY,
		);
		expect(cartInput.lines[0].attributes?.[0].value).toBe(line1.id);
		expect(cartInput.lines[1].merchandiseId).toBe(
			"gid://shopify/ProductVariant/201",
		);
		expect(cartInput.lines[1].attributes?.[0].key).toBe(
			CHECKOUT_INTENT_LINE_ID_ATTRIBUTE_KEY,
		);
		expect(cartInput.lines[1].attributes?.[0].value).toBe(line2.id);
		expect(insertMetadataSpy).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ checkoutIntentLineId: line1.id }),
		);
		expect(insertMetadataSpy).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ checkoutIntentLineId: line2.id }),
		);
	});

	it("rejects named multi-line checkout when normalized short names match different festivals", async () => {
		const f = await createFixture();
		const otherFestival = await f.organizations.createFestival({
			id: "fest-short-name-collision",
			organizationId: f.organization.id,
			code: "PNW2026ALT",
			shortName: " PNW2026 ",
			name: "Other PNW Festival 2026",
			startDate: "2026-12-01",
			endDate: "2026-12-10",
		});
		const otherClass = await f.organizations.createFestivalClassConfiguration({
			organizationId: f.organization.id,
			festivalId: otherFestival.id,
			displayName: "Other Junior Solo Piano",
			classSubtypeId: f.classConfig.classSubtypeId,
			divisionId: f.division.id,
			minimumAge: 8,
			maximumAge: 12,
			price: "45.00",
			maximumPerformancePieces: 2,
			performanceMinutes: 10,
			capacity: 25,
			isActive: true,
		});
		const createIntent = spyOn(f.checkout, "createIntent");
		const createCart = spyOn(f.storefront, "createCart");
		const insertMetadata = spyOn(f.checkout, "insertRegistrationMetadata");

		await expect(
			f.service.start({
				...f.defaultInput,
				festivalShortName: "pnw2026",
				lineItems: [
					{
						festivalClassId: f.classConfig.id,
						childId: f.child.id,
						teacherId: f.teacherId,
						pieces: f.defaultPieces,
					},
					{
						festivalClassId: otherClass.id,
						childId: f.child.id,
						teacherId: f.teacherId,
						pieces: f.defaultPieces,
					},
				],
			}),
		).rejects.toMatchObject({
			status: 404,
			message: "Festival class configuration not found.",
		});
		expect(createIntent).not.toHaveBeenCalled();
		expect(createCart).not.toHaveBeenCalled();
		expect(insertMetadata).not.toHaveBeenCalled();
	});

	it("rejects multi-line checkout when lineItems is empty with 400", async () => {
		const f = await createFixture();
		await expect(
			f.service.start({
				...f.defaultInput,
				lineItems: [],
			}),
		).rejects.toMatchObject({
			status: 400,
			message: "Class checkout requires at least one line item.",
		});
	});

	it("rejects multi-line checkout when child age on second line is outside allowed range", async () => {
		const f = await createFixture();
		const secondChild = await f.customers.createChild({
			organizationId: f.organization.id,
			parentCustomerId: f.customer.id,
			displayName: "Older Child",
		});
		await f.customers.createChildAgeSnapshot({
			organizationId: f.organization.id,
			childId: secondChild.id,
			age: 15,
			validUntilIso: new Date(
				f.now.getTime() + 90 * 24 * 3600_000,
			).toISOString(),
			createdAtIso: f.now.toISOString(),
		});

		await expect(
			f.service.start({
				organizationId: f.organization.id,
				customerId: f.customer.id,
				sessionId: f.session.sessionId,
				idempotencyKey: "33333333-4444-5555-6666-777777777777",
				buyerAccessToken: "buyer-token-test",
				lineItems: [
					{
						festivalClassId: f.classConfig.id,
						childId: f.child.id,
						teacherId: f.teacherId,
						pieces: f.defaultPieces,
					},
					{
						festivalClassId: f.classConfig.id,
						childId: secondChild.id,
						teacherId: f.teacherId,
						pieces: f.defaultPieces,
					},
				],
			}),
		).rejects.toMatchObject({
			status: 400,
			message: "Child age (15) is outside the allowed range of [8, 12].",
		});
	});

	it("preserves the operation when metadata preparation fails on the second line", async () => {
		const f = await createFixture();
		const secondChild = await f.customers.createChild({
			organizationId: f.organization.id,
			parentCustomerId: f.customer.id,
			displayName: "Second Child",
		});
		await f.customers.createChildAgeSnapshot({
			organizationId: f.organization.id,
			childId: secondChild.id,
			age: 10,
			validUntilIso: new Date(
				f.now.getTime() + 90 * 24 * 3600_000,
			).toISOString(),
			createdAtIso: f.now.toISOString(),
		});

		let callCount = 0;
		const originalInsert = f.checkout.insertRegistrationMetadata.bind(
			f.checkout,
		);
		f.checkout.insertRegistrationMetadata = async (params) => {
			callCount++;
			if (callCount === 2) {
				throw new Error("Database error on metadata insert");
			}
			return originalInsert(params);
		};

		await expect(
			f.service.start({
				organizationId: f.organization.id,
				customerId: f.customer.id,
				sessionId: f.session.sessionId,
				idempotencyKey: "44444444-5555-6666-7777-888888888888",
				buyerAccessToken: "buyer-token-test",
				lineItems: [
					{
						festivalClassId: f.classConfig.id,
						childId: f.child.id,
						teacherId: f.teacherId,
						pieces: f.defaultPieces,
					},
					{
						festivalClassId: f.classConfig.id,
						childId: secondChild.id,
						teacherId: f.teacherId,
						pieces: f.defaultPieces,
					},
				],
			}),
		).rejects.toMatchObject({
			status: 503,
			code: "checkout_retryable_upstream",
		});

		const intents = (
			f.checkout as unknown as {
				intents: Map<string, { status: string }>;
			}
		).intents;
		const createdIntent = [...intents.values()][0];
		expect(createdIntent?.status).toBe("creating");
	});

	it("evaluateEligibility evaluates proposed items successfully when prerequisites are met", async () => {
		const f = await createFixture();
		const response = await f.service.evaluateEligibility({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			festivalId: f.festival?.id ?? "",
			items: [
				{
					childId: f.child.id,
					festivalClassId: f.classConfig.id,
				},
			],
		});

		expect(response.isEligible).toBe(true);
		expect(response.results).toHaveLength(1);
		expect(response.results[0].reasonCode).toBe("AVAILABLE");
	});

	it("evaluateEligibility returns MISSING_PREREQUISITE when subtype dependency is not satisfied", async () => {
		const f = await createFixture();
		const festivalId = f.festival?.id ?? "";
		const prerequisiteSubtype =
			await f.organizations.createRegistrationCatalogValue({
				organizationId: f.organization.id,
				kind: "class_subtype",
				displayName: "Prerequisite Solo",
				normalizedName: "prerequisite solo",
			});
		const masterclassSubtype =
			await f.organizations.createRegistrationCatalogValue({
				organizationId: f.organization.id,
				kind: "class_subtype",
				displayName: "Masterclass",
				normalizedName: "masterclass",
				requiredSubtypeId: prerequisiteSubtype.id,
			});
		const masterclassClass =
			await f.organizations.createFestivalClassConfiguration({
				organizationId: f.organization.id,
				festivalId,
				displayName: "Masterclass Piano",
				classSubtypeId: masterclassSubtype.id,
				divisionId: f.division.id,
				minimumAge: 8,
				maximumAge: 12,
				price: "60.00",
				maximumPerformancePieces: 1,
				performanceMinutes: 15,
				capacity: 10,
				isActive: true,
				shopifyProductGid: "gid://shopify/Product/102",
				shopifyVariantGid: "gid://shopify/ProductVariant/202",
			});

		const response = await f.service.evaluateEligibility({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			festivalId,
			items: [
				{
					childId: f.child.id,
					festivalClassId: masterclassClass.id,
				},
			],
		});

		expect(response.isEligible).toBe(false);
		expect(response.results[0].reasonCode).toBe("MISSING_PREREQUISITE");
		expect(response.results[0].dependencyDescriptor?.requiredSubtypeId).toBe(
			prerequisiteSubtype.id,
		);
	});

	it("evaluateEligibility resolves prerequisite satisfied by another item in the same batch", async () => {
		const f = await createFixture();
		const festivalId = f.festival?.id ?? "";
		const prerequisiteSubtype =
			await f.organizations.createRegistrationCatalogValue({
				organizationId: f.organization.id,
				kind: "class_subtype",
				displayName: "Prerequisite Solo",
				normalizedName: "prerequisite solo",
			});
		const prerequisiteClass =
			await f.organizations.createFestivalClassConfiguration({
				organizationId: f.organization.id,
				festivalId,
				displayName: "Solo Piano Qualifying",
				classSubtypeId: prerequisiteSubtype.id,
				divisionId: f.division.id,
				minimumAge: 8,
				maximumAge: 12,
				price: "50.00",
				maximumPerformancePieces: 2,
				performanceMinutes: 10,
				capacity: 10,
				isActive: true,
				shopifyProductGid: "gid://shopify/Product/103",
				shopifyVariantGid: "gid://shopify/ProductVariant/203",
			});
		const masterclassSubtype =
			await f.organizations.createRegistrationCatalogValue({
				organizationId: f.organization.id,
				kind: "class_subtype",
				displayName: "Masterclass",
				normalizedName: "masterclass",
				requiredSubtypeId: prerequisiteSubtype.id,
			});
		const masterclassClass =
			await f.organizations.createFestivalClassConfiguration({
				organizationId: f.organization.id,
				festivalId,
				displayName: "Masterclass Piano",
				classSubtypeId: masterclassSubtype.id,
				divisionId: f.division.id,
				minimumAge: 8,
				maximumAge: 12,
				price: "60.00",
				maximumPerformancePieces: 1,
				performanceMinutes: 15,
				capacity: 10,
				isActive: true,
				shopifyProductGid: "gid://shopify/Product/104",
				shopifyVariantGid: "gid://shopify/ProductVariant/204",
			});

		const response = await f.service.evaluateEligibility({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			festivalId,
			items: [
				{
					childId: f.child.id,
					festivalClassId: prerequisiteClass.id,
				},
				{
					childId: f.child.id,
					festivalClassId: masterclassClass.id,
				},
			],
		});

		expect(response.isEligible).toBe(true);
		expect(response.results[0].reasonCode).toBe("AVAILABLE");
		expect(response.results[1].reasonCode).toBe("AVAILABLE");
	});

	it("evaluateEligibility detects duplicate registration for same child in same class in batch", async () => {
		const f = await createFixture();
		const response = await f.service.evaluateEligibility({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			festivalId: f.festival?.id ?? "",
			items: [
				{
					childId: f.child.id,
					festivalClassId: f.classConfig.id,
				},
				{
					childId: f.child.id,
					festivalClassId: f.classConfig.id,
				},
			],
		});

		expect(response.isEligible).toBe(false);
		expect(response.results[1].reasonCode).toBe("ALREADY_REGISTERED");
	});

	it("evaluateEligibility successfully evaluates when all children belong to authenticated customer", async () => {
		const f = await createFixture();
		const secondChild = await f.customers.createChild({
			organizationId: f.organization.id,
			parentCustomerId: f.customer.id,
			displayName: "Bob Smith",
		});
		const response = await f.service.evaluateEligibility({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			festivalId: f.festival?.id ?? "",
			items: [
				{
					childId: f.child.id,
					festivalClassId: f.classConfig.id,
				},
				{
					childId: secondChild.id,
					festivalClassId: f.classConfig.id,
				},
			],
		});

		expect(response.isEligible).toBe(true);
		expect(response.results).toHaveLength(2);
		expect(response.results[0].reasonCode).toBe("AVAILABLE");
		expect(response.results[1].reasonCode).toBe("AVAILABLE");
	});

	it("evaluateEligibility rejects with HTTP 404 Child not found when child belongs to another customer (IDOR prevention)", async () => {
		const f = await createFixture();
		const { customer: otherCustomer } = await f.customers.createCustomerSession(
			{
				sessionId: "session-other-parent",
				organizationId: f.organization.id,
				shopifyCustomerGid: "gid://shopify/Customer/888",
				encryptedTokens: "encrypted-tokens",
				csrfToken: "csrf-token-other",
				integrationVersion: 1,
				createdAtIso: new Date().toISOString(),
				lastSeenAtIso: new Date().toISOString(),
				expiresAtIso: new Date(Date.now() + 3600_000).toISOString(),
			},
		);
		const otherChild = await f.customers.createChild({
			organizationId: f.organization.id,
			parentCustomerId: otherCustomer.id,
			displayName: "Charlie Other",
		});

		let entitlementsQueried = false;
		if (f.commerce) {
			const originalList = f.commerce.listClassEntitlements.bind(f.commerce);
			f.commerce.listClassEntitlements = async (...args) => {
				entitlementsQueried = true;
				return originalList(...args);
			};
		}

		let caughtError: unknown;
		try {
			await f.service.evaluateEligibility({
				organizationId: f.organization.id,
				customerId: f.customer.id,
				festivalId: f.festival?.id ?? "",
				items: [
					{
						childId: otherChild.id,
						festivalClassId: f.classConfig.id,
					},
				],
			});
		} catch (err) {
			caughtError = err;
		}

		expect(caughtError).toBeInstanceOf(AppError);
		const appErr = caughtError as AppError;
		expect(appErr.status).toBe(404);
		expect(appErr.message).toBe("Child not found.");
		expect(entitlementsQueried).toBe(false);
	});

	it("evaluateEligibility rejects with HTTP 404 Child not found when child does not exist", async () => {
		const f = await createFixture();
		let caughtError: unknown;
		try {
			await f.service.evaluateEligibility({
				organizationId: f.organization.id,
				customerId: f.customer.id,
				festivalId: f.festival?.id ?? "",
				items: [
					{
						childId: "nonexistent-child-id",
						festivalClassId: f.classConfig.id,
					},
				],
			});
		} catch (err) {
			caughtError = err;
		}

		expect(caughtError).toBeInstanceOf(AppError);
		const appErr = caughtError as AppError;
		expect(appErr.status).toBe(404);
		expect(appErr.message).toBe("Child not found.");
	});

	it("evaluateEligibility fails closed with 404 and does not evaluate when 1 child is owned and 1 is unowned in multi-line request", async () => {
		const f = await createFixture();
		const { customer: otherCustomer } = await f.customers.createCustomerSession(
			{
				sessionId: "session-other-parent-2",
				organizationId: f.organization.id,
				shopifyCustomerGid: "gid://shopify/Customer/777",
				encryptedTokens: "encrypted-tokens",
				csrfToken: "csrf-token-other-2",
				integrationVersion: 1,
				createdAtIso: new Date().toISOString(),
				lastSeenAtIso: new Date().toISOString(),
				expiresAtIso: new Date(Date.now() + 3600_000).toISOString(),
			},
		);
		const otherChild = await f.customers.createChild({
			organizationId: f.organization.id,
			parentCustomerId: otherCustomer.id,
			displayName: "Daisy Other",
		});

		let entitlementsQueried = false;
		if (f.commerce) {
			const originalList = f.commerce.listClassEntitlements.bind(f.commerce);
			f.commerce.listClassEntitlements = async (...args) => {
				entitlementsQueried = true;
				return originalList(...args);
			};
		}

		let caughtError: unknown;
		try {
			await f.service.evaluateEligibility({
				organizationId: f.organization.id,
				customerId: f.customer.id,
				festivalId: f.festival?.id ?? "",
				items: [
					{
						childId: f.child.id,
						festivalClassId: f.classConfig.id,
					},
					{
						childId: otherChild.id,
						festivalClassId: f.classConfig.id,
					},
				],
			});
		} catch (err) {
			caughtError = err;
		}

		expect(caughtError).toBeInstanceOf(AppError);
		const appErr = caughtError as AppError;
		expect(appErr.status).toBe(404);
		expect(appErr.message).toBe("Child not found.");
		expect(entitlementsQueried).toBe(false);
	});

	it("start(...) rejects with 400 and missing_prerequisite when eligibility check fails", async () => {
		const f = await createFixture();
		const festivalId = f.festival?.id ?? "";
		const prerequisiteSubtype =
			await f.organizations.createRegistrationCatalogValue({
				organizationId: f.organization.id,
				kind: "class_subtype",
				displayName: "Required Subtype",
				normalizedName: "required subtype",
			});
		const masterclassSubtype =
			await f.organizations.createRegistrationCatalogValue({
				organizationId: f.organization.id,
				kind: "class_subtype",
				displayName: "Dependent Masterclass",
				normalizedName: "dependent masterclass",
				requiredSubtypeId: prerequisiteSubtype.id,
			});
		const masterclassClass =
			await f.organizations.createFestivalClassConfiguration({
				organizationId: f.organization.id,
				festivalId,
				displayName: "Dependent Masterclass Class",
				classSubtypeId: masterclassSubtype.id,
				divisionId: f.division.id,
				minimumAge: 8,
				maximumAge: 12,
				price: "60.00",
				maximumPerformancePieces: 1,
				performanceMinutes: 15,
				capacity: 10,
				isActive: true,
				shopifyProductGid: "gid://shopify/Product/105",
				shopifyVariantGid: "gid://shopify/ProductVariant/205",
			});

		await expect(
			f.service.start({
				...f.defaultInput,
				festivalClassId: masterclassClass.id,
			}),
		).rejects.toMatchObject({
			status: 400,
			code: "missing_prerequisite",
		});
	});

	it("start(...) rejects with 400 and already_registered when batch has duplicate registrations for same child", async () => {
		const f = await createFixture();
		await expect(
			f.service.start({
				organizationId: f.organization.id,
				customerId: f.customer.id,
				sessionId: f.session.sessionId,
				idempotencyKey: "55555555-6666-7777-8888-999999999999",
				buyerAccessToken: "buyer-token-test",
				lineItems: [
					{
						festivalClassId: f.classConfig.id,
						childId: f.child.id,
						teacherId: f.teacherId,
						pieces: f.defaultPieces,
					},
					{
						festivalClassId: f.classConfig.id,
						childId: f.child.id,
						teacherId: f.teacherId,
						pieces: f.defaultPieces,
					},
				],
			}),
		).rejects.toMatchObject({
			status: 400,
			code: "already_registered",
		});
	});

	it("start(...) rejects with 400 and blocks checkout when candidate-marked checkout line is missing prerequisite", async () => {
		const f = await createFixture();
		const festivalId = f.festival?.id ?? "";
		const prerequisiteSubtype =
			await f.organizations.createRegistrationCatalogValue({
				organizationId: f.organization.id,
				kind: "class_subtype",
				displayName: "Prerequisite Solo Subtype",
				normalizedName: "prerequisite solo subtype",
			});
		const masterclassSubtype =
			await f.organizations.createRegistrationCatalogValue({
				organizationId: f.organization.id,
				kind: "class_subtype",
				displayName: "Dependent Masterclass Subtype",
				normalizedName: "dependent masterclass subtype",
				requiredSubtypeId: prerequisiteSubtype.id,
			});
		const masterclassClass =
			await f.organizations.createFestivalClassConfiguration({
				organizationId: f.organization.id,
				festivalId,
				displayName: "Dependent Masterclass Class",
				classSubtypeId: masterclassSubtype.id,
				divisionId: f.division.id,
				minimumAge: 8,
				maximumAge: 12,
				price: "75.00",
				maximumPerformancePieces: 1,
				performanceMinutes: 15,
				capacity: 10,
				isActive: true,
				shopifyProductGid: "gid://shopify/Product/108",
				shopifyVariantGid: "gid://shopify/ProductVariant/208",
			});

		const secondChild = await f.customers.createChild({
			organizationId: f.organization.id,
			parentCustomerId: f.customer.id,
			displayName: "Second Performer",
		});
		await f.customers.createChildAgeSnapshot({
			organizationId: f.organization.id,
			childId: secondChild.id,
			asOfDate: "2026-03-01",
			age: 10,
		});

		const idempotencyKey = "77777777-8888-9999-aaaa-bbbbbbbbbbbb";
		await expect(
			f.service.start({
				organizationId: f.organization.id,
				customerId: f.customer.id,
				sessionId: f.session.sessionId,
				idempotencyKey,
				buyerAccessToken: "buyer-token-test",
				lineItems: [
					{
						festivalClassId: f.classConfig.id,
						childId: f.child.id,
						teacherId: f.teacherId,
						pieces: f.defaultPieces,
					},
					{
						id: "candidate:masterclass",
						festivalClassId: masterclassClass.id,
						childId: secondChild.id,
						teacherId: f.teacherId,
						pieces: f.defaultPieces,
						isCandidate: true,
					} as unknown as ClassCheckoutLineItemInput,
				],
			}),
		).rejects.toMatchObject({
			status: 400,
			code: "missing_prerequisite",
		});

		const outcome = await f.checkout.getOutcome({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			sessionId: f.session.sessionId,
			idempotencyKey,
		});
		expect(outcome).toBeNull();
	});

	it("start(...) strips candidate markers and evaluates complete cart normally", async () => {
		const f = await createFixture();
		const festivalId = f.festival?.id ?? "";
		const prerequisiteSubtype =
			await f.organizations.createRegistrationCatalogValue({
				organizationId: f.organization.id,
				kind: "class_subtype",
				displayName: "Solo Subtype",
				normalizedName: "solo subtype",
			});
		const dependentSubtype =
			await f.organizations.createRegistrationCatalogValue({
				organizationId: f.organization.id,
				kind: "class_subtype",
				displayName: "Concerto Subtype",
				normalizedName: "concerto subtype",
				requiredSubtypeId: prerequisiteSubtype.id,
			});
		const soloClass = await f.organizations.createFestivalClassConfiguration({
			organizationId: f.organization.id,
			festivalId,
			displayName: "Solo Piano Class",
			classSubtypeId: prerequisiteSubtype.id,
			divisionId: f.division.id,
			minimumAge: 8,
			maximumAge: 12,
			price: "50.00",
			maximumPerformancePieces: 1,
			performanceMinutes: 10,
			capacity: 10,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/109",
			shopifyVariantGid: "gid://shopify/ProductVariant/209",
		});
		const concertoClass =
			await f.organizations.createFestivalClassConfiguration({
				organizationId: f.organization.id,
				festivalId,
				displayName: "Concerto Piano Class",
				classSubtypeId: dependentSubtype.id,
				divisionId: f.division.id,
				minimumAge: 8,
				maximumAge: 12,
				price: "75.00",
				maximumPerformancePieces: 1,
				performanceMinutes: 15,
				capacity: 10,
				isActive: true,
				shopifyProductGid: "gid://shopify/Product/110",
				shopifyVariantGid: "gid://shopify/ProductVariant/210",
			});

		const idempotencyKey = "88888888-9999-aaaa-bbbb-cccccccccccc";
		const result = await f.service.start({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			sessionId: f.session.sessionId,
			idempotencyKey,
			buyerAccessToken: "buyer-token-test",
			lineItems: [
				{
					festivalClassId: soloClass.id,
					childId: f.child.id,
					teacherId: f.teacherId,
					pieces: f.defaultPieces,
				},
				{
					id: "candidate:concerto",
					festivalClassId: concertoClass.id,
					childId: f.child.id,
					teacherId: f.teacherId,
					pieces: f.defaultPieces,
					isCandidate: true,
				} as unknown as ClassCheckoutLineItemInput,
			],
		});

		expect(result.checkoutUrl).toBeDefined();
		expect(result.intent?.lines).toHaveLength(2);
		expect(result.intent?.lines?.[0].festivalClassId).toBe(soloClass.id);
		expect(result.intent?.lines?.[1].festivalClassId).toBe(concertoClass.id);
	});

	it("start() and evaluateEligibility() never call broad list methods", async () => {
		const f = await createFixture();
		const listChildrenSpy = spyOn(
			f.customers,
			"listChildren",
		).mockRejectedValue(new Error("listChildren should not be called"));
		const listChildAgeSnapshotsSpy = spyOn(
			f.customers,
			"listChildAgeSnapshots",
		).mockRejectedValue(
			new Error("listChildAgeSnapshots should not be called"),
		);
		const listEntitlementGrantSnapshotsSpy = spyOn(
			f.organizations,
			"listEntitlementGrantSnapshots",
		).mockRejectedValue(
			new Error("listEntitlementGrantSnapshots should not be called"),
		);
		const listAccompanistMembershipGrantsSpy = spyOn(
			f.organizations,
			"listAccompanistMembershipGrants",
		).mockRejectedValue(
			new Error("listAccompanistMembershipGrants should not be called"),
		);
		const listFestivalClassConfigurationsSpy = spyOn(
			f.organizations,
			"listFestivalClassConfigurations",
		).mockRejectedValue(
			new Error("listFestivalClassConfigurations should not be called"),
		);

		const eligibility = await f.service.evaluateEligibility({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			festivalId: f.festival?.id ?? "",
			items: [
				{
					childId: f.child.id,
					festivalClassId: f.classConfig.id,
				},
			],
		});
		expect(eligibility.isEligible).toBe(true);

		const startResult = await f.service.start({
			...f.defaultInput,
			accompanistId: f.accompanistId,
		});
		expect(startResult.checkoutUrl).toBeDefined();

		expect(listChildrenSpy).not.toHaveBeenCalled();
		expect(listChildAgeSnapshotsSpy).not.toHaveBeenCalled();
		expect(listEntitlementGrantSnapshotsSpy).not.toHaveBeenCalled();
		expect(listAccompanistMembershipGrantsSpy).not.toHaveBeenCalled();
		expect(listFestivalClassConfigurationsSpy).not.toHaveBeenCalled();
	});

	it("loads 25 advisory candidates with one targeted class query and preserves duplicate results", async () => {
		const f = await createFixture();
		const festivalId = f.festival?.id ?? "";
		const template = await f.organizations.findFestivalClassConfigurationById(
			f.organization.id,
			festivalId,
			f.classConfig.id,
		);
		if (!template) throw new Error("Fixture class not found.");
		const {
			id: _id,
			createdAtIso: _createdAt,
			updatedAtIso: _updatedAt,
			...input
		} = template;
		const classIds = [f.classConfig.id];
		for (let index = 1; index < 25; index++) {
			const config = await f.organizations.createFestivalClassConfiguration({
				...input,
				displayName: `Candidate ${index}`,
			});
			classIds.push(config.id);
		}
		const individualLookup = spyOn(
			f.organizations,
			"findFestivalClassConfigurationById",
		);
		const bulkLookup = spyOn(
			f.organizations,
			"findFestivalClassConfigurationsByIds",
		);
		const items = classIds.map((festivalClassId) => ({
			childId: f.child.id,
			festivalClassId,
			isCandidate: true,
		}));
		const response = await f.service.evaluateEligibility({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			festivalId,
			items,
		});
		expect(response.results).toHaveLength(25);
		expect(
			response.results.every((result) => result.reasonCode === "AVAILABLE"),
		).toBe(true);
		expect(bulkLookup).toHaveBeenCalledTimes(1);
		expect(bulkLookup).toHaveBeenCalledWith(
			f.organization.id,
			festivalId,
			classIds,
		);
		expect(individualLookup).not.toHaveBeenCalled();

		bulkLookup.mockClear();
		const duplicate = await f.service.evaluateEligibility({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			festivalId,
			items: [items[0], items[0]].map(
				({ isCandidate: _candidate, ...item }) => item,
			),
		});
		expect(duplicate.results.map((result) => result.reasonCode)).toEqual([
			"AVAILABLE",
			"ALREADY_REGISTERED",
		]);
		expect(bulkLookup).toHaveBeenCalledTimes(1);
		expect(bulkLookup).toHaveBeenCalledWith(f.organization.id, festivalId, [
			classIds[0],
		]);
	});

	it("multi-line start() deduplicates child, age snapshot, teacher grant, accompanist grant, and class configuration lookups across lines and checkEligibility", async () => {
		const f = await createFixture();
		const festivalId = f.festival?.id ?? "";
		const secondSubtype = await f.organizations.createRegistrationCatalogValue({
			organizationId: f.organization.id,
			kind: "class_subtype",
			displayName: "Duet Piano",
			normalizedName: "duet piano",
		});
		const secondClass = await f.organizations.createFestivalClassConfiguration({
			organizationId: f.organization.id,
			festivalId,
			displayName: "Junior Duet Piano Level 1",
			classSubtypeId: secondSubtype.id,
			divisionId: f.division.id,
			minimumAge: 8,
			maximumAge: 12,
			price: "55.00",
			maximumPerformancePieces: 2,
			performanceMinutes: 10,
			capacity: 25,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/111",
			shopifyVariantGid: "gid://shopify/ProductVariant/211",
		});

		const findChildSpy = spyOn(f.customers, "findChild");
		const findActiveChildAgeSnapshotSpy = spyOn(
			f.customers,
			"findActiveChildAgeSnapshot",
		);
		const findActiveTeacherEntitlementGrantSpy = spyOn(
			f.organizations,
			"findActiveTeacherEntitlementGrant",
		);
		const findCurrentAccompanistMembershipGrantSpy = spyOn(
			f.organizations,
			"findCurrentAccompanistMembershipGrant",
		);
		const findFestivalClassConfigurationByIdSpy = spyOn(
			f.organizations,
			"findFestivalClassConfigurationById",
		);
		const bulkClassLookup = spyOn(
			f.organizations,
			"findFestivalClassConfigurationsByIds",
		);

		const result = await f.service.start({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			sessionId: f.session.sessionId,
			idempotencyKey: "99999999-aaaa-bbbb-cccc-dddddddddddd",
			buyerAccessToken: "buyer-token-test",
			lineItems: [
				{
					festivalClassId: f.classConfig.id,
					childId: f.child.id,
					teacherId: f.teacherId,
					accompanistId: f.accompanistId,
					pieces: f.defaultPieces,
				},
				{
					festivalClassId: secondClass.id,
					childId: f.child.id,
					teacherId: f.teacherId,
					accompanistId: f.accompanistId,
					pieces: f.defaultPieces,
				},
			],
		});

		expect(result.checkoutUrl).toBeDefined();
		expect(findChildSpy).toHaveBeenCalledTimes(1);
		expect(findActiveChildAgeSnapshotSpy).toHaveBeenCalledTimes(1);
		expect(findActiveTeacherEntitlementGrantSpy).toHaveBeenCalledTimes(1);
		expect(findCurrentAccompanistMembershipGrantSpy).toHaveBeenCalledTimes(1);
		expect(findFestivalClassConfigurationByIdSpy).toHaveBeenCalledTimes(2);
		expect(bulkClassLookup).toHaveBeenCalledTimes(1);
		expect(bulkClassLookup).toHaveBeenCalledWith(
			f.organization.id,
			festivalId,
			[f.classConfig.id, secondClass.id],
		);
	});

	it("start() deterministically selects earliest active teacher grant and preserves teacherEntitlementId in registration metadata", async () => {
		const f = await createFixture();
		const internalGrants = (
			f.organizations as unknown as {
				entitlementGrants: Map<string, EntitlementGrantSnapshot>;
			}
		).entitlementGrants;
		internalGrants.clear();
		internalGrants.set("teacher-grant-later", {
			...f.teacherEntitlement,
			id: "teacher-grant-later",
			createdAtIso: "2026-02-01T00:00:00.000Z",
		});
		internalGrants.set("teacher-grant-earliest-b", {
			...f.teacherEntitlement,
			id: "teacher-grant-earliest-b",
			createdAtIso: "2026-01-10T00:00:00.000Z",
		});
		internalGrants.set("teacher-grant-earliest-a", {
			...f.teacherEntitlement,
			id: "teacher-grant-earliest-a",
			createdAtIso: "2026-01-10T00:00:00.000Z",
		});

		const insertMetadataSpy = spyOn(f.checkout, "insertRegistrationMetadata");

		const result = await f.service.start({
			...f.defaultInput,
			idempotencyKey: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
		});

		expect(result.checkoutUrl).toBeDefined();
		expect(insertMetadataSpy).toHaveBeenCalledTimes(1);
		expect(insertMetadataSpy.mock.calls[0]?.[0].teacherMembershipId).toBe(
			"teacher-grant-earliest-a",
		);
	});

	it("satisfies prerequisite via targeted child entitlement lookup and triggers sold_out across all customers in target class", async () => {
		const f = await createFixture();
		const festivalId = f.festival?.id ?? "";
		const prerequisiteSubtype =
			await f.organizations.createRegistrationCatalogValue({
				organizationId: f.organization.id,
				kind: "class_subtype",
				displayName: "Qualifying Solo",
				normalizedName: "qualifying solo",
			});
		const dependentSubtype =
			await f.organizations.createRegistrationCatalogValue({
				organizationId: f.organization.id,
				kind: "class_subtype",
				displayName: "Masterclass Showcase",
				normalizedName: "masterclass showcase",
				requiredSubtypeId: prerequisiteSubtype.id,
			});
		const prerequisiteClass =
			await f.organizations.createFestivalClassConfiguration({
				organizationId: f.organization.id,
				festivalId,
				displayName: "Qualifying Solo Class",
				classSubtypeId: prerequisiteSubtype.id,
				divisionId: f.division.id,
				minimumAge: 8,
				maximumAge: 12,
				price: "40.00",
				maximumPerformancePieces: 1,
				performanceMinutes: 10,
				capacity: 10,
				isActive: true,
				shopifyProductGid: "gid://shopify/Product/112",
				shopifyVariantGid: "gid://shopify/ProductVariant/212",
			});
		const masterclassClass =
			await f.organizations.createFestivalClassConfiguration({
				organizationId: f.organization.id,
				festivalId,
				displayName: "Masterclass Showcase Class",
				classSubtypeId: dependentSubtype.id,
				divisionId: f.division.id,
				minimumAge: 8,
				maximumAge: 12,
				price: "65.00",
				maximumPerformancePieces: 1,
				performanceMinutes: 15,
				capacity: 1,
				isActive: true,
				shopifyProductGid: "gid://shopify/Product/113",
				shopifyVariantGid: "gid://shopify/ProductVariant/213",
			});

		await f.commerce.createClassEntitlement({
			organizationId: f.organization.id,
			festivalId,
			festivalClassId: prerequisiteClass.id,
			parentCustomerId: f.customer.id,
			childId: f.child.id,
			checkoutIntentId: "prereq-intent-1",
			shopifyOrderGid: "gid://shopify/Order/prereq-1",
			shopifyOrderLineGid: "gid://shopify/OrderLineItem/prereq-1",
			paidAmountCents: 4000,
			paidCurrencyCode: "USD",
			status: "confirmed",
		});

		await f.organizations.updateFestivalClassConfiguration({
			id: prerequisiteClass.id,
			organizationId: f.organization.id,
			festivalId,
			isActive: false,
		});
		const {
			id: _id,
			createdAtIso: _createdAt,
			updatedAtIso: _updatedAt,
			...historicalConfig
		} = prerequisiteClass;
		const secondPrerequisiteClass =
			await f.organizations.createFestivalClassConfiguration({
				...historicalConfig,
				displayName: "Another Qualifying Solo",
				isActive: false,
			});
		for (const [index, festivalClassId] of [
			prerequisiteClass.id,
			secondPrerequisiteClass.id,
		].entries()) {
			await f.commerce.createClassEntitlement({
				organizationId: f.organization.id,
				festivalId,
				festivalClassId,
				parentCustomerId: f.customer.id,
				childId: f.child.id,
				checkoutIntentId: `additional-prereq-${index}`,
				shopifyOrderGid: `gid://shopify/Order/additional-prereq-${index}`,
				shopifyOrderLineGid: `gid://shopify/OrderLineItem/additional-prereq-${index}`,
				paidAmountCents: 4000,
				paidCurrencyCode: "USD",
				status: "confirmed",
			});
		}

		const listEntitlementsSpy = spyOn(f.commerce, "listClassEntitlements");
		const findClassesByIdsSpy = spyOn(
			f.organizations,
			"findFestivalClassConfigurationsByIds",
		);

		const eligibleEval = await f.service.evaluateEligibility({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			festivalId,
			items: [
				{
					childId: f.child.id,
					festivalClassId: masterclassClass.id,
				},
			],
		});
		expect(eligibleEval.isEligible).toBe(true);
		expect(eligibleEval.results[0].reasonCode).toBe("AVAILABLE");
		expect(listEntitlementsSpy).toHaveBeenCalledWith({
			organizationId: f.organization.id,
			festivalId,
			festivalClassIds: [masterclassClass.id],
		});
		expect(listEntitlementsSpy).toHaveBeenCalledWith({
			organizationId: f.organization.id,
			festivalId,
			childIds: [f.child.id],
		});
		expect(findClassesByIdsSpy).toHaveBeenCalledTimes(2);
		expect(findClassesByIdsSpy).toHaveBeenNthCalledWith(
			2,
			f.organization.id,
			festivalId,
			[prerequisiteClass.id, secondPrerequisiteClass.id],
		);

		await f.commerce.createClassEntitlement({
			organizationId: f.organization.id,
			festivalId,
			festivalClassId: masterclassClass.id,
			parentCustomerId: "other-parent-customer",
			childId: "other-child-id",
			checkoutIntentId: "other-intent-1",
			shopifyOrderGid: "gid://shopify/Order/other-1",
			shopifyOrderLineGid: "gid://shopify/OrderLineItem/other-1",
			paidAmountCents: 6500,
			paidCurrencyCode: "USD",
			status: "confirmed",
		});

		const soldOutEval = await f.service.evaluateEligibility({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			festivalId,
			items: [
				{
					childId: f.child.id,
					festivalClassId: masterclassClass.id,
				},
			],
		});
		expect(soldOutEval.isEligible).toBe(false);
		expect(soldOutEval.results[0].reasonCode).toBe("SOLD_OUT");

		await expect(
			f.service.start({
				...f.defaultInput,
				idempotencyKey: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
				festivalClassId: masterclassClass.id,
			}),
		).rejects.toMatchObject({
			status: 400,
			code: "sold_out",
		});
	});

	it("rejects whole multi-line cart when mixed Open and Waitlist classes are submitted (#145 + #284)", async () => {
		const f = await createFixture();
		const festivalId = f.festival?.id ?? "";
		const secondSubtype = await f.organizations.createRegistrationCatalogValue({
			organizationId: f.organization.id,
			kind: "class_subtype",
			displayName: "Waitlist Solo",
			normalizedName: "waitlist solo",
		});
		const waitlistClass =
			await f.organizations.createFestivalClassConfiguration({
				organizationId: f.organization.id,
				festivalId,
				displayName: "Junior Waitlist Piano",
				classSubtypeId: secondSubtype.id,
				divisionId: f.division.id,
				minimumAge: 8,
				maximumAge: 12,
				price: "55.00",
				maximumPerformancePieces: 2,
				performanceMinutes: 10,
				capacity: 1,
				isActive: true,
				shopifyProductGid: "gid://shopify/Product/284-1",
				shopifyVariantGid: "gid://shopify/ProductVariant/284-1",
			});

		await f.commerce.createClassEntitlement({
			organizationId: f.organization.id,
			festivalId,
			festivalClassId: waitlistClass.id,
			parentCustomerId: "other-parent-customer",
			childId: "other-child-id",
			checkoutIntentId: "other-intent-waitlist",
			shopifyOrderGid: "gid://shopify/Order/other-waitlist",
			shopifyOrderLineGid: "gid://shopify/OrderLineItem/other-waitlist",
			paidAmountCents: 5500,
			paidCurrencyCode: "USD",
			status: "confirmed",
		});

		const createCartSpy = spyOn(f.storefront, "createCart");
		const createIntentSpy = spyOn(f.checkout, "createIntent");
		const idempotencyKey = "cccccccc-dddd-4eee-8fff-000000000001";

		let thrownError: unknown;
		try {
			await f.service.start({
				organizationId: f.organization.id,
				customerId: f.customer.id,
				sessionId: f.session.sessionId,
				idempotencyKey,
				buyerAccessToken: "buyer-token-test",
				lineItems: [
					{
						festivalClassId: f.classConfig.id,
						childId: f.child.id,
						teacherId: f.teacherId,
						pieces: f.defaultPieces,
					},
					{
						festivalClassId: waitlistClass.id,
						childId: f.child.id,
						teacherId: f.teacherId,
						pieces: f.defaultPieces,
					},
				],
			});
		} catch (error) {
			thrownError = error;
		}

		expect(createIntentSpy).not.toHaveBeenCalled();
		expect(createCartSpy).not.toHaveBeenCalled();
		expect(thrownError).toBeInstanceOf(AppError);
		const appErr = thrownError as AppError;
		expect(appErr.status).toBe(400);
		expect(appErr.code).toBe("sold_out");
		expect(appErr.details).toMatchObject({
			waitlistedClassIds: [waitlistClass.id],
			failures: [
				{
					childId: f.child.id,
					festivalClassId: waitlistClass.id,
					reasonCode: "SOLD_OUT",
					availability: "waitlist",
					capacity: 1,
					placedCount: 1,
				},
			],
		});

		const outcome = await f.checkout.getOutcome({
			organizationId: f.organization.id,
			customerId: f.customer.id,
			sessionId: f.session.sessionId,
			idempotencyKey,
		});
		expect(outcome).toBeNull();
	});

	it("aborts at post-cartCreate cutpoint when concurrent placement reaches capacity while createCart is in flight (#284)", async () => {
		const f = await createFixture();
		const festivalId = f.festival?.id ?? "";
		const raceSubtype = await f.organizations.createRegistrationCatalogValue({
			organizationId: f.organization.id,
			kind: "class_subtype",
			displayName: "Race Solo",
			normalizedName: "race solo",
		});
		const raceClass = await f.organizations.createFestivalClassConfiguration({
			organizationId: f.organization.id,
			festivalId,
			displayName: "Race Piano Class",
			classSubtypeId: raceSubtype.id,
			divisionId: f.division.id,
			minimumAge: 8,
			maximumAge: 12,
			price: "50.00",
			maximumPerformancePieces: 2,
			performanceMinutes: 10,
			capacity: 2,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/284-race-1",
			shopifyVariantGid: "gid://shopify/ProductVariant/284-race-1",
		});

		await f.commerce.createClassEntitlement({
			organizationId: f.organization.id,
			festivalId,
			festivalClassId: raceClass.id,
			parentCustomerId: "parent-1",
			childId: "child-1",
			checkoutIntentId: "intent-placed-1",
			shopifyOrderGid: "gid://shopify/Order/placed-1",
			shopifyOrderLineGid: "gid://shopify/OrderLineItem/placed-1",
			paidAmountCents: 5000,
			paidCurrencyCode: "USD",
			status: "confirmed",
		});

		f.storefront.createCart = async () => {
			await f.commerce.createClassEntitlement({
				organizationId: f.organization.id,
				festivalId,
				festivalClassId: raceClass.id,
				parentCustomerId: "parent-2",
				childId: "child-2",
				checkoutIntentId: "intent-placed-2",
				shopifyOrderGid: "gid://shopify/Order/placed-2",
				shopifyOrderLineGid: "gid://shopify/OrderLineItem/placed-2",
				paidAmountCents: 5000,
				paidCurrencyCode: "USD",
				status: "confirmed",
			});
			return { shopifyCartId: "gid://shopify/Cart/race-cart-1" };
		};

		const checkoutUrlSpy = spyOn(f.storefront, "checkout");
		const idempotencyKey = "dddddddd-eeee-4fff-8000-000000000002";

		let thrownError: unknown;
		try {
			await f.service.start({
				...f.defaultInput,
				idempotencyKey,
				festivalClassId: raceClass.id,
			});
		} catch (error) {
			thrownError = error;
		}

		expect(checkoutUrlSpy).not.toHaveBeenCalled();
		expect(
			(f.checkout as unknown as { carts: Map<string, unknown> }).carts.size,
		).toBe(0);
		expect(thrownError).toBeInstanceOf(AppError);
		const appErr = thrownError as AppError;
		expect(appErr.status).toBe(409);
		expect(appErr.code).toBe("checkout_recovery_required");
		expect(
			(appErr as ClassCheckoutRecoveryRequiredError).recovery.reasonCode,
		).toBe("checkout_attachment_incomplete");

		const intents = (
			f.checkout as unknown as {
				intents: Map<string, { status: string; cartReference: string | null }>;
			}
		).intents;
		const createdIntent = [...intents.values()][0];
		expect(createdIntent?.status).toBe("creating");
		expect(createdIntent?.cartReference).toBeNull();
	});

	it("aborts at post-cartCreate cutpoint when Admin decreases capacity to placedCount while createCart is in flight (#284)", async () => {
		const f = await createFixture();
		const festivalId = f.festival?.id ?? "";
		const adminSubtype = await f.organizations.createRegistrationCatalogValue({
			organizationId: f.organization.id,
			kind: "class_subtype",
			displayName: "Admin Cap Solo",
			normalizedName: "admin cap solo",
		});
		const adminClass = await f.organizations.createFestivalClassConfiguration({
			organizationId: f.organization.id,
			festivalId,
			displayName: "Admin Capacity Piano Class",
			classSubtypeId: adminSubtype.id,
			divisionId: f.division.id,
			minimumAge: 8,
			maximumAge: 12,
			price: "50.00",
			maximumPerformancePieces: 2,
			performanceMinutes: 10,
			capacity: 2,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/284-admin-1",
			shopifyVariantGid: "gid://shopify/ProductVariant/284-admin-1",
		});

		await f.commerce.createClassEntitlement({
			organizationId: f.organization.id,
			festivalId,
			festivalClassId: adminClass.id,
			parentCustomerId: "parent-1",
			childId: "child-1",
			checkoutIntentId: "intent-admin-placed-1",
			shopifyOrderGid: "gid://shopify/Order/admin-placed-1",
			shopifyOrderLineGid: "gid://shopify/OrderLineItem/admin-placed-1",
			paidAmountCents: 5000,
			paidCurrencyCode: "USD",
			status: "confirmed",
		});

		f.storefront.createCart = async () => {
			await f.organizations.updateFestivalClassConfiguration({
				organizationId: f.organization.id,
				festivalId,
				id: adminClass.id,
				capacity: 1,
			});
			return { shopifyCartId: "gid://shopify/Cart/admin-race-cart" };
		};

		const checkoutUrlSpy = spyOn(f.storefront, "checkout");
		const idempotencyKey = "eeeeeeee-ffff-4000-8111-000000000003";

		let thrownError: unknown;
		try {
			await f.service.start({
				...f.defaultInput,
				idempotencyKey,
				festivalClassId: adminClass.id,
			});
		} catch (error) {
			thrownError = error;
		}

		expect(checkoutUrlSpy).not.toHaveBeenCalled();
		expect(
			(f.checkout as unknown as { carts: Map<string, unknown> }).carts.size,
		).toBe(0);
		expect(thrownError).toBeInstanceOf(AppError);
		const appErr = thrownError as AppError;
		expect(appErr.status).toBe(409);
		expect(appErr.code).toBe("checkout_recovery_required");
		expect(
			(appErr as ClassCheckoutRecoveryRequiredError).recovery.reasonCode,
		).toBe("checkout_attachment_incomplete");

		const intents = (
			f.checkout as unknown as {
				intents: Map<string, { status: string; cartReference: string | null }>;
			}
		).intents;
		const createdIntent = [...intents.values()][0];
		expect(createdIntent?.status).toBe("creating");
		expect(createdIntent?.cartReference).toBeNull();
	});

	for (const cutoffChange of [
		"capacity decrease",
		"confirmed placement",
	] as const) {
		it(`rejects ${cutoffChange} after the final advisory check but before durable attachment (#284)`, async () => {
			const f = await createFixture();
			await f.commerce.createClassEntitlement({
				organizationId: f.organization.id,
				festivalId: f.festival?.id ?? "",
				festivalClassId: f.classConfig.id,
				parentCustomerId: "baseline-parent",
				childId: "baseline-child",
				checkoutIntentId: "baseline-intent",
				shopifyOrderGid: "gid://shopify/Order/baseline",
				shopifyOrderLineGid: "gid://shopify/OrderLineItem/baseline",
				paidAmountCents: 4500,
				paidCurrencyCode: "USD",
				status: "confirmed",
			});
			await f.organizations.updateFestivalClassConfiguration({
				organizationId: f.organization.id,
				festivalId: f.festival?.id ?? "",
				id: f.classConfig.id,
				capacity: 2,
			});
			const original = f.checkout.markIntentReady.bind(f.checkout);
			f.checkout.markIntentReady = async (input) => {
				// This is the old gap: Shopify creation and the final service read
				// have completed, but there is no durable cart reference yet.
				if (cutoffChange === "capacity decrease") {
					await f.organizations.updateFestivalClassConfiguration({
						organizationId: f.organization.id,
						festivalId: f.festival?.id ?? "",
						id: f.classConfig.id,
						capacity: 1,
					});
				} else {
					await f.commerce.createClassEntitlement({
						organizationId: f.organization.id,
						festivalId: f.festival?.id ?? "",
						festivalClassId: f.classConfig.id,
						parentCustomerId: "other-parent",
						childId: "other-child",
						checkoutIntentId: "paid-intent",
						shopifyOrderGid: "gid://shopify/Order/late-placement",
						shopifyOrderLineGid: "gid://shopify/OrderLineItem/late-placement",
						paidAmountCents: 4500,
						paidCurrencyCode: "USD",
						status: "confirmed",
					});
				}
				return original(input);
			};
			const checkoutUrl = spyOn(f.storefront, "checkout");
			await expect(f.service.start(f.defaultInput)).rejects.toMatchObject({
				code: "checkout_recovery_required",
			});
			expect(checkoutUrl).not.toHaveBeenCalled();
			const intents = (
				f.checkout as unknown as {
					intents: Map<
						string,
						{ status: string; cartReference: string | null }
					>;
				}
			).intents;
			expect([...intents.values()]).toHaveLength(1);
			expect([...intents.values()][0]).toMatchObject({
				status: "creating",
				cartReference: null,
			});
		});
	}

	it("resumes grandfathered attached cart after class reaches capacity while blocking new checkouts (#145 + #284)", async () => {
		const f = await createFixture();
		const festivalId = f.festival?.id ?? "";
		const gfSubtype = await f.organizations.createRegistrationCatalogValue({
			organizationId: f.organization.id,
			kind: "class_subtype",
			displayName: "Grandfathered Solo",
			normalizedName: "grandfathered solo",
		});
		const gfClass = await f.organizations.createFestivalClassConfiguration({
			organizationId: f.organization.id,
			festivalId,
			displayName: "Grandfathered Piano Class",
			classSubtypeId: gfSubtype.id,
			divisionId: f.division.id,
			minimumAge: 8,
			maximumAge: 12,
			price: "50.00",
			maximumPerformancePieces: 2,
			performanceMinutes: 10,
			capacity: 2,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/284-gf-1",
			shopifyVariantGid: "gid://shopify/ProductVariant/284-gf-1",
		});

		await f.commerce.createClassEntitlement({
			organizationId: f.organization.id,
			festivalId,
			festivalClassId: gfClass.id,
			parentCustomerId: "parent-1",
			childId: "child-1",
			checkoutIntentId: "intent-gf-placed-1",
			shopifyOrderGid: "gid://shopify/Order/gf-placed-1",
			shopifyOrderLineGid: "gid://shopify/OrderLineItem/gf-placed-1",
			paidAmountCents: 5000,
			paidCurrencyCode: "USD",
			status: "confirmed",
		});

		const grandfatheredKey = "ffffffff-0000-4111-8222-000000000004";
		const initialResult = await f.service.start({
			...f.defaultInput,
			idempotencyKey: grandfatheredKey,
			festivalClassId: gfClass.id,
		});
		expect(initialResult.checkoutUrl).toBe(
			`https://${f.storeDomain}/checkouts/c123`,
		);

		// Class now reaches 2/2 capacity (waitlist)
		await f.commerce.createClassEntitlement({
			organizationId: f.organization.id,
			festivalId,
			festivalClassId: gfClass.id,
			parentCustomerId: "parent-2",
			childId: "child-2",
			checkoutIntentId: "intent-gf-placed-2",
			shopifyOrderGid: "gid://shopify/Order/gf-placed-2",
			shopifyOrderLineGid: "gid://shopify/OrderLineItem/gf-placed-2",
			paidAmountCents: 5000,
			paidCurrencyCode: "USD",
			status: "confirmed",
		});

		const createCartSpy = spyOn(f.storefront, "createCart");
		const replayedResult = await f.service.start({
			...f.defaultInput,
			idempotencyKey: grandfatheredKey,
			festivalClassId: gfClass.id,
		});
		expect(replayedResult.checkoutUrl).toBe(initialResult.checkoutUrl);
		expect(replayedResult.intentId).toBe(initialResult.intentId);
		expect(replayedResult.correlationId).toBe(initialResult.correlationId);
		expect(createCartSpy).not.toHaveBeenCalled();

		// A new customer attempting a fresh checkout on the now-waitlisted class is blocked
		const { customer: customer2, session: session2 } =
			await f.customers.createCustomerSession({
				sessionId: "session-parent-2",
				organizationId: f.organization.id,
				shopifyCustomerGid: "gid://shopify/Customer/998",
				encryptedTokens: "encrypted-token-2",
				csrfToken: "csrf-token-2",
				integrationVersion: 1,
				createdAtIso: f.now.toISOString(),
				lastSeenAtIso: f.now.toISOString(),
				expiresAtIso: new Date(f.now.getTime() + 8 * 3600_000).toISOString(),
			});
		const child2 = await f.customers.createChild({
			organizationId: f.organization.id,
			parentCustomerId: customer2.id,
			displayName: "New Performer",
		});
		await f.customers.createChildAgeSnapshot({
			organizationId: f.organization.id,
			childId: child2.id,
			age: 10,
			validUntilIso: new Date(
				f.now.getTime() + 90 * 24 * 3600_000,
			).toISOString(),
			createdAtIso: f.now.toISOString(),
		});

		await expect(
			f.service.start({
				...f.defaultInput,
				customerId: customer2.id,
				sessionId: session2.sessionId,
				childId: child2.id,
				idempotencyKey: "11111111-0000-4111-8222-000000000005",
				festivalClassId: gfClass.id,
			}),
		).rejects.toMatchObject({
			status: 400,
			code: "sold_out",
		});
	});

	it("never reopens a historical bare/failed intent after capacity fills (#284)", async () => {
		const f = await createFixture({ legacyCheckout: true });
		const festivalId = f.festival?.id ?? "";
		const bareSubtype = await f.organizations.createRegistrationCatalogValue({
			organizationId: f.organization.id,
			kind: "class_subtype",
			displayName: "Bare Intent Solo",
			normalizedName: "bare intent solo",
		});
		const bareClass = await f.organizations.createFestivalClassConfiguration({
			organizationId: f.organization.id,
			festivalId,
			displayName: "Bare Intent Piano Class",
			classSubtypeId: bareSubtype.id,
			divisionId: f.division.id,
			minimumAge: 8,
			maximumAge: 12,
			price: "50.00",
			maximumPerformancePieces: 2,
			performanceMinutes: 10,
			capacity: 1,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/284-bare-1",
			shopifyVariantGid: "gid://shopify/ProductVariant/284-bare-1",
		});

		f.storefront.createCart = async () => {
			throw new Error("Shopify cartCreate temporary failure");
		};

		const failedKey = "22222222-0000-4111-8222-000000000006";
		await expect(
			f.service.start({
				...f.defaultInput,
				idempotencyKey: failedKey,
				festivalClassId: bareClass.id,
			}),
		).rejects.toMatchObject({
			status: 503,
			code: "checkout_retryable_upstream",
		});

		const intents = (
			f.checkout as unknown as {
				intents: Map<string, { status: string; cartReference: string | null }>;
			}
		).intents;
		const failedIntent = [...intents.values()][0];
		expect(failedIntent?.status).toBe("failed");
		expect(failedIntent?.cartReference).toBeNull();

		// Class now reaches capacity (1/1)
		await f.commerce.createClassEntitlement({
			organizationId: f.organization.id,
			festivalId,
			festivalClassId: bareClass.id,
			parentCustomerId: "other-parent",
			childId: "other-child",
			checkoutIntentId: "intent-bare-other",
			shopifyOrderGid: "gid://shopify/Order/bare-other",
			shopifyOrderLineGid: "gid://shopify/OrderLineItem/bare-other",
			paidAmountCents: 5000,
			paidCurrencyCode: "USD",
			status: "confirmed",
		});

		f.storefront.createCart = async () => ({
			shopifyCartId: "gid://shopify/Cart/should-not-be-created",
		});

		// Retrying with the old key fails as terminal failure (never resumes)
		await expect(
			f.service.start({
				...f.defaultInput,
				idempotencyKey: failedKey,
				festivalClassId: bareClass.id,
			}),
		).rejects.toMatchObject({
			status: 409,
			code: "checkout_terminal_failure",
		});

		// Retrying with a new key is blocked by the Waitlist gate
		await expect(
			f.service.start({
				...f.defaultInput,
				idempotencyKey: "33333333-0000-4111-8222-000000000007",
				festivalClassId: bareClass.id,
			}),
		).rejects.toMatchObject({
			status: 400,
			code: "sold_out",
		});
	});

	describe("Concerto catalog work requirement (#197)", () => {
		it("rejects free-text repertoire when class requires a concerto", async () => {
			const f = await createFixture();
			const concertoSubtype =
				await f.organizations.createRegistrationCatalogValue({
					organizationId: f.organization.id,
					kind: "class_subtype",
					displayName: "Concerto",
					normalizedName: "concerto",
				});
			const concertoClass =
				await f.organizations.createFestivalClassConfiguration({
					organizationId: f.organization.id,
					festivalId: f.festival?.id ?? "",
					displayName: "Junior Piano Concerto",
					classSubtypeId: concertoSubtype.id,
					divisionId: f.division.id,
					minimumAge: 8,
					maximumAge: 12,
					price: "55.00",
					maximumPerformancePieces: 1,
					performanceMinutes: 15,
					capacity: 20,
					isActive: true,
					shopifyProductGid: "gid://shopify/Product/101",
					shopifyVariantGid: "gid://shopify/ProductVariant/201",
				});

			await expect(
				f.service.start({
					...f.defaultInput,
					festivalClassId: concertoClass.id,
					pieces: [
						{
							title: "Piano Concerto in A minor, Op. 16",
							composer: "Edvard Grieg",
							durationSeconds: 300,
						},
					],
				}),
			).rejects.toMatchObject({
				status: 400,
				code: "concerto_catalog_work_required",
			});
		});

		it("rejects catalog work not classified as concerto or unknown catalogWorkId", async () => {
			const f = await createFixture();
			const concertoSubtype =
				await f.organizations.createRegistrationCatalogValue({
					organizationId: f.organization.id,
					kind: "class_subtype",
					displayName: "Concerto",
					normalizedName: "concerto",
				});
			const concertoClass =
				await f.organizations.createFestivalClassConfiguration({
					organizationId: f.organization.id,
					festivalId: f.festival?.id ?? "",
					displayName: "Junior Piano Concerto",
					classSubtypeId: concertoSubtype.id,
					divisionId: f.division.id,
					minimumAge: 8,
					maximumAge: 12,
					price: "55.00",
					maximumPerformancePieces: 1,
					performanceMinutes: 15,
					capacity: 20,
					isActive: true,
					shopifyProductGid: "gid://shopify/Product/101",
					shopifyVariantGid: "gid://shopify/ProductVariant/201",
				});

			f.repertoire.seedCanonicalWork({
				id: "work-sonata",
				organizationId: f.organization.id,
				title: "Piano Sonata No. 16",
				composerName: "W. A. Mozart",
				classifications: ["sonata"],
				isActive: true,
			});

			f.repertoire.seedCanonicalWork({
				id: "work-unclassified",
				organizationId: f.organization.id,
				title: "Mystery Piece",
				composerName: "Unknown",
				classifications: [],
				isActive: true,
			});

			for (const catalogWorkId of [
				"work-sonata",
				"work-unclassified",
				"unknown-work-id",
			]) {
				await expect(
					f.service.start({
						...f.defaultInput,
						idempotencyKey: `idem-${catalogWorkId}`,
						festivalClassId: concertoClass.id,
						pieces: [
							{
								title: "Piece",
								composer: "Composer",
								durationSeconds: 300,
								catalogWorkId,
							} as RepertoirePiece,
						],
					}),
				).rejects.toMatchObject({
					status: 400,
					code: "concerto_catalog_work_required",
				});
			}
		});

		it("accepts a catalog work classified as concerto and persists catalogWorkId", async () => {
			const f = await createFixture();
			const concertoSubtype =
				await f.organizations.createRegistrationCatalogValue({
					organizationId: f.organization.id,
					kind: "class_subtype",
					displayName: "Concerto",
					normalizedName: "concerto",
				});
			const concertoClass =
				await f.organizations.createFestivalClassConfiguration({
					organizationId: f.organization.id,
					festivalId: f.festival?.id ?? "",
					displayName: "Junior Piano Concerto",
					classSubtypeId: concertoSubtype.id,
					divisionId: f.division.id,
					minimumAge: 8,
					maximumAge: 12,
					price: "55.00",
					maximumPerformancePieces: 1,
					performanceMinutes: 15,
					capacity: 20,
					isActive: true,
					shopifyProductGid: "gid://shopify/Product/101",
					shopifyVariantGid: "gid://shopify/ProductVariant/201",
				});

			f.repertoire.seedCanonicalWork({
				id: "work-concerto-1",
				organizationId: f.organization.id,
				title: "Piano Concerto in A minor, Op. 16",
				composerName: "Edvard Grieg",
				classifications: ["concerto"],
				isActive: true,
			});

			const captured: ClassRegistrationMetadata[] = [];
			const insert = f.checkout.insertRegistrationMetadata.bind(f.checkout);
			f.checkout.insertRegistrationMetadata = async (params) => {
				const metadata = await insert(params);
				captured.push(metadata);
				return metadata;
			};

			const result = await f.service.start({
				...f.defaultInput,
				festivalClassId: concertoClass.id,
				pieces: [
					{
						title: "Piano Concerto in A minor, Op. 16",
						composer: "Edvard Grieg",
						movement: "I. Allegro molto moderato",
						durationSeconds: 300,
						catalogWorkId: "work-concerto-1",
					} as RepertoirePiece,
				],
			});

			expect(result.intentId).toBeDefined();
			expect(captured).toHaveLength(1);
			expect(captured[0].repertoireItems[0]?.catalogWorkId).toBe(
				"work-concerto-1",
			);
			expect(
				(
					captured[0].repertoireJson[0] as RepertoirePiece & {
						catalogWorkId?: string | null;
					}
				)?.catalogWorkId,
			).toBe("work-concerto-1");
		});

		it("continues to allow free-text repertoire without catalogWorkId on non-concerto classes", async () => {
			const f = await createFixture();
			const result = await f.service.start(f.defaultInput);
			expect(result.intentId).toBeDefined();
		});

		it("rejects cross-tenant and bogus catalogWorkId on both concerto and non-concerto classes", async () => {
			const f = await createFixture();
			const otherOrg = await f.organizations.createOrganization({
				name: "Other Org",
				slug: "other-org",
			});
			f.repertoire.seedCanonicalWork({
				id: "foreign-concerto-work",
				organizationId: otherOrg.id,
				title: "Piano Concerto in A minor, Op. 16",
				composerName: "Edvard Grieg",
				classifications: ["concerto"],
				isActive: true,
			});

			const concertoSubtype =
				await f.organizations.createRegistrationCatalogValue({
					organizationId: f.organization.id,
					kind: "class_subtype",
					displayName: "Concerto",
					normalizedName: "concerto",
				});
			const concertoClass =
				await f.organizations.createFestivalClassConfiguration({
					organizationId: f.organization.id,
					festivalId: f.festival?.id ?? "",
					displayName: "Junior Piano Concerto",
					classSubtypeId: concertoSubtype.id,
					divisionId: f.division.id,
					minimumAge: 8,
					maximumAge: 12,
					price: "55.00",
					maximumPerformancePieces: 1,
					performanceMinutes: 15,
					capacity: 20,
					isActive: true,
					shopifyProductGid: "gid://shopify/Product/101",
					shopifyVariantGid: "gid://shopify/ProductVariant/201",
				});

			// Cross-tenant catalogWorkId on concerto class
			await expect(
				f.service.start({
					...f.defaultInput,
					idempotencyKey: "idem-cross-tenant-concerto",
					festivalClassId: concertoClass.id,
					pieces: [
						{
							title: "Piano Concerto in A minor, Op. 16",
							composer: "Edvard Grieg",
							durationSeconds: 300,
							catalogWorkId: "foreign-concerto-work",
						},
					],
				}),
			).rejects.toMatchObject({
				status: 400,
				code: "concerto_catalog_work_required",
			});

			// Cross-tenant and bogus catalogWorkId on non-concerto class
			for (const badWorkId of ["foreign-concerto-work", "bogus-work-id"]) {
				await expect(
					f.service.start({
						...f.defaultInput,
						idempotencyKey: `idem-non-concerto-${badWorkId}`,
						pieces: [
							{
								title: "Sonatina in C Major",
								composer: "Muzio Clementi",
								durationSeconds: 150,
								catalogWorkId: badWorkId,
							},
						],
					}),
				).rejects.toMatchObject({
					status: 400,
					code: "catalog_work_invalid",
				});
			}

			// Fail-closed when repertoire repository is not configured on concerto class
			const serviceWithoutRepertoire = new ClassCheckoutService(
				f.organizations,
				f.customers,
				f.checkout,
				f.storefront,
				f.commerce,
				() => f.now,
			);
			await expect(
				serviceWithoutRepertoire.start({
					...f.defaultInput,
					idempotencyKey: "idem-no-repertoire-repo",
					festivalClassId: concertoClass.id,
					pieces: [
						{
							title: "Piano Concerto in A minor, Op. 16",
							composer: "Edvard Grieg",
							durationSeconds: 300,
							catalogWorkId: "any-work-id",
						},
					],
				}),
			).rejects.toMatchObject({
				status: 400,
				code: "concerto_catalog_work_required",
			});
		});
	});
});
