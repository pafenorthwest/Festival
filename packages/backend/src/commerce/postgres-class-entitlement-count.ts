import type { sql } from "bun";

/** Use the caller's connection or transaction and an already validated schema. */
export async function countConfirmedClassEntitlements(
	database: Pick<typeof sql, "unsafe">,
	schema: string,
	organizationId: string,
	festivalClassId: string,
): Promise<number> {
	const rows = (await database.unsafe(
		`SELECT COUNT(*)::int AS count FROM ${schema}.class_entitlements WHERE organization_id = $1 AND festival_class_id = $2 AND status = 'confirmed'`,
		[organizationId, festivalClassId],
	)) as Array<{ count: number | string }>;
	return Number(rows[0]?.count ?? 0);
}
