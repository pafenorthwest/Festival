import { describe, expect, spyOn, test } from "bun:test";
import type {
	CustomerClassRegistrationItem,
	ProposedPurchaseLineItem,
	RegistrationEligibleClass,
} from "@festival/common";
import { sql } from "bun";
import {
	ClassCheckoutService,
	type ClassCheckoutStorefront,
} from "../src/checkout/class-checkout-service.js";
import { PostgresCheckoutRepository } from "../src/checkout/postgres-checkout-repository.js";
import { PostgresMembershipCommerceRepository } from "../src/commerce/postgres-membership-commerce-repository.js";
import { CustomerAccountService } from "../src/customer/customer-account-service.js";
import { PostgresCustomerAccountRepository } from "../src/customer/postgres-customer-account-repository.js";
import { AppError } from "../src/errors/app-error.js";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";
import {
	SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
	ShopifySecretKeyring,
} from "../src/shopify/encryption.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "./postgres-test-fixture.js";

const integrationDescribe = process.env.POSTGRES_INTEGRATION_URL
	? describe
	: describe.skip;
const currentSchema = currentPostgresFixture("read_models_query_count");
const [ORG_ID, SLUG, FEST_ID] = ["org-rm", "org-read-models", "fest-rm"];
const [FEST_SHORT, DIV_ID, SESS_ID, PARENT_ID] = [
	"fest-26",
	"div-piano",
	"sess-rm",
	"cus-parent",
];
const ORIGIN = "https://festival.example.com";
const NOW = new Date("2026-11-12T12:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const KEY_B64 = Buffer.alloc(32, 7).toString("base64");
const TOKEN_BUNDLE = JSON.stringify({
	accessToken: "tok-a",
	refreshToken: "tok-r",
	idToken: "tok-i",
	accessExpiresAtIso: "2027-01-01T00:00:00.000Z",
	issuer: "https://shopify.com/authentication/1",
});
const NOOP_STOREFRONT: ClassCheckoutStorefront = {
	createCart: async () => ({ shopifyCartId: "gid://shopify/Cart/noop" }),
	checkout: async () => ({ checkoutUrl: "https://shop.example.com/checkout" }),
};

type ClassSpec = readonly [string, number, number, number, number?, number?];

async function measureSqlUnsafe<T>(operation: () => Promise<T>) {
	const realUnsafe = sql.unsafe.bind(sql);
	const queries: string[] = [];
	const spy = spyOn(sql, "unsafe").mockImplementation(((
		query: string,
		values?: unknown[],
	) => {
		queries.push(String(query));
		return values === undefined ? realUnsafe(query) : realUnsafe(query, values);
	}) as typeof sql.unsafe);
	try {
		const result = await operation();
		return { result, count: queries.length, queries };
	} finally {
		spy.mockRestore();
	}
}

async function seedBaseFixtureRows(
	schema: string,
	encryptedTokens: string,
): Promise<void> {
	await sql.unsafe(`
		INSERT INTO ${schema}.organizations (id, name, slug, timezone) VALUES ('org-rm', 'Read Models Org', 'org-read-models', 'America/Los_Angeles');
		INSERT INTO ${schema}.organization_divisions (id, organization_id, display_name, normalized_name, display_order) VALUES ('div-piano', 'org-rm', 'Piano', 'piano', 0);
		INSERT INTO ${schema}.registration_catalog_values (id, organization_id, kind, display_name, normalized_name, display_order) VALUES ('sub-solo', 'org-rm', 'class_subtype', 'Solo', 'solo', 0);
		INSERT INTO ${schema}.festivals (id, organization_id, code, short_name, is_primary, name, start_date, end_date, registration_opens_at, registration_closes_at) VALUES ('fest-rm', 'org-rm', 'FEST26', 'fest-26', TRUE, 'Festival 2026', '2027-05-01', '2027-05-10', '2026-01-01T00:00:00.000Z', '2027-04-01T00:00:00.000Z');
		INSERT INTO ${schema}.festival_customers (id, organization_id, shopify_customer_gid, name, created_at, updated_at) VALUES ('cus-parent', 'org-rm', 'gid://shopify/Customer/p1', 'Parent One', '2026-11-12T12:00:00.000Z', '2026-11-12T12:00:00.000Z'), ('cus-teacher', 'org-rm', 'gid://shopify/Customer/t1', 'Teacher Ada', '2026-11-12T12:00:00.000Z', '2026-11-12T12:00:00.000Z'), ('cus-other', 'org-rm', 'gid://shopify/Customer/o1', 'Other Parent', '2026-11-12T12:00:00.000Z', '2026-11-12T12:00:00.000Z');
		INSERT INTO ${schema}.shopify_customer_account_integrations (organization_id, storefront_domain, client_id, encrypted_client_secret, readiness, can_read_orders, integration_version, verified_at) VALUES ('org-rm', 'read-models.myshopify.com', 'client-rm', 'enc-secret', 'ready', TRUE, 1, '2026-11-12T12:00:00.000Z');
		INSERT INTO ${schema}.products (id, organization_id, product_category, entitlement_class, duration_days, shopify_product_gid, shopify_variant_gid, product_name_snapshot) VALUES ('prod-t', 'org-rm', 'membership', 'teacher_membership', 365, 'gid://shopify/Product/t1', 'gid://shopify/ProductVariant/tv1', 'Teacher');
		INSERT INTO ${schema}.membership_entitlements (id, organization_id, customer_id, entitlement_class, source, offering_id, starts_on, ends_on) VALUES ('mem-teacher', 'org-rm', 'cus-teacher', 'teacher_membership', 'teacher_checkout', 'prod-t', '2020-01-01', '2035-01-01');
		INSERT INTO ${schema}.membership_entitlement_divisions (entitlement_id, organization_id, division_id, division_name_snapshot) VALUES ('mem-teacher', 'org-rm', 'div-piano', 'Piano');
		INSERT INTO ${schema}.checkout_intents (id, correlation_id, organization_id, customer_id, session_id, idempotency_key, intent_type, shopify_product_gid, shopify_variant_gid, amount, currency_code, status, expires_at) VALUES ('intent-rm', 'corr-rm', 'org-rm', 'cus-parent', 'sess-rm', 'idem-rm', 'class_entry', 'gid://shopify/Product/b', 'gid://shopify/ProductVariant/b', '50.00', 'USD', 'approved', '2027-01-01T00:00:00.000Z');
	`);
	await sql.unsafe(
		`INSERT INTO ${schema}.shopify_customer_sessions (session_id, customer_id, organization_id, shopify_customer_gid, encrypted_tokens, csrf_token, integration_version, created_at, last_seen_at, expires_at) VALUES ('sess-rm', 'cus-parent', 'org-rm', 'gid://shopify/Customer/p1', $1, 'csrf-rm', 1, $2, $2, '2026-12-15T00:00:00.000Z')`,
		[encryptedTokens, NOW_ISO],
	);
}

async function setupBaseStack() {
	const schema = await currentSchema();
	await resetPostgresFixture(schema);
	const keyring = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ k1: KEY_B64 }),
		"k1",
	);
	if (!keyring) throw new Error("Expected keyring.");
	const encrypted = keyring.encrypt(TOKEN_BUNDLE, {
		organizationId: ORG_ID,
		purpose: SHOPIFY_CUSTOMER_TOKENS_PURPOSE,
	});
	await seedBaseFixtureRows(schema, encrypted);
	const orgs = new PostgresOrganizationRepository(schema);
	const customers = new PostgresCustomerAccountRepository(schema);
	const commerce = new PostgresMembershipCommerceRepository(schema);
	const checkout = new PostgresCheckoutRepository(schema);
	await Promise.all([
		orgs.ensureReady(),
		customers.ensureReady(),
		commerce.ensureReady(),
		checkout.ensureReady(),
	]);
	const opts = { publicOrigin: ORIGIN, now: () => NOW };
	return {
		schema,
		accountService: new CustomerAccountService(
			customers,
			orgs,
			keyring,
			opts,
			commerce,
			checkout,
		),
		checkoutService: new ClassCheckoutService(
			orgs,
			customers,
			checkout,
			NOOP_STOREFRONT,
			commerce,
			() => NOW,
		),
	};
}

