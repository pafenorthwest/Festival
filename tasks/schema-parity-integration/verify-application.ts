import { mkdir } from "node:fs/promises";
import { SQL } from "bun";

const phase = process.argv[2];
const logRoot = "/private/tmp/schema-parity-integration-validation";
const baselinePath = `${logRoot}/application-before.json`;
const schema = "orgs";
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const connection = process.env.FESTIVAL_DB;
if (!connection || !["before", "after"].includes(phase ?? "")) {
  console.error("Private configuration and before/after verification phase required; values withheld.");
  process.exit(1);
}
const database = new SQL(connection);
try {
  const rollbackIds = new Set<string>();
  if (phase === "after") {
    for (const round of [1, 2, 3]) {
      const log = await Bun.file(`${logRoot}/postgres-round-${round}.log`).text();
      const markers = [...log.matchAll(/\[postgres-fixture\] rolled back application transaction ([a-f0-9-]{36})/g)];
      if (markers.length === 0) throw new Error("Measured round lacks application rollback evidence");
      for (const match of markers) rollbackIds.add(match[1]);
    }
    if (rollbackIds.size === 0) throw new Error("No user-selected application rollback evidence found");
  }
  const current = await database.begin("ISOLATION LEVEL REPEATABLE READ READ ONLY", async (tx) => {
    await tx.unsafe("SET LOCAL statement_timeout = '30s'");
    await tx.unsafe("SET LOCAL lock_timeout = '5s'");
    const relations = await tx.unsafe("SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename", [schema]);
    if (relations.length === 0) throw new Error("Expected application tables absent");
    const tables: { name: string; count: string; fingerprint: string }[] = [];
    for (const relation of relations) {
      const name = String(relation.tablename);
      const rows = await tx.unsafe(`SELECT count(*)::text AS row_count, md5(coalesce(string_agg(row_hash, '' ORDER BY row_hash), '')) AS fingerprint FROM (SELECT md5(to_jsonb(application_row)::text) AS row_hash FROM ${quoteIdentifier(schema)}.${quoteIdentifier(name)} application_row) fingerprints`);
      tables.push({ name, count: String(rows[0].row_count), fingerprint: String(rows[0].fingerprint) });
    }
    const namespaces = await tx.unsafe("SELECT nspname FROM pg_namespace WHERE nspname ~ '^it_[a-z_]{1,24}_[a-f0-9]{32}$' ORDER BY nspname");
    let remainingFixtures = 0;
    for (const identifier of rollbackIds) {
      const rows = await tx.unsafe("SELECT count(*)::text AS count FROM orgs.organizations WHERE id LIKE $1", [`${identifier}-%`]);
      remainingFixtures += Number(rows[0].count);
    }
    return { tables, namespaces: namespaces.map((row) => String(row.nspname)), verifiedRollbackIds: rollbackIds.size, remainingFixtures };
  });
  await mkdir(logRoot, { recursive: true });
  if (phase === "before") {
    await Bun.write(baselinePath, JSON.stringify(current));
    console.log(`Read-only baseline captured privately: ${current.tables.length} application tables; ${current.namespaces.length} matching isolated test namespaces. No row data or fingerprints logged.`);
  } else {
    const baseline = await Bun.file(baselinePath).json() as typeof current;
    const unchanged = JSON.stringify(current.tables) === JSON.stringify(baseline.tables);
    const newNamespaces = current.namespaces.filter((name) => !baseline.namespaces.includes(name));
    await Bun.write(`${logRoot}/application-after.json`, JSON.stringify(current));
    console.log(`Read-only verification: ${current.tables.length} application table counts/fingerprints ${unchanged ? "unchanged" : "DIFFERENT"}; ${current.namespaces.length} matching isolated namespaces, ${newNamespaces.length} new residual namespaces; ${current.verifiedRollbackIds} completed rollback identifiers checked, ${current.remainingFixtures} organization fixture rows remain. No row data or fingerprints logged.`);
    if (!unchanged || current.namespaces.length !== 0 || current.remainingFixtures !== 0) process.exitCode = 1;
  }
} catch {
  console.error("Read-only application preservation verification failed; connection and row details withheld.");
  process.exitCode = 1;
} finally {
  await database.close();
}
