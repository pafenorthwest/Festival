import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { ClassRegistrationSnapshot } from "@festival/common";
import { sql } from "bun";
import { PostgresCheckoutRepository } from "../src/checkout/postgres-checkout-repository.js";
import {
	buildCanonicalPostgresSchemaSql,
	initializePostgresSchema,
} from "../src/repo/postgres-schema.js";

const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

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
			customerId: "parent",
			membershipId: "teacher",
			name: "Original teacher",
		},
		accompanist: null,
		repertoire: [
			{
				title: "Original work",
				composer: "Composer",
				movement: "Variation I",
				durationSeconds: 120,
			},
		],
	};
}

integrationTest(
	"upgrades an existing schema and round-trips immutable selections while preserving legacy unknowns",
	async () => {
		const schema = `snapshot_${randomUUID().replaceAll("-", "")}`;
		try {
			await sql.unsafe(`CREATE SCHEMA ${schema}`);
			// Model an installed schema from before this nullable snapshot column existed.
			await sql.unsafe(
				buildCanonicalPostgresSchemaSql(schema).replace(
					"registration_snapshot JSONB,",
					"",
				),
			);
			const snapshotColumn = () =>
				sql.unsafe(
					"SELECT data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'registration_metadata' AND column_name = 'registration_snapshot'",
					[schema],
				);
			expect(await snapshotColumn()).toHaveLength(0);
			const migration = (
				await Bun.file(
					new URL(
						"../../../database/migrations/20261023010000_registration_selection_snapshot.sql",
						import.meta.url,
					),
				).text()
			).replaceAll("orgs.", `${schema}.`);
			const migrationBody = migration.replace(/^BEGIN;|^COMMIT;/gm, "");
			await sql.begin((tx) => tx.unsafe(migrationBody));
			await sql.begin((tx) => tx.unsafe(migrationBody));
			expect((await snapshotColumn())[0]?.data_type).toBe("jsonb");
			// Exercise the independent runtime upgrade path against an empty old table.
			await sql.unsafe(
				`ALTER TABLE ${schema}.registration_metadata DROP COLUMN registration_snapshot`,
			);
			await initializePostgresSchema(schema);
			expect((await snapshotColumn())[0]?.data_type).toBe("jsonb");
			await sql.unsafe(`
			INSERT INTO ${schema}.organizations (id,name,slug) VALUES ('org','Organization','org');
			INSERT INTO ${schema}.organization_divisions (id,organization_id,display_name,normalized_name,display_order) VALUES ('division','org','Original division','original',0);
			INSERT INTO ${schema}.registration_catalog_values (id,organization_id,kind,display_name,normalized_name,display_order) VALUES ('subtype','org','class_subtype','Solo','solo',0);
			INSERT INTO ${schema}.festivals (id,organization_id,code,short_name,is_primary,name,start_date,end_date) VALUES ('festival','org','FEST','fest',TRUE,'Festival','2027-01-01','2027-01-02');
			INSERT INTO ${schema}.festival_customers (id,organization_id,shopify_customer_gid,created_at,updated_at) VALUES ('parent','org','gid://shopify/Customer/1',NOW(),NOW());
			INSERT INTO ${schema}.festival_children (id,organization_id,parent_customer_id,display_name,created_at) VALUES ('child','org','parent','Child',NOW());
			INSERT INTO ${schema}.festival_class_configurations (id,organization_id,festival_id,display_name,class_subtype_id,division_id,minimum_age,maximum_age,price,maximum_performance_pieces,performance_minutes,capacity,shopify_product_gid,shopify_variant_gid) VALUES ('class','org','festival','Original class','subtype','division',5,18,'50.00',2,10,20,'product','variant');
			INSERT INTO ${schema}.products (id,organization_id,product_category,entitlement_class,duration_days,shopify_product_gid,shopify_variant_gid,product_name_snapshot) VALUES ('product-teacher','org','membership','teacher_membership',365,'teacher-product','teacher-variant','Teacher');
			INSERT INTO ${schema}.membership_entitlements (id,organization_id,customer_id,entitlement_class,source,offering_id,starts_on,ends_on) VALUES ('teacher','org','parent','teacher_membership','teacher_checkout','product-teacher','2026-01-01','2027-01-01');
			INSERT INTO ${schema}.checkout_intents (id,correlation_id,organization_id,customer_id,session_id,idempotency_key,intent_type,festival_class_id,child_id,shopify_product_gid,shopify_variant_gid,amount,currency_code,status,expires_at) VALUES ('intent','correlation','org','parent','session','key','class_entry','class','child','product','variant','100.00','USD','checkout_started',NOW()+INTERVAL '1 hour');
			INSERT INTO ${schema}.checkout_intent_lines (id,checkout_intent_id,line_index,line_type,festival_class_id,child_id,shopify_product_gid,shopify_variant_gid,amount,currency_code) VALUES ('line-1','intent',0,'class_entry','class','child','product','variant','50.00','USD'),('line-2','intent',1,'class_entry','class','child','product','variant','50.00','USD');
		`);
			const repository = new PostgresCheckoutRepository(schema);
			const original = selection();
			const { instrument: _instrument, ...withoutInstrument } = original;
			const snapshots: Array<ClassRegistrationSnapshot | null> = [
				original,
				null,
				{
					...original,
					instrument: null,
				} as unknown as ClassRegistrationSnapshot,
				withoutInstrument as ClassRegistrationSnapshot,
				{ ...original, instrument: "unknown" },
			];
			for (const [index, snapshot] of snapshots.entries()) {
				if (index > 1)
					await sql.unsafe(
						`INSERT INTO ${schema}.checkout_intent_lines (id,checkout_intent_id,line_index,line_type,festival_class_id,child_id,shopify_product_gid,shopify_variant_gid,amount,currency_code) VALUES ($1,'intent',$2,'class_entry','class','child','product','variant','50.00','USD')`,
						[`line-${index + 1}`, index],
					);
				const inserted = await repository.insertRegistrationMetadata({
					id: `metadata-${index}`,
					organizationId: "org",
					festivalId: "festival",
					checkoutIntentId: "intent",
					checkoutIntentLineId: `line-${index + 1}`,
					teacherMembershipId: "teacher",
					accompanistMembershipId: null,
					repertoireJson: original.repertoire,
					registrationSnapshot: snapshot,
				});
				const expected = snapshot
					? { ...snapshot, instrument: snapshot.instrument ?? "unknown" }
					: null;
				expect(inserted.registrationSnapshot).toEqual(expected);
				const stored = await sql.unsafe(
					`SELECT registration_snapshot FROM ${schema}.registration_metadata WHERE id = $1`,
					[`metadata-${index}`],
				);
				expect(stored[0]?.registration_snapshot).toEqual(expected);
				await sql.unsafe(
					`INSERT INTO ${schema}.class_entitlements (id,organization_id,festival_id,festival_class_id,parent_customer_id,child_id,checkout_intent_id,checkout_intent_line_id,shopify_order_gid,shopify_order_line_gid,paid_amount_cents,paid_currency_code,status) VALUES ($1,'org','festival','class','parent','child','intent',$2,'order',$3,5000,'USD','confirmed')`,
					[`entitlement-${index}`, `line-${index + 1}`, `order-line-${index}`],
				);
				await repository.linkRegistrationMetadataToEntitlement({
					checkoutIntentLineId: `line-${index + 1}`,
					classEntitlementId: `entitlement-${index}`,
				});
				expect(
					(
						await repository.getRegistrationMetadataByEntitlementId(
							"org",
							`entitlement-${index}`,
						)
					)?.registrationSnapshot,
				).toEqual(expected);
			}
			expect(
				(
					await repository.getRegistrationMetadataByEntitlementId(
						"org",
						"entitlement-0",
					)
				)?.registrationSnapshot,
			).toEqual(original);
			expect(
				(
					await repository.getRegistrationMetadataByEntitlementId(
						"org",
						"entitlement-1",
					)
				)?.registrationSnapshot,
			).toBeNull();
			expect(
				await repository.getRegistrationMetadataByEntitlementId(
					"other-org",
					"entitlement-0",
				),
			).toBeNull();
			await sql.unsafe(
				`UPDATE ${schema}.festival_class_configurations SET display_name='Renamed class',capacity=100; UPDATE ${schema}.organization_divisions SET display_name='Renamed division'; UPDATE ${schema}.festival_customers SET name='Renamed teacher';`,
			);
			const updated = await repository.updateRegistrationMetadata(
				"metadata-0",
				"org",
				{
					pieces: [
						{ title: "Replacement", composer: "Other", durationSeconds: 60 },
					],
					accompanistMembershipId: null,
				},
			);
			expect(updated.registrationSnapshot).toEqual(original);
			expect(updated.repertoireJson[0].title).toBe("Replacement");
			expect(
				(
					await repository.getRegistrationMetadataByEntitlementId(
						"org",
						"entitlement-0",
					)
				)?.registrationSnapshot,
			).toEqual(original);
		} finally {
			await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
		}
	},
);

