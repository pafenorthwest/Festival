import { expect, test } from "bun:test";
import { sql } from "bun";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";
import { currentPostgresFixture } from "./postgres-test-fixture.js";

const currentSchema = currentPostgresFixture("scheduling_class_rules");
const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

integrationTest(
	"competing scheduling edits create one revision and preserve its rules and actor after a later edit",
	async () => {
		const schema = await currentSchema();
		const repository = new PostgresOrganizationRepository(schema);
		const org = await repository.createOrganization({
			name: "Scheduling",
			slug: "scheduling",
		});
		const festival = await repository.createFestival({
			id: "spring",
			organizationId: org.id,
			code: "SP",
			shortName: "spring",
			name: "Spring",
			startDate: "2027-04-05",
			endDate: "2027-04-09",
		});
		const store = repository.schedulingClassRules;
		const rule = {
			classId: "catalog-piano",
			code: "PS.6-7",
			playingMinutes: 5,
			oralMinutes: 6,
			sectionLimits: null,
		};
		const first = {
			organizationId: org.id,
			festivalId: festival.id,
			actorUid: "first-admin",
			expectedRevision: 0,
			rules: [rule],
		};
		expect(await store.current(org.id, festival.id)).toEqual({
			revision: 0,
			rules: [],
		});
		const writes = await Promise.allSettled([
			store.save(first),
			store.save(first),
		]);
		expect(
			writes.filter((attempt) => attempt.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			writes.find((attempt) => attempt.status === "rejected"),
		).toMatchObject({ reason: { status: 409 } });
		expect(
			await store.save({
				...first,
				expectedRevision: 1,
				actorUid: "next-admin",
				rules: [],
			}),
		).toEqual({ revision: 2, rules: [] });
		expect(await store.current(org.id, festival.id)).toEqual({
			revision: 2,
			rules: [],
		});
		const stored = await sql.unsafe<
			Array<{
				revision: number;
				config: { classRules: unknown[] };
				actor_uid: string;
			}>
		>(
			`SELECT revision, config, actor_uid FROM ${schema}.scheduling_config_revisions
		 WHERE organization_id = $1 AND festival_id = $2 ORDER BY revision`,
			[org.id, festival.id],
		);
		expect(
			stored.map((row) => ({
				revision: row.revision,
				rules: row.config.classRules,
				actor_uid: row.actor_uid,
			})),
		).toEqual([
			{ revision: 1, rules: [rule], actor_uid: "first-admin" },
			{ revision: 2, rules: [], actor_uid: "next-admin" },
		]);
	},
);
