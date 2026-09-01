import { describe, expect, it } from "bun:test";

async function source() {
	return Bun.file(
		new URL(
			"../src/commerce/postgres-membership-commerce-repository.ts",
			import.meta.url,
		),
	).text();
}

describe("PostgresMembershipCommerceRepository", () => {
	it("rechecks active grants after taking the customer finalization lock", async () => {
		const value = await source();

		expect(value).toContain("let finalDecision = input.decision;");
		expect(value).toContain(
			"grants.ends_on > (NOW() AT TIME ZONE organization.timezone)::date",
		);
		expect(value).toContain('reasonCode: "duplicate_purchase"');
		expect(value).toContain("grantInput = undefined;");
		expect(value).toContain("if (grantInput) {");
	});
});
