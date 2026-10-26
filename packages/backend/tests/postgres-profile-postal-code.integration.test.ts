import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { CustomerMailingAddress } from "@festival/common";
import { sql } from "bun";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";

const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

for (const role of ["teacher", "accompanist"] as const) {
	for (const lookup of ["customer", "profile", "list"] as const) {
		integrationTest(
			`${role} ${lookup} lookup reads stored postalCode and omits zip_code without an address`,
			async () => {
				const schema = `profile_postal_${randomUUID().replaceAll("-", "")}`;
				try {
					const repository = new PostgresOrganizationRepository(schema);
					const organization = await repository.createOrganization({
						name: "Postal profile test",
						slug: "postal-profile-test",
					});
					const address: CustomerMailingAddress = {
						line1: "123 Main Street",
						city: "Seattle",
						region: "WA",
						postalCode: "98101",
						countryCode: "US",
					};
					const profiles = [];
					for (const customerId of ["with-address", "without-address"]) {
						await sql.unsafe(
							`INSERT INTO ${schema}.festival_customers
							 (id, organization_id, shopify_customer_gid, created_at, updated_at)
							 VALUES ($1, $2, $3, NOW(), NOW())`,
							[
								customerId,
								organization.id,
								`gid://shopify/Customer/${customerId}`,
							],
						);
						if (customerId === "with-address") {
							// Seed the canonical address as a JSONB object; this tests profile reads.
							await sql.unsafe(
								`UPDATE ${schema}.festival_customers SET mailing_address = $1::jsonb WHERE organization_id = $2 AND id = $3`,
								[address, organization.id, customerId],
							);
							const stored = await sql.unsafe(
								`SELECT jsonb_typeof(mailing_address) AS shape, mailing_address->>'postalCode' AS postal_code FROM ${schema}.festival_customers WHERE organization_id = $1 AND id = $2`,
								[organization.id, customerId],
							);
							expect(stored[0]).toMatchObject({
								shape: "object",
								postal_code: address.postalCode,
							});
						}
						const input = {
							organizationId: organization.id,
							customerId,
							displayName: customerId,
							publicDirectoryOptIn: false,
							divisionIds: [],
						};
						profiles.push(
							role === "teacher"
								? await repository.upsertTeacherProfile(input)
								: await repository.upsertAccompanistProfile(input),
						);
					}

					const results =
						lookup === "list"
							? role === "teacher"
								? await repository.listTeacherProfiles(organization.id)
								: await repository.listAccompanistProfiles(organization.id)
							: await Promise.all(
									profiles.map((profile) => {
										if (lookup === "customer") {
											return role === "teacher"
												? repository.getTeacherProfile(
														organization.id,
														profile.customer_id,
													)
												: repository.getAccompanistProfile(
														organization.id,
														profile.customer_id,
													);
										}
										return role === "teacher"
											? repository.getTeacherProfileById(
													organization.id,
													profile.id,
												)
											: repository.getAccompanistProfileById(
													organization.id,
													profile.id,
												);
									}),
								);
					expect(results).toHaveLength(2);
					const withAddress = results.find(
						(profile) => profile?.customer_id === "with-address",
					);
					const withoutAddress = results.find(
						(profile) => profile?.customer_id === "without-address",
					);
					expect(withAddress?.zip_code).toBe(address.postalCode);
					expect(withoutAddress).toBeDefined();
					expect(withoutAddress).not.toHaveProperty("zip_code");
				} finally {
					await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
				}
			},
		);
	}
}
