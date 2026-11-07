import { expect, test } from "bun:test";
import { sql } from "bun";
import {
	PostgresCustomerAvailabilityRepository,
	type UpsertCustomerFestivalAvailabilityInput,
} from "../src/customer/customer-availability-repository.js";
import { withApplicationRollback } from "./postgres-application-fixture.js";

const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

integrationTest(
	"stores and updates normalized availability as JSONB arrays with scoped batching",
	async () => {
		await withApplicationRollback(async (fixture) => {
			const schema = fixture.schema;
			const repository = fixture.repository(
				new PostgresCustomerAvailabilityRepository(schema),
			);
			await repository.ensureReady();
			await sql.unsafe(`
			INSERT INTO ${schema}.organizations (id,name,slug) VALUES ('${fixture.id("org-a")}','${fixture.id("Organization-A")}','${fixture.id("org-a")}'),('${fixture.id("org-b")}','${fixture.id("Organization-B")}','${fixture.id("org-b")}');
			INSERT INTO ${schema}.festivals (id,organization_id,code,short_name,is_primary,name,start_date,end_date) VALUES ('${fixture.id("festival-a")}','${fixture.id("org-a")}','FESTA','fest-a',TRUE,'Festival A','2027-01-01','2027-01-02'),('${fixture.id("festival-b")}','${fixture.id("org-b")}','FESTB','fest-b',TRUE,'Festival B','2027-01-01','2027-01-02');
			INSERT INTO ${schema}.festival_customers (id,organization_id,shopify_customer_gid,created_at,updated_at) VALUES ('${fixture.id("customer-a")}','${fixture.id("org-a")}','gid://shopify/Customer/${fixture.id("Customer-1")}',NOW(),NOW()),('${fixture.id("other-customer-a")}','${fixture.id("org-a")}','gid://shopify/Customer/${fixture.id("Customer-2")}',NOW(),NOW()),('${fixture.id("customer-b")}','${fixture.id("org-b")}','gid://shopify/Customer/${fixture.id("Customer-3")}',NOW(),NOW());
		`);
			const child: UpsertCustomerFestivalAvailabilityInput = {
				organizationId: fixture.id("org-a"),
				festivalId: fixture.id("festival-a"),
				customerId: fixture.id("customer-a"),
				subjectType: "child",
				subjectId: fixture.id("shared-subject"),
				festivalDate: "2027-01-01",
				availableHours: [17, 8, 10, 8],
			};
			const accompanist: UpsertCustomerFestivalAvailabilityInput = {
				...child,
				subjectType: "accompanist",
				subjectId: fixture.id("customer-a"),
				availableHours: [],
			};
			const otherCustomer: UpsertCustomerFestivalAvailabilityInput = {
				...child,
				customerId: fixture.id("other-customer-a"),
				subjectId: fixture.id("other-subject"),
				availableHours: [11],
			};
			const otherTenant: UpsertCustomerFestivalAvailabilityInput = {
				...child,
				organizationId: fixture.id("org-b"),
				festivalId: fixture.id("festival-b"),
				customerId: fixture.id("customer-b"),
				availableHours: [12, 9, 12],
			};
			await repository.upsertAvailability([
				child,
				accompanist,
				otherCustomer,
				otherTenant,
			]);
			expect(await repository.listAvailability(child)).toMatchObject([
				{ subjectType: "accompanist", availableHours: [] },
				{ subjectType: "child", availableHours: [8, 10, 17] },
			]);
			expect(await repository.listAvailability(otherCustomer)).toMatchObject([
				{ subjectId: fixture.id("other-subject"), availableHours: [11] },
			]);
			expect(await repository.listAvailability(otherTenant)).toMatchObject([
				{ subjectId: fixture.id("shared-subject"), availableHours: [9, 12] },
			]);
			expect(
				await repository.listAvailability({
					...child,
					festivalId: fixture.id("festival-b"),
				}),
			).toEqual([]);
			const stored = await sql.unsafe(
				`SELECT subject_id, jsonb_typeof(available_hours) AS payload_type, available_hours FROM ${schema}.customer_festival_availability WHERE organization_id IN ('${fixture.id("org-a")}' , '${fixture.id("org-b")}') ORDER BY organization_id, subject_type, subject_id`,
			);
			expect(stored).toHaveLength(4);
			expect(stored.map((row) => row.payload_type)).toEqual([
				"array",
				"array",
				"array",
				"array",
			]);
			expect(stored.map((row) => row.available_hours)).toEqual([
				[],
				[11],
				[8, 10, 17],
				[9, 12],
			]);
			await repository.upsertAvailability([
				{ ...child, availableHours: [] },
				{ ...accompanist, availableHours: [14, 12, 14] },
			]);
			// A different customer cannot replace an existing subject's saved availability.
			await repository.upsertAvailability([
				{
					...child,
					customerId: fixture.id("other-customer-a"),
					availableHours: [9],
				},
			]);
			expect(await repository.listAvailability(child)).toMatchObject([
				{ subjectType: "accompanist", availableHours: [12, 14] },
				{
					subjectType: "child",
					customerId: fixture.id("customer-a"),
					availableHours: [],
				},
			]);
			expect(await repository.listAvailability(otherCustomer)).toMatchObject([
				{ subjectId: fixture.id("other-subject"), availableHours: [11] },
			]);
			expect(await repository.listAvailability(otherTenant)).toMatchObject([
				{ availableHours: [9, 12] },
			]);
			const updated = await sql.unsafe(
				`SELECT jsonb_typeof(available_hours) AS payload_type, available_hours FROM ${schema}.customer_festival_availability WHERE organization_id = '${fixture.id("org-a")}' AND customer_id = '${fixture.id("customer-a")}' ORDER BY subject_type`,
			);
			expect(updated.map((row) => row.payload_type)).toEqual([
				"array",
				"array",
			]);
			expect(updated.map((row) => row.available_hours)).toEqual([[12, 14], []]);
			// Exercise the actual database constraint that rejected the old string binding.
			await expect(
				fixture.savepoint(async () => {
					await sql.unsafe(
						`UPDATE ${schema}.customer_festival_availability SET available_hours = '"[8]"'::jsonb WHERE organization_id = '${fixture.id("org-a")}'`,
					);
				}),
			).rejects.toMatchObject({ errno: "23514" });
			expect(await repository.listAvailability(child)).toMatchObject([
				{ availableHours: [12, 14] },
				{ availableHours: [] },
			]);
		});
	},
);