async function seedChildWithAge(
	schema: string,
	childId: string,
	ownerId: string,
): Promise<void> {
	await sql.unsafe(
		`INSERT INTO ${schema}.festival_children (id, organization_id, parent_customer_id, display_name, created_at) VALUES ($1, 'org-rm', $2, $3, $4)`,
		[childId, ownerId, `Child ${childId}`, NOW_ISO],
	);
	await sql.unsafe(
		`INSERT INTO ${schema}.festival_child_age_snapshots (id, child_id, organization_id, age, created_at, valid_until) VALUES ($1, $2, 'org-rm', 10, $3, '2026-12-31T00:00:00.000Z')`,
		[`snap-${childId}`, childId, NOW_ISO],
	);
}

async function seedClassWithEntitlements(
	schema: string,
	[id, capacity, confirmed, cancelled, minAge = 8, maxAge = 12]: ClassSpec,
): Promise<void> {
	await sql.unsafe(
		`INSERT INTO ${schema}.festival_class_configurations (id, organization_id, festival_id, display_name, class_subtype_id, division_id, minimum_age, maximum_age, price, maximum_performance_pieces, performance_minutes, capacity, shopify_product_gid, shopify_variant_gid) VALUES ($1, 'org-rm', 'fest-rm', $2, 'sub-solo', 'div-piano', $3, $4, '45.00', 2, 10, $5, $6, $7)`,
		[id, `Class ${id}`, minAge, maxAge, capacity, `prod-${id}`, `var-${id}`],
	);
	const statuses = [
		...Array.from({ length: confirmed }, () => "confirmed"),
		...Array.from({ length: cancelled }, () => "cancelled"),
	];
	for (const [idx, status] of statuses.entries()) {
		const cid = `other-${id}-${idx}`;
		await sql.unsafe(
			`INSERT INTO ${schema}.festival_children (id, organization_id, parent_customer_id, display_name, created_at) VALUES ($1, 'org-rm', 'cus-other', $1, $2)`,
			[cid, NOW_ISO],
		);
		await sql.unsafe(
			`INSERT INTO ${schema}.class_entitlements (id, organization_id, festival_id, festival_class_id, parent_customer_id, child_id, checkout_intent_id, shopify_order_gid, shopify_order_line_gid, paid_amount_cents, paid_currency_code, status) VALUES ($1, 'org-rm', 'fest-rm', $2, 'cus-other', $3, 'intent-rm', $4, $5, 4500, 'USD', $6)`,
			[`ent-${cid}`, id, cid, `ord-${cid}`, `ln-${cid}`, status],
		);
	}
}

