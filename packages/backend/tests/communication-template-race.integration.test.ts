import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "bun";
import { PostgresCommunicationRepository } from "../src/communication/postgres-communication-repository.js";
import {
	currentPostgresFixture,
	resetPostgresFixture,
} from "./postgres-test-fixture.js";

const currentSchema = currentPostgresFixture("comm_tmpl_race");
const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

describe("PostgresCommunicationRepository.createTemplate concurrency (#467 Item 2)", () => {
	integrationTest(
		"allocates sequential versions 1..5 across 5 concurrent createTemplate calls without 23505 collisions",
		async () => {
			const schema = await currentSchema();
			try {
				const repo = new PostgresCommunicationRepository(schema);
				await repo.ensureReady();

				const organizationId = randomUUID();
				await sql.unsafe(
					`INSERT INTO ${schema}.organizations (id, name, slug) VALUES ($1, $2, $3)`,
					[organizationId, "Template Race Org", "template-race-org"],
				);

				const created = await Promise.all(
					Array.from({ length: 5 }, (_, idx) =>
						repo.createTemplate({
							organizationId,
							templateKey: "welcome",
							channel: "email",
							subject: `Welcome v${idx + 1} {{name}}`,
							body: "Hello {{name}}",
						}),
					),
				);

				const versions = created.map((t) => t.version).sort((a, b) => a - b);
				expect(versions).toEqual([1, 2, 3, 4, 5]);
			} finally {
				await resetPostgresFixture(schema);
			}
		},
	);
});
