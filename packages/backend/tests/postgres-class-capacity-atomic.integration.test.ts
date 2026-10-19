import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "bun";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";
import { initializePostgresSchema } from "../src/repo/postgres-schema.js";

const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

integrationTest(
	"PostgreSQL rolls back class mutations when auditing fails and serializes capacity history",
	async () => {
		const schema = `capacity_atomic_${randomUUID().replaceAll("-", "")}`;
		try {
			await initializePostgresSchema(schema);
			const repo = new PostgresOrganizationRepository(schema);
			const org = await repo.createOrganization({
				name: "Atomic",
				slug: "atomic",
			});
			const festival = await repo.createFestival({
				id: "festival",
				organizationId: org.id,
				code: "AT",
				shortName: "at",
				name: "Atomic",
				startDate: "2027-01-01",
				endDate: "2027-01-02",
			});
			const division = await repo.createDivision({
				organizationId: org.id,
				displayName: "Piano",
				normalizedName: "piano",
			});
			const subtype = await repo.createRegistrationCatalogValue({
				organizationId: org.id,
				kind: "class_subtype",
				displayName: "Solo",
				normalizedName: "solo",
			});
			const input = {
				organizationId: org.id,
				festivalId: festival.id,
				displayName: "Atomic class",
				divisionId: division.id,
				classSubtypeId: subtype.id,
				minimumAge: 5,
				maximumAge: 18,
				price: "30.00",
				maximumPerformancePieces: 1 as const,
				performanceMinutes: 5,
				capacity: 25,
				shopifyProductGid: "gid://shopify/Product/atomic",
				shopifyVariantGid: "gid://shopify/ProductVariant/atomic",
			};
			await sql.unsafe(
				`CREATE FUNCTION ${schema}.reject_capacity_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Capacity audit unavailable'; END $$`,
			);
			const enableFailure = () =>
				sql.unsafe(
					`CREATE TRIGGER reject_capacity_audit BEFORE INSERT ON ${schema}.festival_class_capacity_audit_logs FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_capacity_audit()`,
				);
			const disableFailure = () =>
				sql.unsafe(
					`DROP TRIGGER reject_capacity_audit ON ${schema}.festival_class_capacity_audit_logs`,
				);
			await enableFailure();
			await expect(
				repo.createFestivalClassConfigurationWithCapacityAudit(
					input,
					"admin-create",
				),
			).rejects.toThrow("Capacity audit unavailable");
			expect(
				await repo.listFestivalClassConfigurations(org.id, festival.id, false),
			).toEqual([]);
			expect(
				await sql.unsafe(
					`SELECT id FROM ${schema}.festival_class_capacity_audit_logs`,
				),
			).toHaveLength(0);
			await disableFailure();
			const created =
				await repo.createFestivalClassConfigurationWithCapacityAudit(
					input,
					"admin-create",
				);
			await enableFailure();
			const update = {
				id: created.id,
				organizationId: org.id,
				festivalId: festival.id,
				capacity: 10,
				displayName: "Changed",
			};
			await expect(
				repo.updateFestivalClassConfigurationWithCapacityAudit(
					update,
					"admin-update",
				),
			).rejects.toThrow("Capacity audit unavailable");
			expect(
				await repo.findFestivalClassConfigurationById(
					org.id,
					festival.id,
					created.id,
				),
			).toEqual(created);
			expect(
				await repo.listFestivalClassCapacityAudits(org.id, created.id),
			).toHaveLength(1);
			await disableFailure();
			await repo.updateFestivalClassConfigurationWithCapacityAudit(
				update,
				"admin-update",
			);
			let audits = await repo.listFestivalClassCapacityAudits(
				org.id,
				created.id,
			);
			expect(audits).toHaveLength(2);
			expect(
				audits.find((audit) => audit.action === "capacity_updated"),
			).toMatchObject({
				previousCapacity: 25,
				newCapacity: 10,
				placedCountAtChange: 0,
				availabilityAfterChange: "open",
				actorUid: "admin-update",
			});
			await repo.updateFestivalClassConfigurationWithCapacityAudit(
				update,
				"admin-retry",
			);
			expect(
				await repo.listFestivalClassCapacityAudits(org.id, created.id),
			).toHaveLength(2);
			await Promise.all(
				[20, 30].map((capacity) =>
					repo.updateFestivalClassConfigurationWithCapacityAudit(
						{ ...update, capacity },
						`admin-${capacity}`,
					),
				),
			);
			audits = await repo.listFestivalClassCapacityAudits(org.id, created.id);
			expect(audits).toHaveLength(4);
			const concurrent = audits.filter(
				(audit) =>
					audit.actorUid === "admin-20" || audit.actorUid === "admin-30",
			);
			const first = concurrent.find((audit) => audit.previousCapacity === 10);
			expect(first).toBeDefined();
			const second = concurrent.find(
				(audit) => audit.previousCapacity === first?.newCapacity,
			);
			expect(second).toBeDefined();
			expect(second?.id).not.toBe(first?.id);
			expect(
				(
					await repo.findFestivalClassConfigurationById(
						org.id,
						festival.id,
						created.id,
					)
				)?.capacity,
			).toBe(second?.newCapacity);
		} finally {
			await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
		}
	},
);