integrationTest(
	"backfills only null or missing instrument fields in existing snapshot objects",
	async () => {
		const schema = `instrument_${randomUUID().replaceAll("-", "")}`;
		try {
			await sql.unsafe(
				`CREATE SCHEMA ${schema}; CREATE TABLE ${schema}.registration_metadata (id INTEGER PRIMARY KEY, registration_snapshot JSONB)`,
			);
			const original = selection();
			const { instrument: _instrument, ...withoutInstrument } = original;
			const snapshots = [
				null,
				{ ...original, instrument: null },
				withoutInstrument,
				{ ...original, instrument: "unknown" },
				original,
				{ ...original, instrument: { id: "partial" } },
				JSON.stringify({ ...original, instrument: null }),
				JSON.stringify(withoutInstrument),
				JSON.stringify(original),
				"not valid JSON",
				"42",
				"null",
				"[]",
			];
			for (const [index, snapshot] of snapshots.entries())
				await sql.unsafe(
					`INSERT INTO ${schema}.registration_metadata (id,registration_snapshot) VALUES ($1,$2)`,
					[index, snapshot],
				);
			await sql.unsafe(
				`INSERT INTO ${schema}.registration_metadata (id,registration_snapshot) VALUES ($1,'42'::jsonb)`,
				[snapshots.length],
			);
			const migration = (
				await Bun.file(
					new URL(
						"../../../database/migrations/20261023020000_unknown_registration_instrument.sql",
						import.meta.url,
					),
				).text()
			)
				.replaceAll("orgs.", `${schema}.`)
				.replace(/^BEGIN;|^COMMIT;/gm, "");
			await sql.begin((tx) => tx.unsafe(migration));
			await sql.begin((tx) => tx.unsafe(migration));
			const rows = await sql.unsafe(
				`SELECT registration_snapshot FROM ${schema}.registration_metadata ORDER BY id`,
			);
			expect(rows.map((row) => row.registration_snapshot)).toEqual([
				null,
				{ ...original, instrument: "unknown" },
				{ ...original, instrument: "unknown" },
				{ ...original, instrument: "unknown" },
				original,
				{ ...original, instrument: { id: "partial" } },
				{ ...original, instrument: "unknown" },
				{ ...original, instrument: "unknown" },
				original,
				"not valid JSON",
				"42",
				"null",
				"[]",
				42,
			]);
		} finally {
			await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
		}
	},
);
