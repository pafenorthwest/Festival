import { describe, expect, it } from "bun:test";
import type {
	ClassRegistrationMetadata,
	ClassRegistrationSnapshot,
} from "@festival/common";
import { InMemoryCheckoutRepository } from "../src/checkout/checkout-repository.js";
import { registrationMetadataFromRow } from "../src/checkout/postgres-checkout-helpers.js";

function selection(): ClassRegistrationSnapshot {
	return {
		version: 1,
		capturedAtIso: "2026-10-22T00:00:00.000Z",
		class: {
			id: "class",
			festivalId: "festival",
			displayName: "Original class",
			classSubtypeId: "subtype",
			classSubtypeName: "Solo",
			minimumAge: 5,
			maximumAge: 18,
			price: "50.00",
			currencyCode: "USD",
			maximumPerformancePieces: 2,
			performanceMinutes: 10,
			capacity: 20,
		},
		division: { id: "division", name: "Original division" },
		instrument: { id: "instrument", name: "Piano" },
		teacher: {
			customerId: "teacher",
			membershipId: "membership",
			name: "Teacher",
		},
		accompanist: null,
		repertoire: [
			{
				title: "Original work",
				composer: "Composer",
				movement: "II",
				durationSeconds: 120,
			},
		],
	};
}

const metadataInput = {
	id: "metadata",
	organizationId: "org",
	festivalId: "festival",
	checkoutIntentId: "intent",
	teacherMembershipId: "membership",
	accompanistMembershipId: null,
	repertoireJson: [],
};

function metadataRow(snapshot: unknown) {
	return {
		id: "metadata",
		organization_id: "org",
		festival_id: "festival",
		checkout_intent_id: "intent",
		teacher_membership_id: "membership",
		repertoire_json: [],
		created_at: "2026-10-22T00:00:00.000Z",
		registration_snapshot: snapshot,
	};
}

describe("registration snapshot instrument compatibility", () => {
	for (const [name, instrument] of [
		["missing", undefined],
		["null", null],
		["sentinel", "unknown"],
		["known", { id: "instrument", name: "Piano" }],
	] as const) {
		const { instrument: _originalInstrument, ...otherFields } = selection();
		const legacy =
			name === "missing" ? otherFields : { ...otherFields, instrument };
		const expected = { ...otherFields, instrument: instrument ?? "unknown" };
		it(`normalizes ${name} instruments in PostgreSQL object and JSON-string reads`, () => {
			for (const representation of [legacy, JSON.stringify(legacy)]) {
				expect(
					registrationMetadataFromRow(metadataRow(representation))
						.registrationSnapshot,
				).toEqual(expected);
			}
			expect(legacy).toEqual(
				name === "missing" ? otherFields : { ...otherFields, instrument },
			);
		});
		it(`normalizes ${name} instruments at in-memory insertion and pre-existing record reads/updates`, async () => {
			const repository = new InMemoryCheckoutRepository();
			const inserted = await repository.insertRegistrationMetadata({
				...metadataInput,
				registrationSnapshot: legacy as ClassRegistrationSnapshot,
			});
			expect(inserted.registrationSnapshot).toEqual(expected);
			await repository.linkRegistrationMetadataToEntitlement({
				checkoutIntentId: "intent",
				classEntitlementId: "entitlement",
			});
			// Simulate an in-memory record that predates normalization at insertion.
			const records = (
				repository as unknown as {
					registrationMetadata: Map<string, ClassRegistrationMetadata>;
				}
			).registrationMetadata;
			const stored = records.get("metadata");
			if (!stored) throw new Error("Expected stored metadata.");
			stored.registrationSnapshot = structuredClone(
				legacy,
			) as ClassRegistrationSnapshot;
			expect(
				(
					await repository.getRegistrationMetadataByEntitlementId(
						"org",
						"entitlement",
					)
				)?.registrationSnapshot,
			).toEqual(expected);
			const updated = await repository.updateRegistrationMetadata(
				"metadata",
				"org",
				{
					pieces: [
						{ title: "Replacement", composer: "Other", durationSeconds: 60 },
					],
				},
			);
			expect(updated.registrationSnapshot).toEqual(expected);
		});
	}
	for (const snapshot of [undefined, null]) {
		it(`preserves a wholly ${snapshot} historical snapshot`, async () => {
			expect(
				registrationMetadataFromRow(metadataRow(snapshot)).registrationSnapshot,
			).toBeNull();
			const repository = new InMemoryCheckoutRepository();
			expect(
				(
					await repository.insertRegistrationMetadata({
						...metadataInput,
						registrationSnapshot: snapshot,
					})
				).registrationSnapshot,
			).toBeNull();
		});
	}
});
