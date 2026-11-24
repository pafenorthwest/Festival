import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { PostgresAppUserMembershipRepository } from "../../../src/domains/tenant-org/index.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "../../postgres-test-fixture.js";

const currentSchema = currentPostgresFixture("org_user_race");
const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

describe("PostgresAppUserMembershipRepository.upsertUser concurrency & COALESCE (#466 Item 3)", () => {
	integrationTest(
		"resolves 8 concurrent first-login upsertUser calls atomically without 23505 and preserves COALESCE/disassociated semantics",
		async () => {
			const schema = await currentSchema();
			try {
				const repo = new PostgresAppUserMembershipRepository(schema);
				await repo.ensureReady();

				const results = await Promise.all(
					Array.from({ length: 8 }, () =>
						repo.upsertUser({
							uid: "race-uid",
							email: "Race@Example.com",
							displayName: "Race User",
						}),
					),
				);

				expect(results).toHaveLength(8);
				const canonicalId = results[0].id;
				for (const record of results) {
					expect(record.id).toBe(canonicalId);
					expect(record.firebaseUid).toBe("race-uid");
					expect(record.email).toBe("race@example.com");
					expect(record.displayName).toBe("Race User");
					expect(record.disassociated).toBe(false);
				}

				// Mark disassociated = TRUE directly to verify upsertUser resets it to FALSE
				await sql.unsafe(
					`UPDATE ${schema}.users SET disassociated = TRUE WHERE id = $1`,
					[canonicalId],
				);

				// Subsequent upsertUser with null/undefined displayName updates email, preserves display_name, resets disassociated
				const afterNullName = await repo.upsertUser({
					uid: "race-uid",
					email: "NewEmail@Example.com",
					displayName: null as unknown as string,
				});
				expect(afterNullName.id).toBe(canonicalId);
				expect(afterNullName.email).toBe("newemail@example.com");
				expect(afterNullName.displayName).toBe("Race User");
				expect(afterNullName.disassociated).toBe(false);

				const afterUndefinedName = await repo.upsertUser({
					uid: "race-uid",
					email: "SecondEmail@Example.com",
					displayName: undefined as unknown as string,
				});
				expect(afterUndefinedName.id).toBe(canonicalId);
				expect(afterUndefinedName.email).toBe("secondemail@example.com");
				expect(afterUndefinedName.displayName).toBe("Race User");

				// Subsequent upsertUser with explicit non-null displayName updates display_name
				const afterExplicitName = await repo.upsertUser({
					uid: "race-uid",
					email: "SecondEmail@Example.com",
					displayName: "Renamed User",
				});
				expect(afterExplicitName.id).toBe(canonicalId);
				expect(afterExplicitName.displayName).toBe("Renamed User");

				// Brand-new user with undefined displayName falls back to derived display name without 23502
				const derivedNewUser = await repo.upsertUser({
					uid: "derived-uid",
					email: "fallback.user@example.com",
					displayName: undefined as unknown as string,
				});
				expect(derivedNewUser.displayName).toBe("fallback.user");
			} finally {
				await resetPostgresFixture(schema);
			}
		},
	);
});
