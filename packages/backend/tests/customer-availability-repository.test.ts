import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { sql } from "bun";
import {
	CorruptAvailabilityDataError,
	type CorruptAvailabilityRecordContext,
	PostgresCustomerAvailabilityRepository,
	parseAvailabilityHours,
	parseHoursJson,
} from "../src/customer/customer-availability-repository.js";

describe("CustomerAvailabilityRepository - Corrupt Record Diagnostics", () => {
	const sampleContext: CorruptAvailabilityRecordContext = {
		organizationId: "org-test-123",
		festivalId: "fest-spring-2026",
		customerId: "cust-owner-456",
		subjectType: "child",
		subjectId: "child-789",
		festivalDate: "2026-07-15",
		rawPayload: null,
	};

	it("parses valid array and valid JSON string of availability hours", () => {
		const fromArray = parseAvailabilityHours([10, 8, 9, 8], {
			...sampleContext,
			rawPayload: [10, 8, 9, 8],
		});
		expect(fromArray).toEqual([8, 9, 10]);

		const fromJson = parseAvailabilityHours("[12, 11, 13]", {
			...sampleContext,
			rawPayload: "[12, 11, 13]",
		});
		expect(fromJson).toEqual([11, 12, 13]);
	});

	it("throws CorruptAvailabilityDataError on invalid JSON with exact diagnostic context", () => {
		const raw = "{bad-json: true";
		let caught: CorruptAvailabilityDataError | null = null;

		try {
			parseAvailabilityHours(raw, {
				...sampleContext,
				rawPayload: raw,
			});
		} catch (error) {
			caught = error as CorruptAvailabilityDataError;
		}

		expect(caught).toBeInstanceOf(CorruptAvailabilityDataError);
		expect(caught?.organization_id).toBe("org-test-123");
		expect(caught?.organizationId).toBe("org-test-123");
		expect(caught?.festival_id).toBe("fest-spring-2026");
		expect(caught?.festivalId).toBe("fest-spring-2026");
		expect(caught?.customer_id).toBe("cust-owner-456");
		expect(caught?.customerId).toBe("cust-owner-456");
		expect(caught?.subject_type).toBe("child");
		expect(caught?.subjectType).toBe("child");
		expect(caught?.subject_id).toBe("child-789");
		expect(caught?.subjectId).toBe("child-789");
		expect(caught?.festival_date).toBe("2026-07-15");
		expect(caught?.festivalDate).toBe("2026-07-15");
		expect(caught?.raw_payload).toBe(raw);
		expect(caught?.rawPayload).toBe(raw);

		expect(caught?.message).toContain("organization_id=org-test-123");
		expect(caught?.message).toContain("festival_id=fest-spring-2026");
		expect(caught?.message).toContain("customer_id=cust-owner-456");
		expect(caught?.message).toContain("subject_type=child");
		expect(caught?.message).toContain("subject_id=child-789");
		expect(caught?.message).toContain("festival_date=2026-07-15");
		expect(caught?.message).toContain("raw_payload={bad-json: true");
	});

	it("throws CorruptAvailabilityDataError on non-array payloads", () => {
		const payloads = [{ hours: [8, 9] }, 12345, "plain text", null, undefined];

		for (const raw of payloads) {
			expect(() =>
				parseAvailabilityHours(raw, {
					...sampleContext,
					rawPayload: raw,
				}),
			).toThrow(CorruptAvailabilityDataError);
		}
	});

	it("throws CorruptAvailabilityDataError on out-of-range hours", () => {
		const outOfRangeList = [
			[7], // before 8
			[18], // after 17
			[0],
			[-1],
			[24],
			[8, 9, 99],
		];

		for (const raw of outOfRangeList) {
			let caught: CorruptAvailabilityDataError | null = null;
			try {
				parseAvailabilityHours(raw, {
					...sampleContext,
					rawPayload: raw,
				});
			} catch (error) {
				caught = error as CorruptAvailabilityDataError;
			}

			expect(caught).toBeInstanceOf(CorruptAvailabilityDataError);
			expect(caught?.customer_id).toBe("cust-owner-456");
			expect(caught?.message).toContain("invalid hour");
		}
	});

	it("throws CorruptAvailabilityDataError on non-number or non-integer elements", () => {
		const invalidElementList = [
			[8, "9", 10],
			[8, null, 10],
			[8, undefined, 10],
			[8.5, 9],
			[{ hour: 8 }],
		];

		for (const raw of invalidElementList) {
			let caught: CorruptAvailabilityDataError | null = null;
			try {
				parseAvailabilityHours(raw, {
					...sampleContext,
					rawPayload: raw,
				});
			} catch (error) {
				caught = error as CorruptAvailabilityDataError;
			}

			expect(caught).toBeInstanceOf(CorruptAvailabilityDataError);
			expect(caught?.customer_id).toBe("cust-owner-456");
			expect(caught?.message).toContain("invalid hour");
		}
	});

	it("parseHoursJson uses provided partial context or defaults", () => {
		expect(parseHoursJson([8, 9])).toEqual([8, 9]);

		expect(() =>
			parseHoursJson("[invalid", {
				customerId: "cust-specific",
			}),
		).toThrow(CorruptAvailabilityDataError);
	});
});

describe("PostgresCustomerAvailabilityRepository - upsertAvailability multi-row query", () => {
	let repo: PostgresCustomerAvailabilityRepository;
	let unsafeSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		repo = new PostgresCustomerAvailabilityRepository("test_schema");
		unsafeSpy = spyOn(sql, "unsafe");
	});

	afterEach(() => {
		unsafeSpy.mockRestore();
	});

	it("returns early without executing query when entries is empty", async () => {
		await repo.upsertAvailability([]);
		expect(unsafeSpy).not.toHaveBeenCalled();
	});

	it("executes a single multi-row INSERT query with flattened parameters", async () => {
		unsafeSpy.mockResolvedValueOnce([]);

		const entries = [
			{
				organizationId: "org-1",
				festivalId: "fest-1",
				customerId: "cust-1",
				subjectType: "child" as const,
				subjectId: "child-1",
				festivalDate: "2026-07-15",
				availableHours: [10, 8, 9],
			},
			{
				organizationId: "org-1",
				festivalId: "fest-1",
				customerId: "cust-1",
				subjectType: "teacher" as const,
				subjectId: "teacher-1",
				festivalDate: "2026-07-16",
				availableHours: [14, 15],
			},
		];

		await repo.upsertAvailability(entries);

		expect(unsafeSpy).toHaveBeenCalledTimes(1);
		const [query, params] = unsafeSpy.mock.calls[0] as [string, unknown[]];

		expect(query).toContain(
			"INSERT INTO test_schema.customer_festival_availability",
		);
		expect(query).toContain(
			"VALUES ($1, $2, $3, $4, $5, $6::date, $7::jsonb, NOW()), ($8, $9, $10, $11, $12, $13::date, $14::jsonb, NOW())",
		);
		expect(query).toContain(
			"ON CONFLICT (organization_id, festival_id, subject_type, subject_id, festival_date)",
		);
		expect(query).toContain(
			"WHERE customer_festival_availability.customer_id = EXCLUDED.customer_id",
		);

		expect(params).toEqual([
			"org-1",
			"fest-1",
			"cust-1",
			"child",
			"child-1",
			"2026-07-15",
			[8, 9, 10],
			"org-1",
			"fest-1",
			"cust-1",
			"teacher",
			"teacher-1",
			"2026-07-16",
			[14, 15],
		]);
	});
});
