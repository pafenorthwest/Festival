import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "bun";
import { PostgresCheckoutRepository } from "../src/checkout/postgres-checkout-repository.js";
import { initializePostgresSchema } from "../src/repo/postgres-schema.js";

const postgresTest = process.env.POSTGRES_INTEGRATION_URL ? test : test.skip;
type Runner = { unsafe(query: string, values?: unknown[]): Promise<unknown> };

async function fixture() {
	const schema = `cutoff_${randomUUID().replaceAll("-", "")}`;
	try {
		await initializePostgresSchema(schema);
		await sql.unsafe(`
		INSERT INTO ${schema}.organizations (id, name, slug) VALUES ('org', 'Organization', 'org');
		INSERT INTO ${schema}.organization_divisions (id, organization_id, display_name, normalized_name, display_order) VALUES ('division', 'org', 'Piano', 'piano', 0);
		INSERT INTO ${schema}.registration_catalog_values (id, organization_id, kind, display_name, normalized_name, display_order) VALUES ('subtype', 'org', 'class_subtype', 'Solo', 'solo', 0);
		INSERT INTO ${schema}.festivals (id, organization_id, code, short_name, is_primary, name, start_date, end_date) VALUES ('festival', 'org', 'FEST', 'fest', TRUE, 'Festival', '2027-01-01', '2027-01-02');
		INSERT INTO ${schema}.festival_customers (id, organization_id, shopify_customer_gid, created_at, updated_at) VALUES ('parent', 'org', 'gid://shopify/Customer/1', NOW(), NOW());
		INSERT INTO ${schema}.festival_children (id, organization_id, parent_customer_id, display_name, created_at) VALUES ('child', 'org', 'parent', 'Child', NOW());
		INSERT INTO ${schema}.festival_class_configurations (id, organization_id, festival_id, display_name, class_subtype_id, division_id, minimum_age, maximum_age, price, maximum_performance_pieces, performance_minutes, capacity, shopify_product_gid, shopify_variant_gid)
		VALUES ('class-a', 'org', 'festival', 'Piano A', 'subtype', 'division', 5, 18, '50.00', 2, 10, 1, 'product-a', 'variant-a'), ('class-b', 'org', 'festival', 'Piano B', 'subtype', 'division', 5, 18, '50.00', 2, 10, 1, 'product-b', 'variant-b');
	`);
		const repository = new PostgresCheckoutRepository(schema);
		const expiresAtIso = new Date(Date.now() + 3_600_000).toISOString();
		const intent = async (id: string, classes = ["class-a"]) => {
			await sql.unsafe(
				`INSERT INTO ${schema}.checkout_intents (id, correlation_id, organization_id, customer_id, session_id, idempotency_key, intent_type, festival_class_id, child_id, shopify_product_gid, shopify_variant_gid, amount, currency_code, status, expires_at) VALUES ($1, $1, 'org', 'parent', $1, $1, 'class_entry', $2, 'child', 'product-a', 'variant-a', '50.00', 'USD', 'creating', $3)`,
				[id, classes[0], expiresAtIso],
			);
			for (const [index, classId] of classes.entries()) {
				await sql.unsafe(
					`INSERT INTO ${schema}.checkout_intent_lines (id, checkout_intent_id, line_index, line_type, festival_class_id, child_id, shopify_product_gid, shopify_variant_gid, amount, currency_code) VALUES ($1, $2, $3, 'class_entry', $4, 'child', 'product-a', 'variant-a', '50.00', 'USD')`,
					[`${id}-line-${index}`, id, index, classId],
				);
			}
		};
		const attach = (id: string) =>
			repository.markIntentReady({
				intentId: id,
				organizationId: "org",
				customerId: "parent",
				sessionId: id,
				shopifyCartId: `gid://shopify/Cart/${id}`,
				integrationVersion: 1,
				expiresAtIso,
			});
		const place = async (runner: Runner, id: string, classId = "class-a") => {
			await runner.unsafe(
				`INSERT INTO ${schema}.class_entitlements (id, organization_id, festival_id, festival_class_id, parent_customer_id, child_id, checkout_intent_id, shopify_order_gid, shopify_order_line_gid, paid_amount_cents, paid_currency_code, status) VALUES ($1, 'org', 'festival', $2, 'parent', 'child', $1, $1, $1, 5000, 'USD', 'confirmed')`,
				[id, classId],
			);
		};
		const persisted = async (id: string) => {
			const rows = await sql.unsafe(
				`SELECT status, cart_reference FROM ${schema}.checkout_intents WHERE id = $1`,
				[id],
			);
			return rows[0];
		};
		return { schema, intent, attach, place, persisted };
	} catch (error) {
		await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
		throw error;
	}
}

