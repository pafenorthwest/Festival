import { expect, test } from "bun:test";
import type { ClassRegistrationSnapshot } from "@festival/common";
import { sql } from "bun";
import { PostgresCheckoutRepository } from "../src/checkout/postgres-checkout-repository.js";
import { PostgresRegistrationChangeRepository } from "../src/registration/registration-change-repository.js";
import { withApplicationRollback } from "./postgres-application-fixture.js";

const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

function selection(id: (label: string) => string): ClassRegistrationSnapshot {
	return {
		version: 1,
		capturedAtIso: "2026-10-22T00:00:00.000Z",
		class: {
			id: id("class"),
			festivalId: id("festival"),
			displayName: "Original class",
			classSubtypeId: id("subtype"),
			classSubtypeName: "Solo",
			minimumAge: 5,
			maximumAge: 18,
			price: "50.00",
			currencyCode: "USD",
			maximumPerformancePieces: 2,
			performanceMinutes: 10,
			capacity: 20,
		},
		division: { id: id("division"), name: "Original division" },
		instrument: { id: id("instrument"), name: "Piano" },
		teacher: {
			customerId: id("parent"),
			membershipId: id("teacher"),
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
	"round-trips immutable selections and explicit unknowns in the current schema",
	async () => {
		await withApplicationRollback(async (fixture) => {
			const schema = fixture.schema;
			await sql.unsafe(`
			INSERT INTO ${schema}.organizations (id,name,slug) VALUES ('${fixture.id("org")}','${fixture.id("Organization")}','${fixture.id("org")}');
			INSERT INTO ${schema}.organization_divisions (id,organization_id,display_name,normalized_name,display_order) VALUES ('${fixture.id("division")}','${fixture.id("org")}','Original division','original',0);
			INSERT INTO ${schema}.registration_catalog_values (id,organization_id,kind,display_name,normalized_name,display_order) VALUES ('${fixture.id("subtype")}','${fixture.id("org")}','class_subtype','Solo','solo',0);
			INSERT INTO ${schema}.festivals (id,organization_id,code,short_name,is_primary,name,start_date,end_date) VALUES ('${fixture.id("festival")}','${fixture.id("org")}','FEST','fest',TRUE,'Festival','2027-01-01','2027-01-02');
			INSERT INTO ${schema}.festival_customers (id,organization_id,shopify_customer_gid,created_at,updated_at) VALUES ('${fixture.id("parent")}','${fixture.id("org")}','gid://shopify/Customer/${fixture.id("Customer-1")}',NOW(),NOW());
			INSERT INTO ${schema}.festival_children (id,organization_id,parent_customer_id,display_name,created_at) VALUES ('${fixture.id("child")}','${fixture.id("org")}','${fixture.id("parent")}','Child',NOW());
			INSERT INTO ${schema}.festival_class_configurations (id,organization_id,festival_id,display_name,class_subtype_id,division_id,minimum_age,maximum_age,price,maximum_performance_pieces,performance_minutes,capacity,shopify_product_gid,shopify_variant_gid) VALUES ('${fixture.id("class")}','${fixture.id("org")}','${fixture.id("festival")}','Original class','${fixture.id("subtype")}','${fixture.id("division")}',5,18,'50.00',2,10,20,'${fixture.id("product")}','${fixture.id("variant")}');
			INSERT INTO ${schema}.products (id,organization_id,product_category,entitlement_class,duration_days,shopify_product_gid,shopify_variant_gid,product_name_snapshot) VALUES ('${fixture.id("product-teacher")}','${fixture.id("org")}','membership','teacher_membership',365,'${fixture.id("teacher-product")}','${fixture.id("teacher-variant")}','Teacher');
			INSERT INTO ${schema}.membership_entitlements (id,organization_id,customer_id,entitlement_class,source,offering_id,starts_on,ends_on) VALUES ('${fixture.id("teacher")}','${fixture.id("org")}','${fixture.id("parent")}','teacher_membership','teacher_checkout','${fixture.id("product-teacher")}','2026-01-01','2027-01-01');
			INSERT INTO ${schema}.checkout_intents (id,correlation_id,organization_id,customer_id,session_id,idempotency_key,intent_type,festival_class_id,child_id,shopify_product_gid,shopify_variant_gid,amount,currency_code,status,expires_at) VALUES ('${fixture.id("intent")}','${fixture.id("correlation")}','${fixture.id("org")}','${fixture.id("parent")}','${fixture.id("session")}','${fixture.id("key")}','class_entry','${fixture.id("class")}','${fixture.id("child")}','${fixture.id("product")}','${fixture.id("variant")}','100.00','USD','checkout_started',NOW()+INTERVAL '1 hour');
			INSERT INTO ${schema}.checkout_intent_lines (id,checkout_intent_id,line_index,line_type,festival_class_id,child_id,shopify_product_gid,shopify_variant_gid,amount,currency_code) VALUES ('${fixture.id("line-1")}','${fixture.id("intent")}',0,'class_entry','${fixture.id("class")}','${fixture.id("child")}','${fixture.id("product")}','${fixture.id("variant")}','50.00','USD'),('${fixture.id("line-2")}','${fixture.id("intent")}',1,'class_entry','${fixture.id("class")}','${fixture.id("child")}','${fixture.id("product")}','${fixture.id("variant")}','50.00','USD');
		`);
			const repository = fixture.repository(
				new PostgresCheckoutRepository(schema),
			);
			const original = selection(fixture.id);
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
						`INSERT INTO ${schema}.checkout_intent_lines (id,checkout_intent_id,line_index,line_type,festival_class_id,child_id,shopify_product_gid,shopify_variant_gid,amount,currency_code) VALUES ($1,'${fixture.id("intent")}',$2,'class_entry','${fixture.id("class")}','${fixture.id("child")}','${fixture.id("product")}','${fixture.id("variant")}','50.00','USD')`,
						[fixture.id(`line-${index + 1}`), index],
					);
				const inserted = await repository.insertRegistrationMetadata({
					id: fixture.id(`metadata-${index}`),
					organizationId: fixture.id("org"),
					festivalId: fixture.id("festival"),
					checkoutIntentId: fixture.id("intent"),
					checkoutIntentLineId: fixture.id(`line-${index + 1}`),
					teacherMembershipId: fixture.id("teacher"),
					accompanistMembershipId: null,
					repertoireJson: original.repertoire,
					registrationSnapshot: snapshot,
				});
				const expected = snapshot
					? { ...snapshot, instrument: snapshot.instrument ?? "unknown" }
					: null;
				expect(inserted.registrationSnapshot).toEqual(expected);
				const stored = await sql.unsafe(
					`SELECT registration_snapshot, jsonb_typeof(registration_snapshot) AS snapshot_type, jsonb_typeof(repertoire_json) AS repertoire_type, repertoire_json->0->>'title' AS title, repertoire_json @> '[{"title":"Original work"}]'::jsonb AS contains FROM ${schema}.registration_metadata WHERE id = $1`,
					[fixture.id(`metadata-${index}`)],
				);
				expect(stored[0]?.registration_snapshot).toEqual(expected);
				expect(stored[0]?.snapshot_type).toBe(expected ? "object" : null);
				expect(stored[0]?.repertoire_type).toBe("array");
				expect(stored[0]?.title).toBe("Original work");
				expect(stored[0]?.contains).toBe(true);
				await sql.unsafe(
					`INSERT INTO ${schema}.class_entitlements (id,organization_id,festival_id,festival_class_id,parent_customer_id,child_id,checkout_intent_id,checkout_intent_line_id,shopify_order_gid,shopify_order_line_gid,paid_amount_cents,paid_currency_code,status) VALUES ($1,'${fixture.id("org")}','${fixture.id("festival")}','${fixture.id("class")}','${fixture.id("parent")}','${fixture.id("child")}','${fixture.id("intent")}',$2,'${fixture.id("order")}',$3,5000,'USD','confirmed')`,
					[
						fixture.id(`entitlement-${index}`),
						fixture.id(`line-${index + 1}`),
						fixture.id(`order-line-${index}`),
					],
				);
				await repository.linkRegistrationMetadataToEntitlement({
					checkoutIntentLineId: fixture.id(`line-${index + 1}`),
					classEntitlementId: fixture.id(`entitlement-${index}`),
				});
				expect(
					(
						await repository.getRegistrationMetadataByEntitlementId(
							fixture.id("org"),
							fixture.id(`entitlement-${index}`),
						)
					)?.registrationSnapshot,
				).toEqual(expected);
			}
			const duplicate = {
				id: fixture.id("metadata-0"),
				organizationId: fixture.id("org"),
				festivalId: fixture.id("festival"),
				checkoutIntentId: fixture.id("intent"),
				checkoutIntentLineId: fixture.id("line-1"),
				teacherMembershipId: fixture.id("teacher"),
				accompanistMembershipId: null,
				repertoireJson: [],
				registrationSnapshot: null,
			};
			await sql.unsafe(
				`INSERT INTO ${schema}.checkout_intent_lines (id,checkout_intent_id,line_index,line_type,festival_class_id,child_id,shopify_product_gid,shopify_variant_gid,amount,currency_code) VALUES ('${fixture.id("unused-line")}','${fixture.id("intent")}',5,'class_entry','${fixture.id("class")}','${fixture.id("child")}','${fixture.id("product")}','${fixture.id("variant")}','50.00','USD')`,
			);
			await expect(
				repository.insertRegistrationMetadata({
					...duplicate,
					checkoutIntentLineId: fixture.id("unused-line"),
				}),
			).rejects.toMatchObject({ errno: "23505" });
			await expect(
				repository.insertRegistrationMetadata({
					...duplicate,
					id: fixture.id("duplicate-line"),
				}),
			).rejects.toThrow();
			const retained = await sql.unsafe(
				`SELECT repertoire_json,registration_snapshot FROM ${schema}.registration_metadata WHERE id='${fixture.id("metadata-0")}'`,
			);
			expect(retained[0]).toEqual({
				repertoire_json: original.repertoire,
				registration_snapshot: original,
			});
			const changes = fixture.repository(
				new PostgresRegistrationChangeRepository(schema),
			);
			const previousState = { status: "confirmed", pieces: ["Original work"] };
			const newState = {
				status: "cancelled",
				reason: { code: "customer_request" },
			};
			const change = await changes.createChangeLog({
				organizationId: fixture.id("org"),
				festivalId: fixture.id("festival"),
				classEntitlementId: fixture.id("entitlement-0"),
				action: "drop",
				actorUid: fixture.id("parent"),
				actorRole: "customer",
				previousState,
				newState,
			});
			expect(change.previousState).toEqual(previousState);
			expect(change.newState).toEqual(newState);
			const states = await sql.unsafe(
				`SELECT jsonb_typeof(previous_state) AS previous_type,jsonb_typeof(new_state) AS new_type,previous_state->>'status' AS previous_status,new_state#>>'{reason,code}' AS reason,previous_state @> '{"pieces":["Original work"]}'::jsonb AS contains FROM ${schema}.registration_change_logs WHERE id=$1`,
				[change.id],
			);
			expect(states[0]).toEqual({
				previous_type: "object",
				new_type: "object",
				previous_status: "confirmed",
				reason: "customer_request",
				contains: true,
			});
			await sql.unsafe(
				`UPDATE ${schema}.checkout_intents SET status='creating' WHERE id='${fixture.id("intent")}'`,
			);
			await expect(
				repository.attachCart({
					intentId: fixture.id("intent"),
					organizationId: fixture.id("wrong-org"),
					customerId: fixture.id("parent"),
					sessionId: fixture.id("session"),
					shopifyCartId: fixture.id("cart"),
					integrationVersion: 1,
					expiresAtIso: new Date(Date.now() + 3600000).toISOString(),
				}),
			).rejects.toThrow("Checkout intent cannot accept a cart");
			const carts = await sql.unsafe(
				`SELECT COUNT(*)::int AS count FROM ${schema}.checkout_carts WHERE organization_id='${fixture.id("org")}'`,
			);
			expect(carts[0]?.count).toBe(0);
			expect(
				(
					await repository.getRegistrationMetadataByEntitlementId(
						fixture.id("org"),
						fixture.id("entitlement-0"),
					)
				)?.registrationSnapshot,
			).toEqual(original);
			expect(
				(
					await repository.getRegistrationMetadataByEntitlementId(
						fixture.id("org"),
						fixture.id("entitlement-1"),
					)
				)?.registrationSnapshot,
			).toBeNull();
			expect(
				await repository.getRegistrationMetadataByEntitlementId(
					fixture.id("other-org"),
					fixture.id("entitlement-0"),
				),
			).toBeNull();
			await sql.unsafe(
				`UPDATE ${schema}.festival_class_configurations SET display_name='Renamed class',capacity=100 WHERE organization_id='${fixture.id("org")}'; UPDATE ${schema}.organization_divisions SET display_name='Renamed division' WHERE organization_id='${fixture.id("org")}'; UPDATE ${schema}.festival_customers SET name='Renamed teacher' WHERE organization_id='${fixture.id("org")}';`,
			);
			const updated = await repository.updateRegistrationMetadata(
				fixture.id("metadata-0"),
				fixture.id("org"),
				{
					pieces: [
						{ title: "Replacement", composer: "Other", durationSeconds: 60 },
					],
					accompanistMembershipId: null,
				},
			);
			expect(updated.registrationSnapshot).toEqual(original);
			expect(updated.repertoireJson[0].title).toBe("Replacement");
			const replacement = await sql.unsafe(
				`SELECT jsonb_typeof(repertoire_json) AS type,repertoire_json->0->>'title' AS title,repertoire_json @> '[{"title":"Replacement"}]'::jsonb AS contains FROM ${schema}.registration_metadata WHERE id='${fixture.id("metadata-0")}'`,
			);
			expect(replacement[0]).toEqual({
				type: "array",
				title: "Replacement",
				contains: true,
			});
			expect(
				(
					await repository.getRegistrationMetadataByEntitlementId(
						fixture.id("org"),
						fixture.id("entitlement-0"),
					)
				)?.registrationSnapshot,
			).toEqual(original);
		});
	},
);
