import { expect, test } from "bun:test";
import { sql } from "bun";
import { postgresCatalogContract } from "./postgres-catalog-contract.js";
import { currentPostgresFixture } from "./postgres-test-fixture.js";

const currentSchema = currentPostgresFixture("catalog_reference");
const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

integrationTest(
	"application schema retains the required current catalog contract (read-only)",
	async () => {
		const schema = await currentSchema();
		const applicationSchema = process.env.DB_SCHEMA?.trim() || "orgs";
		expect(applicationSchema).toMatch(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/);
		const expected = await postgresCatalogContract(schema);
		const actual = new Set(await postgresCatalogContract(applicationSchema));
		expect(expected.length).toBeGreaterThan(100);
		const required = new Set(expected);
		expect({
			missing: expected.filter((signature) => !actual.has(signature)),
			restrictiveExtra: [...actual].filter(
				(signature) =>
					!required.has(signature) &&
					(signature.startsWith("constraint:") ||
						/^index:[^:]+:unique=true/.test(signature)),
			),
		}).toEqual({ missing: [], restrictiveExtra: [] });
		const obsolete = await sql.unsafe("SELECT to_regclass($1) AS obsolete", [
			`${applicationSchema}.registration_metadata_checkout_intent_id_unique`,
		]);
		expect(obsolete[0]?.obsolete).toBeNull();
	},
);