// A database-observed lock barrier: no timing assumption about how long an
// attachment or payment takes. Return the blocked backend so a second writer
// can be checked against it too.
async function blockedBy(pid: number) {
	const deadline = Date.now() + 5_000;
	do {
		const rows = await sql.unsafe(
			"SELECT pid FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))",
			[pid],
		);
		if (rows[0]) return Number(rows[0].pid);
	} while (Date.now() < deadline);
	return null;
}

for (const cutoff of ["capacity decrease", "confirmed placement"] as const) {
	postgresTest(
		`PostgreSQL attachment waits for ${cutoff} then rejects the new cart`,
		async () => {
			const f = await fixture();
			const blocker = await sql.reserve();
			let attachment: ReturnType<typeof f.attach> | undefined;
			try {
				await f.intent("candidate");
				await f.intent("paid");
				if (cutoff === "capacity decrease") {
					await sql.unsafe(
						`UPDATE ${f.schema}.festival_class_configurations SET capacity = 2 WHERE id = 'class-a'`,
					);
					await f.place(sql, "paid");
				}
				await blocker.unsafe("BEGIN");
				const [{ pid }] = await blocker.unsafe(
					"SELECT pg_backend_pid() AS pid",
				);
				if (cutoff === "capacity decrease") {
					await blocker.unsafe(
						`UPDATE ${f.schema}.festival_class_configurations SET capacity = 1 WHERE id = 'class-a'`,
					);
				} else {
					await f.place(blocker, "paid");
				}
				attachment = f.attach("candidate");
				// Handle rejection immediately while the transaction is held.
				const outcome = attachment.then(
					(cart) => ({ cart, error: null }),
					(error: unknown) => ({ cart: null, error }),
				);
				const blockedPid = await blockedBy(Number(pid));
				await blocker.unsafe("COMMIT");
				expect(blockedPid).not.toBeNull();
				expect(await outcome).toMatchObject({
					cart: null,
					error: { code: "sold_out" },
				});
				expect(await f.persisted("candidate")).toMatchObject({
					status: "creating",
					cart_reference: null,
				});
				const carts = await sql.unsafe(
					`SELECT * FROM ${f.schema}.checkout_carts`,
				);
				expect(carts).toHaveLength(0);
			} finally {
				await blocker.unsafe("ROLLBACK");
				blocker.release();
				await attachment?.catch(() => undefined);
				await sql.unsafe(`DROP SCHEMA ${f.schema} CASCADE`);
			}
		},
		20_000,
	);
}

