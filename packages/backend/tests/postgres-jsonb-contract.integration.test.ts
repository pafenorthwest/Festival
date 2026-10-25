import { expect, test } from "bun:test";
import { sql } from "bun";
import { PostgresCommunicationRepository } from "../src/communication/postgres-communication-repository.js";
import { PostgresCustomerAccountRepository } from "../src/customer/postgres-customer-account-repository.js";
import { withApplicationRollback } from "./postgres-application-fixture.js";

const integrationTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;

integrationTest(
	"stores customer and communication JSONB natively and retains earliest consent per notice",
	async () => {
		await withApplicationRollback(async (fixture) => {
			const schema = fixture.schema;
			await sql.unsafe(`INSERT INTO ${schema}.organizations(id,name,slug) VALUES ('${fixture.id("org")}','${fixture.id("Organization")}','${fixture.id("org")}');
		INSERT INTO ${schema}.festival_customers(id,organization_id,shopify_customer_gid,created_at,updated_at) VALUES ('${fixture.id("customer")}','${fixture.id("org")}','${fixture.id("customer")}',NOW(),NOW());`);
			const customers = fixture.repository(
				new PostgresCustomerAccountRepository(schema),
			);
			const address = {
				line1: "1 Main St",
				city: "Seattle",
				region: "WA",
				postalCode: "98101",
				countryCode: "US",
			};
			for (const [index, city] of ["Seattle", "Tacoma"].entries()) {
				const expected = { ...address, city };
				const result = await customers.applyCustomerProfile({
					organizationId: fixture.id("org"),
					customerId: fixture.id("customer"),
					source: "festival",
					updatedAtIso: `2026-10-${20 + index}T00:00:00.000Z`,
					profile: { mailingAddress: expected },
				});
				expect(result?.mailingAddress.value).toEqual(expected);
				const rows = await sql.unsafe(
					`SELECT jsonb_typeof(mailing_address) AS type, mailing_address->>'city' AS city, mailing_address @> $1::jsonb AS contains FROM ${schema}.festival_customers WHERE id='${fixture.id("customer")}'`,
					[{ city }],
				);
				expect(rows[0]).toEqual({ type: "object", city, contains: true });
			}
			for (const [offset, notice] of ["v1", "v2"].entries()) {
				for (const day of [21, 23, 19])
					await customers.recordStaffAccessConsent({
						organizationId: fixture.id("org"),
						customerId: fixture.id("customer"),
						privacyNoticeVersion: notice,
						consentedAtIso: `2026-10-${day + offset}T00:00:00.000Z`,
					});
			}
			const consents = await sql.unsafe(
				`SELECT privacy_notice_version AS notice, consented_at FROM ${schema}.festival_customer_staff_consents WHERE organization_id='${fixture.id("org")}' AND customer_id='${fixture.id("customer")}' ORDER BY notice`,
			);
			expect(
				consents.map((row) => [
					row.notice,
					new Date(row.consented_at).toISOString(),
				]),
			).toEqual([
				["v1", "2026-10-19T00:00:00.000Z"],
				["v2", "2026-10-20T00:00:00.000Z"],
			]);
			const communication = fixture.repository(
				new PostgresCommunicationRepository(schema),
			);
			const template = await communication.createTemplate({
				organizationId: fixture.id("org"),
				templateKey: "paid",
				channel: "email",
				body: "Hello {{name}}",
				variables: ["name"],
			});
			for (const variables of [["name"], ["name", "class"]]) {
				if (variables.length > 1)
					await communication.updateTemplate(fixture.id("org"), template.id, {
						variables,
					});
				const rows = await sql.unsafe(
					`SELECT jsonb_typeof(variables) AS type, variables->>0 AS first, variables @> $1::jsonb AS contains FROM ${schema}.message_templates WHERE id=$2`,
					[variables, template.id],
				);
				expect(rows[0]).toEqual({
					type: "array",
					first: "name",
					contains: true,
				});
				expect(
					(await communication.getTemplateById(fixture.id("org"), template.id))
						?.variables,
				).toEqual(variables);
			}
			const payload = { order: { id: "order-1" }, lines: ["class-1"] };
			const event = await communication.recordEvent({
				organizationId: fixture.id("org"),
				eventType: "paid",
				recipientDestination: "customer@example.test",
				idempotencyKey: "order-1",
				payload,
			});
			expect(event.event.payload).toEqual(payload);
			const stored = await sql.unsafe(
				`SELECT jsonb_typeof(payload) AS type, payload#>>'{order,id}' AS order_id, payload @> $1::jsonb AS contains FROM ${schema}.message_events WHERE id=$2`,
				[{ lines: ["class-1"] }, event.event.id],
			);
			expect(stored[0]).toEqual({
				type: "object",
				order_id: "order-1",
				contains: true,
			});
			await sql.unsafe(
				`INSERT INTO ${schema}.shopify_webhook_deliveries (id,organization_id,shop_domain,webhook_id,topic,api_version,shopify_order_gid,payload_sha256,status,received_at,failure_stage,failure_code) VALUES ('${fixture.id("webhook")}','${fixture.id("org")}','example.myshopify.com','${fixture.id("webhook")}','orders/paid','2026-07','order',repeat('0',64),'failed',NOW(),'projection','paid_line_conflict')`,
			);
			for (const column of ["failure_stage", "failure_code"]) {
				await expect(
					fixture.savepoint(async () => {
						await sql.unsafe(
							`UPDATE ${schema}.shopify_webhook_deliveries SET ${column}='invalid' WHERE id='${fixture.id("webhook")}'`,
						);
					}),
				).rejects.toMatchObject({ errno: "23514" });
			}
			const failure = await sql.unsafe(
				`SELECT failure_stage,failure_code FROM ${schema}.shopify_webhook_deliveries WHERE id='${fixture.id("webhook")}'`,
			);
			expect(failure[0]).toEqual({
				failure_stage: "projection",
				failure_code: "paid_line_conflict",
			});
			await sql.unsafe(
				`UPDATE ${schema}.shopify_webhook_deliveries SET failure_stage=NULL,failure_code=NULL WHERE id='${fixture.id("webhook")}'`,
			);
			const cleared = await sql.unsafe(
				`SELECT failure_stage,failure_code FROM ${schema}.shopify_webhook_deliveries WHERE id='${fixture.id("webhook")}'`,
			);
			expect(cleared[0]).toEqual({ failure_stage: null, failure_code: null });
		});
	},
);
