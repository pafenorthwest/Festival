import { sql } from "bun";

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

export interface CountConfirmedClassEntitlementsBatchInput {
	database: Pick<typeof sql, "unsafe">;
	schema: string;
	organizationId: string;
	festivalClassIds: readonly string[];
}

export async function countConfirmedClassEntitlementsByClassIds({
	database,
	schema,
	organizationId,
	festivalClassIds,
}: CountConfirmedClassEntitlementsBatchInput): Promise<Map<string, number>> {
	if (festivalClassIds.length === 0) return new Map();
	const rows = (await database.unsafe(
		`SELECT festival_class_id, COUNT(*)::int AS count
		FROM ${schema}.class_entitlements
		WHERE organization_id = $1
			AND festival_class_id = ANY($2::text[])
			AND status = 'confirmed'
		GROUP BY festival_class_id`,
		[organizationId, sql.array([...festivalClassIds], "text")],
	)) as Array<{ festival_class_id: string; count: number | string }>;
	return new Map(
		rows.map((row) => [String(row.festival_class_id), Number(row.count)]),
	);
}
