import { afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "bun";
import { initializePostgresSchema } from "../src/repo/postgres-schema.js";

const owned = new Set<string>();

/** One latest, initially empty schema per file; never accepts an application schema. */
export function currentPostgresFixture(label: string): () => Promise<string> {
	if (!/^[a-z_]{1,24}$/.test(label)) throw new Error("Invalid fixture label.");
	const schema = `it_${label}_${randomUUID().replaceAll("-", "")}`;
	let ready: Promise<void> | undefined;
	afterAll(async () => {
		if (!ready) return;
		try {
			await ready;
		} catch {
			/* Still remove a partially created owned namespace. */
		}
		await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
		owned.delete(schema);
	});
	return async () => {
		if (!ready) {
			owned.add(schema);
			ready = initializePostgresSchema(schema);
			await ready;
			console.info("[postgres-fixture] initialized current schema");
		}
		await ready;
		return schema;
	};
}

/** Reset only namespaces allocated by this process, after all case sessions finish. */
export async function resetPostgresFixture(schema: string): Promise<void> {
	if (!owned.has(schema))
		throw new Error("Refusing to reset an unowned schema.");
	await sql.unsafe(`
		DROP TRIGGER IF EXISTS pause_cart_insert ON ${schema}.checkout_carts;
		DROP FUNCTION IF EXISTS ${schema}.pause_cart_insert();
		DROP TRIGGER IF EXISTS reject_cart_link ON ${schema}.checkout_intents;
		DROP FUNCTION IF EXISTS ${schema}.reject_cart_link();
		DROP TRIGGER IF EXISTS reject_capacity_audit ON ${schema}.festival_class_capacity_audit_logs;
		DROP FUNCTION IF EXISTS ${schema}.reject_capacity_audit();
	`);
	const tables = await sql.unsafe(
		"SELECT tablename FROM pg_tables WHERE schemaname = $1",
		[schema],
	);
	if (tables.length) {
		const names = tables.map(
			(row) => `${schema}."${String(row.tablename).replaceAll('"', '""')}"`,
		);
		await sql.unsafe(`TRUNCATE ${names.join(", ")} CASCADE`);
	}
}