function makeSnapshotJson(id: string): string {
	return JSON.stringify({
		version: 1,
		capturedAtIso: NOW_ISO,
		class: {
			id,
			festivalId: FEST_ID,
			displayName: `Class ${id}`,
			classSubtypeId: "sub-solo",
			classSubtypeName: "Solo",
			minimumAge: 8,
			maximumAge: 12,
			price: "45.00",
			currencyCode: "USD",
			maximumPerformancePieces: 2,
			performanceMinutes: 10,
			capacity: 10,
		},
		division: { id: DIV_ID, name: "Piano" },
		instrument: "unknown",
		teacher: {
			customerId: "cus-teacher",
			membershipId: "mem-teacher",
			name: "Teacher Ada",
		},
		accompanist: null,
		repertoire: [],
	});
}

async function seedOrderedRepertoire(
	schema: string,
	mid: string,
): Promise<void> {
	await sql.unsafe(
		`INSERT INTO ${schema}.registration_repertoire_items (id, organization_id, registration_metadata_id, repertoire_work_id, title_snapshot, performed_movement_text, duration_seconds, display_order) VALUES ($1, 'org-rm', $2, NULL, $3, 'Allegro', 180, 2), ($4, 'org-rm', $2, NULL, $5, 'Moderato', 120, 1)`,
		[`${mid}-i2`, mid, `Sonata ${mid}`, `${mid}-i1`, `Prelude ${mid}`],
	);
	await sql.unsafe(
		`INSERT INTO ${schema}.registration_repertoire_item_contributors (id, organization_id, registration_repertoire_item_id, repertoire_contributor_id, display_name_snapshot, contributor_role, position) VALUES ($1, 'org-rm', $2, NULL, 'F. Busoni', 'Arranger', 2), ($3, 'org-rm', $2, NULL, 'J. S. Bach', 'Composer', 1), ($4, 'org-rm', $5, NULL, 'L. v. Beethoven', 'Composer', 1)`,
		[`${mid}-c2`, `${mid}-i1`, `${mid}-c1`, `${mid}-c3`, `${mid}-i2`],
	);
}