for (const cutoff of ["capacity decrease", "confirmed placement"] as const) {
	postgresTest(
		`PostgreSQL ${cutoff} cannot cross admission while durable attachment is pending`,
		async () => {
			const f = await fixture();
			const blocker = await sql.reserve();
			const writer = await sql.reserve();
			let attachment: ReturnType<typeof f.attach> | undefined;
			let change: Promise<unknown> | undefined;
			try {
				await f.intent("candidate");
				await f.intent("paid");
				if (cutoff === "capacity decrease") {
					await sql.unsafe(
						`UPDATE ${f.schema}.festival_class_configurations SET capacity = 2 WHERE id = 'class-a'`,
					);
					await f.place(sql, "paid");
				}
				// Pause at the actual INSERT, after the capacity read but before
				// the durable cart is committed, using a test-only trigger.
				const barrier = Math.floor(Math.random() * 1_000_000_000);
				await sql.unsafe(
					`CREATE FUNCTION ${f.schema}.pause_cart_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${barrier}); RETURN NEW; END $$; CREATE TRIGGER pause_cart_insert BEFORE INSERT ON ${f.schema}.checkout_carts FOR EACH ROW EXECUTE FUNCTION ${f.schema}.pause_cart_insert()`,
				);
				await blocker.unsafe("BEGIN");
				await blocker.unsafe("SELECT pg_advisory_xact_lock($1)", [barrier]);
				const [{ pid }] = await blocker.unsafe(
					"SELECT pg_backend_pid() AS pid",
				);
				attachment = f.attach("candidate");
				// Observe failures while waiting at the database barrier so the
				// test runner lets finally release connections and remove schema.
				void attachment.catch(() => undefined);
				const attachingPid = await blockedBy(Number(pid));
				expect(attachingPid).not.toBeNull();
				if (cutoff === "capacity decrease") {
					change = Promise.resolve(
						writer.unsafe(
							`UPDATE ${f.schema}.festival_class_configurations SET capacity = 1 WHERE id = 'class-a'`,
						),
					);
				} else {
					change = f.place(writer, "paid");
				}
				void change.catch(() => undefined);
				const writerBlocked = await blockedBy(attachingPid as number);
				await blocker.unsafe("COMMIT");
				expect(writerBlocked).not.toBeNull();
				const cart = await attachment;
				await change;
				expect(await f.persisted("candidate")).toMatchObject({
					status: "ready",
					cart_reference: cart.reference,
				});
			} finally {
				await blocker.unsafe("ROLLBACK");
				blocker.release();
				await attachment?.catch(() => undefined);
				await change?.catch(() => undefined);
				writer.release();
				await sql.unsafe(`DROP SCHEMA ${f.schema} CASCADE`);
			}
		},
		20_000,
	);
}

postgresTest(
	"PostgreSQL multi-class cutoff rejects the whole cart without partial attachment",
	async () => {
		const f = await fixture();
		try {
			await f.intent("mixed", ["class-a", "class-b"]);
			await f.intent("paid", ["class-b"]);
			await f.place(sql, "paid", "class-b");
			await expect(f.attach("mixed")).rejects.toMatchObject({
				code: "sold_out",
			});
			expect(await f.persisted("mixed")).toMatchObject({
				status: "creating",
				cart_reference: null,
			});
			expect(
				await sql.unsafe(`SELECT * FROM ${f.schema}.checkout_carts`),
			).toHaveLength(0);
		} finally {
			await sql.unsafe(`DROP SCHEMA ${f.schema} CASCADE`);
		}
	},
);

postgresTest(
	"PostgreSQL attachment rolls back persistence failure and allows a safe retry",
	async () => {
		const f = await fixture();
		try {
			await f.intent("candidate");
			await sql.unsafe(
				`CREATE FUNCTION ${f.schema}.reject_cart_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.cart_reference IS NOT NULL THEN RAISE EXCEPTION 'injected cart link failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_cart_link BEFORE UPDATE ON ${f.schema}.checkout_intents FOR EACH ROW EXECUTE FUNCTION ${f.schema}.reject_cart_link()`,
			);
			await expect(f.attach("candidate")).rejects.toThrow(
				"injected cart link failure",
			);
			expect(await f.persisted("candidate")).toMatchObject({
				status: "creating",
				cart_reference: null,
			});
			expect(
				await sql.unsafe(`SELECT * FROM ${f.schema}.checkout_carts`),
			).toHaveLength(0);
			await sql.unsafe(
				`DROP TRIGGER reject_cart_link ON ${f.schema}.checkout_intents`,
			);
			const cart = await f.attach("candidate");
			expect(await f.persisted("candidate")).toMatchObject({
				status: "ready",
				cart_reference: cart.reference,
			});
			expect(
				await sql.unsafe(`SELECT * FROM ${f.schema}.checkout_carts`),
			).toHaveLength(1);
		} finally {
			await sql.unsafe(`DROP SCHEMA ${f.schema} CASCADE`);
		}
	},
);

