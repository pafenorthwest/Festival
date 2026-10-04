import { describe, expect, it } from "bun:test";
import type { RegistrationRepertoireItem } from "@festival/common";
import { insertRepertoireSnapshot } from "../src/checkout/postgres-checkout-helpers.js";

describe("insertRepertoireSnapshot", () => {
	it("inserts repertoire items and contributors as scalar parameterized rows", async () => {
		const calls: Array<{ sql: string; params?: unknown[] }> = [];
		const tx = {
			unsafe: async (sql: string, params?: unknown[]) => {
				calls.push({ sql, params });
			},
		};
		const items: RegistrationRepertoireItem[] = [
			{
				id: "item-1",
				organizationId: "organization-1",
				registrationMetadataId: "metadata-1",
				displayOrder: 1,
				catalogWorkId: null,
				titleSnapshot: "First piece",
				performedMovementText: null,
				durationSeconds: 180,
				contributors: [
					{
						id: "contributor-1",
						displayOrder: 1,
						role: "Composer",
						displayNameSnapshot: "First Composer",
						catalogContributorId: null,
					},
					{
						id: "contributor-2",
						displayOrder: 2,
						role: "Arranger",
						displayNameSnapshot: "Second Arranger",
						catalogContributorId: null,
					},
				],
			},
			{
				id: "item-2",
				organizationId: "organization-1",
				registrationMetadataId: "metadata-1",
				displayOrder: 2,
				catalogWorkId: "catalog-work-2",
				titleSnapshot: "Second piece",
				performedMovementText: "Movement II",
				durationSeconds: 240,
				contributors: [],
			},
		];

		await insertRepertoireSnapshot(tx, "org_organization_1", items);

		expect(calls).toHaveLength(4);
		expect(calls.every((call) => !call.sql.includes("jsonb_to_recordset"))).toBe(
			true,
		);
		expect(calls[0]).toMatchObject({
			params: [
				"item-1",
				"organization-1",
				"metadata-1",
				"First piece",
				null,
				180,
				1,
			],
		});
		expect(calls[1]).toMatchObject({
			params: [
				"item-2",
				"organization-1",
				"metadata-1",
				"Second piece",
				"Movement II",
				240,
				2,
			],
		});
		expect(calls[2]).toMatchObject({
			params: [
				"contributor-1",
				"organization-1",
				"item-1",
				"First Composer",
				"Composer",
				1,
			],
		});
		expect(calls[3]).toMatchObject({
			params: [
				"contributor-2",
				"organization-1",
				"item-1",
				"Second Arranger",
				"Arranger",
				2,
			],
		});
	});
});