async function seedRegistrationEntry(
	schema: string,
	idx: number,
	mode: "with_pieces" | "empty_repertoire" | "no_metadata",
): Promise<void> {
	const [cid, eid, lid, mid] = [
		`reg-c-${idx}`,
		`reg-e-${idx}`,
		`reg-l-${idx}`,
		`reg-m-${idx}`,
	];
	await seedClassWithEntitlements(schema, [cid, 10, 0, 0]);
	await sql.unsafe(
		`INSERT INTO ${schema}.checkout_intent_lines (id, checkout_intent_id, line_index, line_type, festival_class_id, child_id, shopify_product_gid, shopify_variant_gid, amount, currency_code) VALUES ($1, 'intent-rm', $2, 'class_entry', $3, 'child-reg', $4, $5, '45.00', 'USD')`,
		[lid, idx, cid, `prod-${cid}`, `var-${cid}`],
	);
	const ts = new Date(NOW.getTime() - idx * 60_000).toISOString();
	await sql.unsafe(
		`INSERT INTO ${schema}.class_entitlements (id, organization_id, festival_id, festival_class_id, parent_customer_id, child_id, checkout_intent_id, checkout_intent_line_id, shopify_order_gid, shopify_order_line_gid, paid_amount_cents, paid_currency_code, status, created_at, updated_at) VALUES ($1, 'org-rm', 'fest-rm', $2, 'cus-parent', 'child-reg', 'intent-rm', $3, $4, $5, 4500, 'USD', 'confirmed', $6, $6)`,
		[eid, cid, lid, `ord-${idx}`, `ln-${idx}`, ts],
	);
	if (mode === "no_metadata") return;
	const pieces =
		mode === "with_pieces"
			? [
					{
						title: `Prelude ${mid}`,
						composer: "J. S. Bach",
						durationSeconds: 120,
					},
				]
			: [];
	await sql.unsafe(
		`INSERT INTO ${schema}.registration_metadata (id, organization_id, festival_id, checkout_intent_id, checkout_intent_line_id, class_entitlement_id, teacher_membership_id, accompanist_membership_id, repertoire_json, registration_snapshot, created_at) VALUES ($1, 'org-rm', 'fest-rm', 'intent-rm', $2, $3, 'mem-teacher', NULL, $4::jsonb, $5::jsonb, $6)`,
		[mid, lid, eid, JSON.stringify(pieces), makeSnapshotJson(cid), NOW_ISO],
	);
	if (mode === "with_pieces") await seedOrderedRepertoire(schema, mid);
}

function assertEligibleParity(
	classes: RegistrationEligibleClass[],
	expected: ReadonlyArray<
		readonly [string, number, number, "open" | "waitlist"]
	>,
): void {
	expect(classes).toHaveLength(expected.length);
	const byId = new Map(classes.map((item) => [item.id, item]));
	for (const [id, capacity, placedCount, availability] of expected) {
		expect(byId.get(id)).toMatchObject({
			id,
			capacity,
			placedCount,
			availability,
			isRegistrationOpen: true,
		});
	}
}

function assertRegistrationPieces(
	item: CustomerClassRegistrationItem | undefined,
	mid: string,
): void {
	expect(item?.metadata?.teacherName).toBe("Teacher Ada");
	const summary = item?.metadata?.repertoireItems?.map((p) => [
		p.displayOrder,
		p.titleSnapshot,
		p.contributors.map((c) => [c.displayOrder, c.role, c.displayNameSnapshot]),
	]);
	expect(summary).toEqual([
		[
			1,
			`Prelude ${mid}`,
			[
				[1, "Composer", "J. S. Bach"],
				[2, "Arranger", "F. Busoni"],
			],
		],
		[2, `Sonata ${mid}`, [[1, "Composer", "L. v. Beethoven"]]],
	]);
}

