import type { AuthenticatedUser } from "@festival/common";
import { createApp } from "../src/app.js";
import type { AuthVerifier } from "../src/auth/types.js";
import type { CustomerAccountService } from "../src/customer/customer-account-service.js";
import { AppError } from "../src/errors/app-error.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";

class FakeAuth implements AuthVerifier {
	async verify(token: string): Promise<AuthenticatedUser> {
		const users: Record<string, AuthenticatedUser> = {
			"admin-org-a": {
				uid: "uid-admin-a",
				email: "admin-a@example.com",
				displayName: "Admin A",
			},
			"admin-org-b": {
				uid: "uid-admin-b",
				email: "admin-b@example.com",
				displayName: "Admin B",
			},
			"member-org-a": {
				uid: "uid-member-a",
				email: "member-a@example.com",
				displayName: "Member A",
			},
		};
		const user = users[token];
		if (!user) throw new AppError(`Unknown token: ${token}`, 401);
		return user;
	}
}

/**
 * Mirrors CustomerAccountService session checks: the URL slug must resolve to
 * the organization that owns the session, otherwise the session is invalid.
 */
class FakeCustomerAccountService {
	public sessions = new Map<
		string,
		{ customerId: string; organizationId: string; csrfToken: string }
	>();

	constructor(private readonly repository: InMemoryOrganizationRepository) {}

	private async session(slug: string, sessionId?: string) {
		const org = await this.repository.findOrganizationBySlug(slug);
		const s = sessionId ? this.sessions.get(sessionId) : undefined;
		if (!org || !s || s.organizationId !== org.id) {
			throw new AppError("Customer session is invalid.", 401);
		}
		return s;
	}

	async customerReadAccess(slug: string, sessionId?: string) {
		const s = await this.session(slug, sessionId);
		return { organizationId: s.organizationId, customerId: s.customerId };
	}

	async formAccess(
		slug: string,
		sessionId?: string,
		csrf?: string,
		_origin?: string,
	) {
		const s = await this.session(slug, sessionId);
		if (!csrf || csrf !== s.csrfToken) {
			throw new AppError("CSRF validation failed.", 403);
		}
		return { organizationId: s.organizationId, customerId: s.customerId };
	}
}

async function seedUsers(
	repository: InMemoryOrganizationRepository,
	orgAId: string,
	orgBId: string,
) {
	const members = [
		[
			"uid-admin-a",
			"admin-a@example.com",
			"Admin A",
			orgAId,
			"Admin",
			"creator",
		],
		[
			"uid-admin-b",
			"admin-b@example.com",
			"Admin B",
			orgBId,
			"Admin",
			"creator",
		],
		[
			"uid-member-a",
			"member-a@example.com",
			"Member A",
			orgAId,
			"Read Only",
			"invite",
		],
	] as const;
	for (const [
		uid,
		email,
		displayName,
		organizationId,
		role,
		origin,
	] of members) {
		const user = await repository.upsertUser({ uid, email, displayName });
		await repository.createMembership({
			organizationId,
			userId: user.id,
			role,
			origin,
		});
	}
}

export async function setupTestApp() {
	const repository = new InMemoryOrganizationRepository();
	const customerAccountService = new FakeCustomerAccountService(repository);

	const orgA = await repository.createOrganization({
		name: "Organization A",
		slug: "org-a",
	});
	const orgB = await repository.createOrganization({
		name: "Organization B",
		slug: "org-b",
	});
	await seedUsers(repository, orgA.id, orgB.id);

	const divA1 = await repository.createDivision({
		organizationId: orgA.id,
		displayName: "Piano A",
		normalizedName: "piano-a",
	});
	const divA2 = await repository.createDivision({
		organizationId: orgA.id,
		displayName: "Strings A",
		normalizedName: "strings-a",
	});
	const divB1 = await repository.createDivision({
		organizationId: orgB.id,
		displayName: "Piano B",
		normalizedName: "piano-b",
	});

	// Register test customer sessions
	customerAccountService.sessions.set("sess-cust-1", {
		customerId: "cust-1",
		organizationId: orgA.id,
		csrfToken: "csrf-token-1",
	});
	customerAccountService.sessions.set("sess-cust-2", {
		customerId: "cust-2",
		organizationId: orgA.id,
		csrfToken: "csrf-token-2",
	});

	const { app } = await createApp({
		env: { port: 3000 },
		repository,
		authVerifier: new FakeAuth(),
		customerAccountService:
			customerAccountService as unknown as CustomerAccountService,
	});

	return {
		app,
		repository,
		customerAccountService,
		orgA,
		orgB,
		divA1,
		divA2,
		divB1,
	};
}
