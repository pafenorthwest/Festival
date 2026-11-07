import { sql } from "bun";

/** Catalog reads only: application rows and schema objects are never changed. */
export async function postgresCatalogContract(
	schema: string,
): Promise<string[]> {
	const rows = await sql.unsafe(
		`
		SELECT 'table' AS kind, c.relname AS name, '' AS definition
		FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
		WHERE n.nspname=$1 AND c.relkind='r'
		UNION ALL
		SELECT 'column', c.relname||'.'||a.attname,
			format_type(a.atttypid,a.atttypmod)||' null='||(NOT a.attnotnull)||' default='||COALESCE(pg_get_expr(d.adbin,d.adrelid),'')
		FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
		JOIN pg_attribute a ON a.attrelid=c.oid
		LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
		WHERE n.nspname=$1 AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
		UNION ALL
		SELECT 'constraint', c.relname, con.contype::text||' valid='||con.convalidated||' '||pg_get_constraintdef(con.oid,true)
		FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
		WHERE n.nspname=$1
		UNION ALL
		SELECT 'index', c.relname, 'unique='||i.indisunique||' valid='||i.indisvalid||' ready='||i.indisready||' '||substring(pg_get_indexdef(i.indexrelid) FROM ' USING .*')
		FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
		WHERE n.nspname=$1
		UNION ALL
		SELECT 'trigger', c.relname, t.tgname||' type='||t.tgtype||' enabled='||t.tgenabled::text||' '||pg_get_triggerdef(t.oid,true)||' body='||p.prosrc
		FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
		WHERE n.nspname=$1 AND NOT t.tgisinternal
	`,
		[schema],
	);
	return rows
		.map((row) =>
			`${row.kind}:${row.name}:${row.definition}`
				.replaceAll(`"${schema}".`, "<schema>.")
				.replaceAll(`${schema}.`, "<schema>.")
				.replaceAll(`${schema}:`, "<schema>:")
				.replace(/\s+/g, " ")
				.trim(),
		)
		.sort();
}