integrationDescribe("G3 constant-count O(1) SQL read models", () => {
	test("listRegistrationEligibleClasses executes O(1) SQL queries across N=2 vs N=8 classes with exact capacity parity", async () => {
		const { schema, accountService } = await setupBaseStack();
		await seedChildWithAge(schema, "child-1", PARENT_ID);
		for (const spec of [
			["elig-0", 2, 2, 1],
			["elig-1", 4, 1, 1],
			["inelig", 2, 2, 0, 16, 18],
		] satisfies ClassSpec[]) {
			await seedClassWithEntitlements(schema, spec);
		}
		await accountService.session(SLUG, SESS_ID);

		const run = () =>
			accountService.listRegistrationEligibleClasses(
				SLUG,
				FEST_SHORT,
				SESS_ID,
				"child-1",
				DIV_ID,
				"cus-teacher",
			);
		const m2 = await measureSqlUnsafe(run);
		assertEligibleParity(m2.result.classes, [
			["elig-0", 2, 2, "waitlist"],
			["elig-1", 4, 1, "open"],
		]);

		for (const spec of [
			["elig-2", 1, 1, 0],
			["elig-3", 3, 0, 2],
			["elig-4", 5, 2, 1],
			["elig-5", 2, 2, 0],
			["elig-6", 6, 1, 0],
			["elig-7", 4, 0, 0],
		] satisfies ClassSpec[]) {
			await seedClassWithEntitlements(schema, spec);
		}
		const m8 = await measureSqlUnsafe(run);
		assertEligibleParity(m8.result.classes, [
			["elig-0", 2, 2, "waitlist"],
			["elig-1", 4, 1, "open"],
			["elig-2", 1, 1, "waitlist"],
			["elig-3", 3, 0, "open"],
			["elig-4", 5, 2, "open"],
			["elig-5", 2, 2, "waitlist"],
			["elig-6", 6, 1, "open"],
			["elig-7", 4, 0, "open"],
		]);
		expect(m8.count).toBe(m2.count);
	});

	test("listClassRegistrations executes O(1) SQL queries across N=2 vs N=8 registrations with warm slug cache and ordered repertoire", async () => {
		const { schema, accountService } = await setupBaseStack();
		await seedChildWithAge(schema, "child-reg", PARENT_ID);
		await seedRegistrationEntry(schema, 0, "with_pieces");
		await seedRegistrationEntry(schema, 1, "no_metadata");
		await accountService.session(SLUG, SESS_ID);

		const run = () =>
			accountService.listClassRegistrations(SLUG, SESS_ID, FEST_SHORT);
		const m2 = await measureSqlUnsafe(run);
		expect(m2.result.registrations).toHaveLength(2);
		const byEnt2 = new Map(
			m2.result.registrations.map((r) => [r.entitlement.id, r]),
		);
		assertRegistrationPieces(byEnt2.get("reg-e-0"), "reg-m-0");
		expect(byEnt2.get("reg-e-1")?.metadata).toBeNull();

		await seedRegistrationEntry(schema, 2, "empty_repertoire");
		for (let idx = 3; idx < 8; idx += 1) {
			await seedRegistrationEntry(schema, idx, "with_pieces");
		}
		const m8 = await measureSqlUnsafe(run);
		expect(m8.result.registrations).toHaveLength(8);
		const byEnt8 = new Map(
			m8.result.registrations.map((r) => [r.entitlement.id, r]),
		);
		expect(byEnt8.get("reg-e-2")?.metadata?.repertoireItems).toEqual([]);
		assertRegistrationPieces(byEnt8.get("reg-e-7"), "reg-m-7");

		const slugQueries = m2.queries.filter((q) =>
			/FROM\s+\S*organizations\b[\s\S]*WHERE\s+slug\s*=/i.test(q),
		);
		expect({ q8: m8.count, slugQueries: slugQueries.length }).toEqual({
			q8: m2.count,
			slugQueries: 0,
		});
	});

	test("ClassCheckoutService.evaluateEligibility executes O(1) SQL queries across N=2 vs N=8 children and preserves 404 IDOR check", async () => {
		const { schema, checkoutService } = await setupBaseStack();
		await seedClassWithEntitlements(schema, ["cart-c0", 10, 0, 0]);
		await seedChildWithAge(schema, "idor-child", "cus-other");
		for (let idx = 0; idx < 2; idx += 1) {
			await seedChildWithAge(schema, `cart-ch-${idx}`, PARENT_ID);
		}
		const itemsFor = (count: number): ProposedPurchaseLineItem[] =>
			Array.from({ length: count }, (_, idx) => ({
				id: `line-${idx}`,
				childId: `cart-ch-${idx}`,
				festivalClassId: "cart-c0",
			}));
		const evaluate = (items: ProposedPurchaseLineItem[]) =>
			checkoutService.evaluateEligibility({
				organizationId: ORG_ID,
				customerId: PARENT_ID,
				festivalId: FEST_ID,
				items,
			});

		const m2 = await measureSqlUnsafe(() => evaluate(itemsFor(2)));
		expect(m2.result.results.map((r) => r.reasonCode)).toEqual([
			"AVAILABLE",
			"AVAILABLE",
		]);
		for (let idx = 2; idx < 8; idx += 1) {
			await seedChildWithAge(schema, `cart-ch-${idx}`, PARENT_ID);
		}
		const m8 = await measureSqlUnsafe(() => evaluate(itemsFor(8)));
		expect(m8.result.isEligible).toBe(true);
		expect(m8.result.results).toHaveLength(8);
		expect(m8.result.results.every((r) => r.reasonCode === "AVAILABLE")).toBe(
			true,
		);
		for (const badId of ["idor-child", "missing-child"]) {
			await expect(
				evaluate([{ childId: badId, festivalClassId: "cart-c0" }]),
			).rejects.toEqual(new AppError("Child not found.", 404));
		}
		const childQueries = m8.queries.filter((q) =>
			/FROM\s+\S*festival_children\b/i.test(q),
		);
		expect({ q8: m8.count, childQueries: childQueries.length }).toEqual({
			q8: m2.count,
			childQueries: 1,
		});
	});
});
