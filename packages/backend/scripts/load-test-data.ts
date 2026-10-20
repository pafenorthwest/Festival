import { buildDatabaseUrl } from "../src/config/env.js";
import type { CustomerAccountRepository } from "../src/customer/customer-account-repository.js";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";
import { PostgresCustomerAccountRepository } from "../src/customer/postgres-customer-account-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import type { OrganizationRepository } from "../src/repo/organization-repository.js";
import { PostgresOrganizationRepository } from "../src/repo/postgres-organization-repository.js";
import { loadTestData } from "../src/seed/test-data-loader.js";

function parseArgs(args: string[]): { dryRun: boolean } {
	let dryRun = false;
	for (const arg of args) {
		if (arg === "--dry-run") {
			dryRun = true;
		} else {
			throw new Error(`Usage: bun run seed:test-data [-- --dry-run]`);
		}
	}
	return { dryRun };
}

function resolveDatabaseUrl(): string | undefined {
	const explicit = process.env.DATABASE_URL?.trim();
	if (explicit) return explicit;
	const hasDbParts =
		process.env.DB_HOST?.trim() &&
		process.env.DB_USER?.trim() &&
		process.env.DATABASE?.trim();
	return hasDbParts ? buildDatabaseUrl() : undefined;
}

function createRepositories(dryRun: boolean): {
	mode: "postgres" | "in-memory";
	organizations: OrganizationRepository;
	accounts: CustomerAccountRepository;
} {
	if (dryRun) {
		return {
			mode: "in-memory",
			organizations: new InMemoryOrganizationRepository(),
			accounts: new InMemoryCustomerAccountRepository(),
		};
	}
	const databaseUrl = resolveDatabaseUrl();
	if (!databaseUrl) {
		return {
			mode: "in-memory",
			organizations: new InMemoryOrganizationRepository(),
			accounts: new InMemoryCustomerAccountRepository(),
		};
	}
	process.env.DATABASE_URL = databaseUrl;
	const schema = process.env.DB_SCHEMA?.trim() || "public";
	return {
		mode: "postgres",
		organizations: new PostgresOrganizationRepository(schema),
		accounts: new PostgresCustomerAccountRepository(schema),
	};
}

const { dryRun } = parseArgs(Bun.argv.slice(2));
const { mode, organizations, accounts } = createRepositories(dryRun);
const summary = await loadTestData({ organizations, accounts });

console.log(
	JSON.stringify({
		status: "ok",
		mode,
		dryRun,
		...summary,
	}),
);
process.exit(0);