postgresTest(
	"PostgreSQL soft capacity admits multiple open carts and preserves paid placements above capacity",
	async () => {
		const f = await fixture();
		try {
			await f.intent("first");
			await f.intent("second");
			const first = await f.attach("first");
			const second = await f.attach("second");
			expect(first.reference).not.toBe(second.reference);
			await f.place(sql, "first");
			await f.place(sql, "second");
			const rows = await sql.unsafe(
				`SELECT COUNT(*)::int AS count FROM ${f.schema}.class_entitlements WHERE status = 'confirmed'`,
			);
			expect(rows[0]?.count).toBe(2);
			await f.intent("third");
			await expect(f.attach("third")).rejects.toMatchObject({
				code: "sold_out",
			});
			expect(await f.persisted("first")).toMatchObject({
				cart_reference: first.reference,
			});
			expect(await f.persisted("second")).toMatchObject({
				cart_reference: second.reference,
			});
		} finally {
			await sql.unsafe(`DROP SCHEMA ${f.schema} CASCADE`);
		}
	},
);

postgresTest(
	"PostgreSQL cutoff migration upgrades populated schemas idempotently and enforces the attachment boundary",
	async () => {
		const f = await fixture();
		const blocker = await sql.reserve();
		let attachment: ReturnType<typeof f.attach> | undefined;
		try {
			await f.intent("candidate");
			await f.intent("paid");
			await sql.unsafe(
				`UPDATE ${f.schema}.festival_class_configurations SET capacity = 2 WHERE id = 'class-a'`,
			);
			await f.place(sql, "paid");
			// Remove only the new schema objects to reproduce the populated
			// pre-upgrade state. Never apply deployment SQL to the live schema.
			await sql.unsafe(
				`DROP TRIGGER lock_class_capacity_cutoff ON ${f.schema}.festival_class_configurations; DROP TRIGGER lock_class_capacity_cutoff ON ${f.schema}.class_entitlements; DROP FUNCTION ${f.schema}.lock_class_capacity_cutoff()`,
			);
			const migration = (
				await Bun.file(
					new URL(
						"../../../database/migrations/20261018120000_soft_capacity_cutoff.sql",
						import.meta.url,
					),
				).text()
			).replaceAll("orgs", f.schema);
			await blocker.unsafe(migration);
			await blocker.unsafe(migration);
			const triggers = await sql.unsafe(
				"SELECT tgrelid::regclass::text AS target, tgtype FROM pg_trigger WHERE tgname = 'lock_class_capacity_cutoff' AND tgrelid IN (($1 || '.festival_class_configurations')::regclass, ($1 || '.class_entitlements')::regclass)",
				[f.schema],
			);
			expect(triggers).toHaveLength(2);
			// BEFORE INSERT/DELETE/UPDATE, with no FOR EACH ROW bit.
			expect(triggers.map((trigger) => Number(trigger.tgtype))).toEqual([
				30, 30,
			]);
			expect(
				await sql.unsafe(`SELECT * FROM ${f.schema}.class_entitlements`),
			).toHaveLength(1);
			expect(await f.persisted("candidate")).toMatchObject({
				status: "creating",
				cart_reference: null,
			});
			await blocker.unsafe("BEGIN");
			await blocker.unsafe(
				`UPDATE ${f.schema}.festival_class_configurations SET capacity = 1 WHERE id = 'class-a'`,
			);
			const [{ pid }] = await blocker.unsafe("SELECT pg_backend_pid() AS pid");
			attachment = f.attach("candidate");
			const outcome = attachment.then(
				(cart) => ({ cart, error: null }),
				(error: unknown) => ({ cart: null, error }),
			);
			const blockedPid = await blockedBy(Number(pid));
			await blocker.unsafe("COMMIT");
			expect(blockedPid).not.toBeNull();
			expect(await outcome).toMatchObject({
				cart: null,
				error: { code: "sold_out" },
			});
			expect(
				await sql.unsafe(`SELECT * FROM ${f.schema}.checkout_carts`),
			).toHaveLength(0);
		} finally {
			await blocker.unsafe("ROLLBACK");
			blocker.release();
			await attachment?.catch(() => undefined);
			await sql.unsafe(`DROP SCHEMA ${f.schema} CASCADE`);
		}
	},
	20_000,
);
