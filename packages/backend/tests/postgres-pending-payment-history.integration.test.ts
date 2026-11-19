import { expect, test } from "bun:test";
import { sql } from "bun";
import { PostgresMembershipCommerceRepository } from "../src/commerce/postgres-membership-commerce-repository.js";
import { upsertOrderProjectionTx } from "../src/domains/commerce-projection/order-projection-membership-tx.js";
import type { ShopifyOrderProjectionInput } from "../src/domains/commerce-projection/order-projection-types.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "./postgres-test-fixture.js";

const currentSchema = currentPostgresFixture("pending_payment_history");
const postgresTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;
const PAID_AT = "2026-11-15T10:00:00.000Z";
const INITIAL_OBSERVED_AT = "2026-11-15T10:01:00.000Z";
const LATER_OBSERVED_AT = "2026-11-15T11:00:00.000Z";
const ORDER_GID = "gid://shopify/Order/500";
const OTHER_ORDER_GID = "gid://shopify/Order/501";

async function fixture() {
	const schema = await currentSchema();
	await resetPostgresFixture(schema);
	await sql.unsafe(
		`INSERT INTO ${schema}.organizations (id,name,slug) VALUES ('org','Festival','festival'), ('other-org','Other Festival','other-festival')`,
	);
	const commerce = new PostgresMembershipCommerceRepository(schema);
	const paid: ShopifyOrderProjectionInput = {
		organizationId: "org",
		shopifyOrderGid: ORDER_GID,
		shopifyCustomerGid: "gid://shopify/Customer/12",
		correlationId: "original-checkout",
		fullyPaidAtIso: PAID_AT,
		currencyCode: "USD",
		updatedAtIso: INITIAL_OBSERVED_AT,
	};
	await commerce.upsertOrderProjection(paid);
	await commerce.upsertOrderProjection({
		...paid,
		organizationId: "other-org",
		correlationId: "other-organization-checkout",
		fullyPaidAtIso: "2026-11-15T09:00:00.000Z",
	});
	await commerce.upsertOrderProjection({
		...paid,
		shopifyOrderGid: OTHER_ORDER_GID,
		correlationId: "unrelated-checkout",
		fullyPaidAtIso: "2026-11-15T08:00:00.000Z",
	});
	return { schema, commerce, paid };
}

for (const writer of ["repository", "transaction helper"] as const) {
	postgresTest(
		`${writer} preserves historical paid evidence through an incomplete later observation`,
		async () => {
			const { schema, commerce, paid } = await fixture();
			const incomplete: ShopifyOrderProjectionInput = {
				...paid,
				fullyPaidAtIso: undefined,
				updatedAtIso: LATER_OBSERVED_AT,
			};
			const unknown: ShopifyOrderProjectionInput = {
				...incomplete,
				shopifyOrderGid: "gid://shopify/Order/502",
				correlationId: "new-unverified-checkout",
			};
			if (writer === "repository") {
				await commerce.upsertOrderProjection(incomplete);
				await commerce.upsertOrderProjection(unknown);
			} else {
				await sql.begin(async (tx) => {
					await upsertOrderProjectionTx(tx, schema, incomplete);
					await upsertOrderProjectionTx(tx, schema, unknown);
				});
			}

			const projections = await commerce.listOrderProjectionsByGids("org", [
				ORDER_GID,
				OTHER_ORDER_GID,
				unknown.shopifyOrderGid,
			]);
			expect(projections).toHaveLength(3);
			const original = projections.find(
				(value) => value.shopifyOrderGid === ORDER_GID,
			);
			expect(Date.parse(original?.fullyPaidAtIso ?? "")).toBe(
				Date.parse(PAID_AT),
			);
			expect(Date.parse(original?.createdAtIso ?? "")).toBe(
				Date.parse(INITIAL_OBSERVED_AT),
			);
			expect(Date.parse(original?.updatedAtIso ?? "")).toBe(
				Date.parse(LATER_OBSERVED_AT),
			);
			expect(original?.correlationId).toBe("original-checkout");
			const unverified = projections.find(
				(value) => value.shopifyOrderGid === unknown.shopifyOrderGid,
			);
			expect(unverified?.fullyPaidAtIso).toBeUndefined();
			expect(unverified?.correlationId).toBe("new-unverified-checkout");

			const unrelated = projections.find(
				(value) => value.shopifyOrderGid === OTHER_ORDER_GID,
			);
			expect(Date.parse(unrelated?.fullyPaidAtIso ?? "")).toBe(
				Date.parse("2026-11-15T08:00:00.000Z"),
			);
			expect(Date.parse(unrelated?.updatedAtIso ?? "")).toBe(
				Date.parse(INITIAL_OBSERVED_AT),
			);
			const otherOrganization = await commerce.listOrderProjectionsByGids(
				"other-org",
				[ORDER_GID, unknown.shopifyOrderGid],
			);
			expect(otherOrganization).toHaveLength(1);
			expect(otherOrganization[0]?.correlationId).toBe(
				"other-organization-checkout",
			);
			expect(Date.parse(otherOrganization[0]?.fullyPaidAtIso ?? "")).toBe(
				Date.parse("2026-11-15T09:00:00.000Z"),
			);
			expect(Date.parse(otherOrganization[0]?.updatedAtIso ?? "")).toBe(
				Date.parse(INITIAL_OBSERVED_AT),
			);
		},
	);
}
