import { describe, expect, it, spyOn } from "bun:test";
import type {
	AuthenticatedUser,
	CreateInviteInput,
	CreateOrganizationInput,
} from "@festival/common";
import { createApp } from "../src/app.js";
import type { AuthVerifier } from "../src/auth/types.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import type {
	CreateMembershipProductRecordInput,
	ProductRecord,
} from "../src/repo/organization-repository.js";
import type {
	ShopifyMutationAuditInput,
	ShopifyMutationAuditWriter,
} from "../src/shopify/admin-mutation-audit.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	ShopifySecretKeyring,
} from "../src/shopify/encryption.js";
import { PublicMembershipProductService } from "../src/shopify/public-membership-product-service.js";
import { ShopifyIntegrationDiagnosticService } from "../src/shopify/shopify-integration-diagnostic-service.js";
import { ShopifyIntegrationService } from "../src/shopify/shopify-integration-service.js";
import { ShopifyMembershipProductService } from "../src/shopify/shopify-membership-product-service.js";
import type {
	PublicShopifyCatalogProduct,
	ShopifyPublicCatalogClient,
	ShopifyPublicStorefrontAccessResult,
	ShopifyPublicStorefrontDiagnosticClient,
} from "../src/shopify/shopify-public-catalog-client.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyAdminResult,
	ShopifyConnectivityTester,
	ShopifyCredentials,
	ShopifyMembershipProductClient,
	ShopifyProductDetails,
} from "../src/shopify/types.js";

const TEST_AES_KEY = Buffer.alloc(32, 3).toString("base64");

function createKeyring() {
	const keyring = ShopifySecretKeyring.fromEnvironment(
		JSON.stringify({ test: TEST_AES_KEY }),
		"test",
	);
	if (!keyring) throw new Error("Expected configured keyring.");
	return keyring;
}

class FakeAuthVerifier implements AuthVerifier {
	constructor(private readonly users: Record<string, AuthenticatedUser>) {}

	async verify(token: string): Promise<AuthenticatedUser> {
		if (token === "invalid") {
			throw new Error("Invalid token");
		}

		const user = this.users[token];
		if (!user) {
			throw new Error(`Unknown token ${token}`);
		}

		return user;
	}
}

class FakeShopifyTester implements ShopifyConnectivityTester {
	readonly calls: ShopifyCredentials[] = [];

	async testCredentials(credentials: ShopifyCredentials) {
		this.calls.push(credentials);
		return {
			shopGid: "gid://shopify/Shop/1",
			shopDomain: credentials.storeDomain,
			grantedScopes: ["read_products", "write_products", "read_orders"],
		};
	}
}

class FakePublicStorefrontDiagnosticClient
	implements ShopifyPublicStorefrontDiagnosticClient
{
	readonly domains: string[] = [];
	result: ShopifyPublicStorefrontAccessResult = "passed";

	async diagnosePublicStorefrontAccess(
		domain: string,
	): Promise<ShopifyPublicStorefrontAccessResult> {
		this.domains.push(domain);
		return this.result;
	}
}

class FakeAuditWriter implements ShopifyMutationAuditWriter {
	readonly records: ShopifyMutationAuditInput[] = [];
	async ensureReady(): Promise<void> {}
	async append(input: ShopifyMutationAuditInput): Promise<void> {
		this.records.push(input);
	}
}

function shopifyProduct(
	overrides: Partial<ShopifyProductDetails> = {},
): ShopifyProductDetails {
	const id = overrides.id ?? "gid://shopify/Product/generated";

	return {
		id,
		title: "Teacher Membership",
		description: "Annual membership for teachers.",
		status: "ACTIVE",
		variants: [
			{
				id: "gid://shopify/ProductVariant/generated",
				title: "Standard",
				price: { amount: "75.00", currencyCode: "USD" },
				productId: id,
				selectedOptions: [{ name: "Plan", value: "Standard" }],
			},
		],
		...overrides,
	};
}

class FakeShopifyProductClient implements ShopifyMembershipProductClient {
	readonly deletedProductGids: string[] = [];
	readonly readProductGids: string[][] = [];
	createResponse = shopifyProduct();
	updateResponse = shopifyProduct();
	readResponse = [shopifyProduct()];
	readError: Error | null = null;

	async createProduct(): Promise<ShopifyAdminResult<ShopifyProductDetails>> {
		return { value: this.createResponse };
	}

	async updateVariantPrice(): Promise<
		ShopifyAdminResult<ShopifyProductDetails>
	> {
		return { value: this.updateResponse };
	}

	async readProductsByGid(
		_context: ShopifyAdminOperationContext,
		productGids: string[],
	): Promise<ShopifyAdminResult<ShopifyProductDetails[]>> {
		this.readProductGids.push(productGids);
		if (this.readError) {
			throw this.readError;
		}

		return { value: this.readResponse };
	}

	async deleteProduct(
		_context: ShopifyAdminOperationContext,
		productGid: string,
	): Promise<ShopifyAdminResult<void>> {
		this.deletedProductGids.push(productGid);
		return { value: undefined };
	}
}

class FakePublicCatalogClient implements ShopifyPublicCatalogClient {
	readonly calls: Array<{ domain: string; productGid: string }> = [];
	product: PublicShopifyCatalogProduct | null = {
		id: "gid://shopify/Product/generated",
		title: "Current Teacher Membership",
		description: "Current public Shopify description.",
		availableForSale: true,
		variant: {
			id: "gid://shopify/ProductVariant/generated",
			availableForSale: true,
			price: { amount: "75.00", currencyCode: "USD" },
		},
	};

	async readProduct(domain: string, productGid: string) {
		this.calls.push({ domain, productGid });
		return this.product;
	}
}

class FailingMembershipProductRepository extends InMemoryOrganizationRepository {
	async createMembershipProductRecord(
		_input: CreateMembershipProductRecordInput,
	): Promise<ProductRecord> {
		throw new Error("database unavailable");
	}
}

async function createTestApp() {
	const repository = new InMemoryOrganizationRepository();
	return createApp({
		env: { port: 3000 },
		repository,
		authVerifier: new FakeAuthVerifier({
			admin: {
				uid: "uid-admin",
				email: "admin@example.com",
				displayName: "Admin User",
			},
			invitee: {
				uid: "uid-invitee",
				email: "invitee@example.com",
				displayName: "Invitee User",
			},
			outsider: {
				uid: "uid-outsider",
				email: "outsider@example.com",
				displayName: "Outsider User",
			},
		}),
	});
}

async function createTestAppWithShopify() {
	const repository = new InMemoryOrganizationRepository();
	const shopifyTester = new FakeShopifyTester();
	const diagnosticClient = new FakePublicStorefrontDiagnosticClient();
	const app = await createApp({
		env: { port: 3000 },
		repository,
		authVerifier: new FakeAuthVerifier({
			admin: {
				uid: "uid-admin",
				email: "admin@example.com",
				displayName: "Admin User",
			},
			outsider: {
				uid: "uid-outsider",
				email: "outsider@example.com",
				displayName: "Outsider User",
			},
		}),
		shopifyIntegrationService: new ShopifyIntegrationService(
			repository,
			createKeyring(),
			shopifyTester,
		),
		shopifyIntegrationDiagnosticService:
			new ShopifyIntegrationDiagnosticService(repository, diagnosticClient),
	});

	return { ...app, shopifyTester, diagnosticClient };
}

async function createTestAppWithMembershipProducts(
	repository: InMemoryOrganizationRepository = new InMemoryOrganizationRepository(),
) {
	const shopifyProductClient = new FakeShopifyProductClient();
	const publicCatalogClient = new FakePublicCatalogClient();
	const auditWriter = new FakeAuditWriter();
	const encryptor = createKeyring();
	const app = await createApp({
		env: { port: 3000 },
		repository,
		authVerifier: new FakeAuthVerifier({
			admin: {
				uid: "uid-admin",
				email: "admin@example.com",
				displayName: "Admin User",
			},
			reviewer: {
				uid: "uid-reviewer",
				email: "reviewer@example.com",
				displayName: "Reviewer User",
			},
		}),
		shopifyMembershipProductService: new ShopifyMembershipProductService(
			repository,
			encryptor,
			shopifyProductClient,
			auditWriter,
		),
		publicMembershipProductService: new PublicMembershipProductService(
			repository,
			publicCatalogClient,
		),
	});

	return {
		...app,
		repository,
		encryptor,
		shopifyProductClient,
		publicCatalogClient,
		auditWriter,
	};
}

function withAuth(token: string, init?: RequestInit): RequestInit {
	return {
		...init,
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
			...(init?.headers ?? {}),
		},
	};
}

function membershipProductPayload(overrides: Record<string, unknown> = {}) {
	return {
		name: "Teacher Membership",
		description: "Annual membership for teachers.",
		price: "75.00",
		...overrides,
	};
}

async function createOrganizationViaApi(
	app: Awaited<ReturnType<typeof createApp>>["app"],
) {
	await app.fetch(
		new Request(
			"http://test/api/organizations",
			withAuth("admin", {
				method: "POST",
				body: JSON.stringify({
					name: "Festival Admins",
					shortName: "pafe",
				}),
			}),
		),
	);
}

async function saveVerifiedShopifyIntegration(
	repository: InMemoryOrganizationRepository,
	encryptor: ShopifySecretKeyring,
) {
	const organization = await repository.findOrganizationBySlug("pafe");
	if (!organization) {
		throw new Error("Expected test organization to exist.");
	}

	await repository.upsertShopifyIntegration({
		organizationId: organization.id,
		storeDomain: "example.myshopify.com",
		clientId: "client-id",
		encryptedClientSecret: encryptor.encrypt("client-secret", {
			organizationId: organization.id,
			purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
		}),
	});
	await repository.updateShopifyVerification({
		organizationId: organization.id,
		verificationStatus: "ok",
		verifiedAtIso: new Date().toISOString(),
		lastTestedAtIso: new Date().toISOString(),
		verifiedShopGid: "gid://shopify/Shop/1",
		verifiedShopDomain: "example.myshopify.com",
		grantedScopes: ["read_products", "write_products", "read_orders"],
		capabilities: {
			read_products: "granted",
			write_products: "granted",
			read_orders: "granted",
			write_orders: "disabled",
		},
	});

	return organization;
}

describe("organization routes", () => {
	it("starts without a keyring but keeps Shopify services unavailable", async () => {
		const { app } = await createTestApp();
		await createOrganizationViaApi(app);

		const response = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/shopify",
				withAuth("admin"),
			),
		);

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: "Shopify integration is not configured.",
		});
	});

	it("fails application startup for partial or invalid keyring configuration", async () => {
		const authVerifier = new FakeAuthVerifier({});
		await expect(
			createApp({
				env: {
					port: 3000,
					festivalSecretKeysJson: JSON.stringify({ test: TEST_AES_KEY }),
				},
				repository: new InMemoryOrganizationRepository(),
				authVerifier,
			}),
		).rejects.toThrow("Shopify secret keyring configuration is invalid.");
		await expect(
			createApp({
				env: {
					port: 3000,
					festivalSecretKeysJson: "{}",
					festivalActiveSecretKeyId: "test",
				},
				repository: new InMemoryOrganizationRepository(),
				authVerifier,
			}),
		).rejects.toThrow("Shopify secret keyring configuration is invalid.");
	});

	it("constructs Shopify services from a valid keyring configuration", async () => {
		const { app } = await createApp({
			env: {
				port: 3000,
				festivalSecretKeysJson: JSON.stringify({ test: TEST_AES_KEY }),
				festivalActiveSecretKeyId: "test",
			},
			repository: new InMemoryOrganizationRepository(),
			authVerifier: new FakeAuthVerifier({
				admin: {
					uid: "uid-admin",
					email: "admin@example.com",
					displayName: "Admin User",
				},
			}),
		});
		await createOrganizationViaApi(app);

		const response = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/shopify",
				withAuth("admin"),
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ settings: null });
	});

	it("creates an organization and records the creator as Admin", async () => {
		const { app } = await createTestApp();
		const payload: CreateOrganizationInput = {
			name: "Festival Admins",
			shortName: "pafe",
		};

		const response = await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(payload),
				}),
			),
		);

		expect(response.status).toBe(201);
		const data = (await response.json()) as {
			membership: { role: string };
			organization: { name: string; slug: string };
		};
		expect(data.organization.name).toBe("Festival Admins");
		expect(data.organization.slug).toBe("pafe");
		expect(data.membership.role).toBe("Admin");
	});

	it("rejects duplicate organization names", async () => {
		const { app } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Admins",
						shortName: "pafe",
					}),
				}),
			),
		);

		const duplicate = await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("outsider", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Board",
						shortName: "pafe",
					}),
				}),
			),
		);

		expect(duplicate.status).toBe(409);
		await expect(duplicate.json()).resolves.toMatchObject({
			error: "Organization short name is already registered.",
		});
	});

	it("rejects duplicate organization display names with different short names", async () => {
		const { app } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Admins",
						shortName: "pafe",
					}),
				}),
			),
		);

		const duplicate = await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("outsider", {
					method: "POST",
					body: JSON.stringify({
						name: "festival admins",
						shortName: "board",
					}),
				}),
			),
		);

		expect(duplicate.status).toBe(409);
		await expect(duplicate.json()).resolves.toMatchObject({
			error: "Organization name is already registered.",
		});
	});

	it("lists the authenticated user's organization memberships", async () => {
		const { app } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Admins",
						shortName: "pafe",
					}),
				}),
			),
		);
		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Board",
						shortName: "board",
					}),
				}),
			),
		);

		const response = await app.fetch(
			new Request("http://test/api/memberships", withAuth("admin")),
		);

		expect(response.status).toBe(200);
		const data = (await response.json()) as {
			memberships: Array<{ organizationSlug: string; role: string }>;
		};
		expect(data.memberships).toHaveLength(2);
		expect(
			data.memberships.map((membership) => membership.organizationSlug),
		).toEqual(["pafe", "board"]);
		expect(
			data.memberships.every((membership) => membership.role === "Admin"),
		).toBeTrue();
	});

	it("rejects unauthorized organization access", async () => {
		const { app } = await createTestApp();
		const response = await app.fetch(
			new Request("http://test/api/organizations/festival-admins"),
		);

		expect(response.status).toBe(401);
	});

	it("rejects malformed and invalid authorization headers", async () => {
		const { app } = await createTestApp();

		const malformed = await app.fetch(
			new Request("http://test/api/organizations/festival-admins", {
				headers: { Authorization: "Basic admin" },
			}),
		);
		expect(malformed.status).toBe(401);
		await expect(malformed.json()).resolves.toMatchObject({
			error: "Authorization header must use Bearer token format.",
		});

		const invalid = await app.fetch(
			new Request(
				"http://test/api/organizations/festival-admins",
				withAuth("invalid"),
			),
		);
		expect(invalid.status).toBe(401);
		await expect(invalid.json()).resolves.toMatchObject({
			error: "Firebase authentication failed.",
		});
	});

	it("rejects cross-tenant organization access without returning org data", async () => {
		const { app } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Admins",
						shortName: "pafe",
					}),
				}),
			),
		);

		const response = await app.fetch(
			new Request("http://test/api/organizations/pafe", withAuth("outsider")),
		);

		expect(response.status).toBe(403);
		await expect(response.json()).resolves.toEqual({
			error: "Organization access denied.",
		});
	});

	it("creates and accepts an allowed-role invite", async () => {
		const { app } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Admins",
						shortName: "pafe",
					}),
				}),
			),
		);

		const inviteResponse = await app.fetch(
			new Request(
				"http://test/api/invites",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						organizationSlug: "pafe",
						email: "invitee@example.com",
						role: "Music Reviewer",
					} satisfies CreateInviteInput),
				}),
			),
		);

		expect(inviteResponse.status).toBe(201);
		const inviteData = (await inviteResponse.json()) as {
			invite: { token: string; role: string; status: string };
		};
		expect(inviteData.invite.role).toBe("Music Reviewer");
		expect(inviteData.invite.status).toBe("pending");

		const lookupResponse = await app.fetch(
			new Request(`http://test/api/invites/${inviteData.invite.token}`),
		);
		expect(lookupResponse.status).toBe(200);
		const lookupData = (await lookupResponse.json()) as {
			invite: {
				organizationSlug: string;
				email: string;
				role: string;
				status: string;
			};
		};
		expect(lookupData.invite).toMatchObject({
			organizationSlug: "pafe",
			email: "invitee@example.com",
			role: "Music Reviewer",
			status: "pending",
		});

		const acceptResponse = await app.fetch(
			new Request(
				`http://test/api/invites/${inviteData.invite.token}/accept`,
				withAuth("invitee", {
					method: "POST",
					body: JSON.stringify({ name: "Invited Reviewer" }),
				}),
			),
		);

		expect(acceptResponse.status).toBe(201);
		const acceptData = (await acceptResponse.json()) as {
			membership: { role: string; showWelcome: boolean };
		};
		expect(acceptData.membership.role).toBe("Music Reviewer");
		expect(acceptData.membership.showWelcome).toBeTrue();
	});

	it("rejects admin-only invite creation for non-admin organization members", async () => {
		const { app } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Admins",
						shortName: "pafe",
					}),
				}),
			),
		);

		const inviteResponse = await app.fetch(
			new Request(
				"http://test/api/invites",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						organizationSlug: "pafe",
						email: "invitee@example.com",
						role: "Read Only",
					} satisfies CreateInviteInput),
				}),
			),
		);
		const inviteData = (await inviteResponse.json()) as {
			invite: { token: string };
		};

		await app.fetch(
			new Request(
				`http://test/api/invites/${inviteData.invite.token}/accept`,
				withAuth("invitee", {
					method: "POST",
					body: JSON.stringify({ name: "Invited Reader" }),
				}),
			),
		);

		const nonAdminInvite = await app.fetch(
			new Request(
				"http://test/api/invites",
				withAuth("invitee", {
					method: "POST",
					body: JSON.stringify({
						organizationSlug: "pafe",
						email: "outsider@example.com",
						role: "Read Only",
					} satisfies CreateInviteInput),
				}),
			),
		);

		expect(nonAdminInvite.status).toBe(403);
		await expect(nonAdminInvite.json()).resolves.toEqual({
			error: "Insufficient organization role.",
		});
	});

	it("rejects invite creation for non-members and unknown invite tokens", async () => {
		const { app } = await createTestApp();

		const inviteResponse = await app.fetch(
			new Request(
				"http://test/api/invites",
				withAuth("outsider", {
					method: "POST",
					body: JSON.stringify({
						organizationSlug: "pafe",
						email: "invitee@example.com",
						role: "Read Only",
					} satisfies CreateInviteInput),
				}),
			),
		);

		expect(inviteResponse.status).toBe(403);
		await expect(inviteResponse.json()).resolves.toEqual({
			error: "Organization access denied.",
		});

		const lookupResponse = await app.fetch(
			new Request("http://test/api/invites/missing-token"),
		);
		expect(lookupResponse.status).toBe(404);
	});

	it("rejects duplicate invite acceptance", async () => {
		const { app } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Admins",
						shortName: "pafe",
					}),
				}),
			),
		);

		const inviteResponse = await app.fetch(
			new Request(
				"http://test/api/invites",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						organizationSlug: "pafe",
						email: "invitee@example.com",
						role: "Read Only",
					} satisfies CreateInviteInput),
				}),
			),
		);
		const inviteData = (await inviteResponse.json()) as {
			invite: { token: string };
		};

		const firstAccept = await app.fetch(
			new Request(
				`http://test/api/invites/${inviteData.invite.token}/accept`,
				withAuth("invitee", {
					method: "POST",
					body: JSON.stringify({ name: "Invited Reader" }),
				}),
			),
		);
		expect(firstAccept.status).toBe(201);

		const secondAccept = await app.fetch(
			new Request(
				`http://test/api/invites/${inviteData.invite.token}/accept`,
				withAuth("invitee", {
					method: "POST",
					body: JSON.stringify({ name: "Invited Reader" }),
				}),
			),
		);

		expect(secondAccept.status).toBe(409);
		await expect(secondAccept.json()).resolves.toMatchObject({
			error: "Invite has already been accepted.",
		});
	});

	it("lists accepted and pending admin users, blocks duplicates, and deletes rows", async () => {
		const { app } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Admins",
						shortName: "pafe",
					}),
				}),
			),
		);
		const inviteResponse = await app.fetch(
			new Request(
				"http://test/api/invites",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						organizationSlug: "pafe",
						email: "invitee@example.com",
						role: "Music Reviewer",
					} satisfies CreateInviteInput),
				}),
			),
		);
		expect(inviteResponse.status).toBe(201);

		const duplicateInvite = await app.fetch(
			new Request(
				"http://test/api/invites",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						organizationSlug: "pafe",
						email: "INVITEE@example.com",
						role: "Admin",
					} satisfies CreateInviteInput),
				}),
			),
		);
		expect(duplicateInvite.status).toBe(409);

		const usersResponse = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/users",
				withAuth("admin"),
			),
		);
		expect(usersResponse.status).toBe(200);
		const usersData = (await usersResponse.json()) as {
			users: Array<{
				id: string;
				email: string;
				status: "accepted" | "pending";
				isSelf: boolean;
			}>;
		};
		expect(usersData.users.map((user) => user.status)).toEqual([
			"accepted",
			"pending",
		]);
		expect(usersData.users[0]?.isSelf).toBeTrue();

		const selfDelete = await app.fetch(
			new Request(
				`http://test/api/organizations/pafe/admin/memberships/${usersData.users[0]?.id}`,
				withAuth("admin", { method: "DELETE" }),
			),
		);
		expect(selfDelete.status).toBe(400);

		const pendingDelete = await app.fetch(
			new Request(
				`http://test/api/organizations/pafe/admin/invites/${usersData.users[1]?.id}`,
				withAuth("admin", { method: "DELETE" }),
			),
		);
		expect(pendingDelete.status).toBe(200);

		const afterDelete = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/users",
				withAuth("admin"),
			),
		);
		const afterDeleteData = (await afterDelete.json()) as {
			users: Array<{ email: string }>;
		};
		expect(afterDeleteData.users.map((user) => user.email)).toEqual([
			"admin@example.com",
		]);
	});

	it("requires Admin role for admin users and festivals subpages", async () => {
		const { app } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Admins",
						shortName: "pafe",
					}),
				}),
			),
		);
		const inviteResponse = await app.fetch(
			new Request(
				"http://test/api/invites",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						organizationSlug: "pafe",
						email: "invitee@example.com",
						role: "Read Only",
					} satisfies CreateInviteInput),
				}),
			),
		);
		const inviteData = (await inviteResponse.json()) as {
			invite: { token: string };
		};
		await app.fetch(
			new Request(
				`http://test/api/invites/${inviteData.invite.token}/accept`,
				withAuth("invitee", {
					method: "POST",
					body: JSON.stringify({ name: "Read Only User" }),
				}),
			),
		);

		const usersResponse = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/users",
				withAuth("invitee"),
			),
		);
		const festivalsResponse = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/festivals",
				withAuth("invitee"),
			),
		);

		expect(usersResponse.status).toBe(403);
		expect(festivalsResponse.status).toBe(403);
	});

	it("creates and lists organization festivals with validation", async () => {
		const { app } = await createTestApp();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Admins",
						shortName: "pafe",
					}),
				}),
			),
		);

		const createResponse = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/festivals",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Spring Festival (West)",
						startDate: "2027-06-10",
						endDate: "2027-06-12",
					}),
				}),
			),
		);
		expect(createResponse.status).toBe(201);
		const createData = (await createResponse.json()) as {
			festival: { code: string; name: string };
		};
		expect(createData.festival.name).toBe("Spring Festival (West)");
		expect(createData.festival.code).toHaveLength(6);

		const duplicateResponse = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/festivals",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "spring festival (west)",
						startDate: "2027-06-10",
						endDate: "2027-06-12",
					}),
				}),
			),
		);
		expect(duplicateResponse.status).toBe(409);

		const invalidDateResponse = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/festivals",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Summer Festival",
						startDate: "2027-06-12",
						endDate: "2027-06-10",
					}),
				}),
			),
		);
		expect(invalidDateResponse.status).toBe(400);

		const pastDateResponse = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/festivals",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Past Festival",
						startDate: "2020-06-10",
						endDate: "2020-06-12",
					}),
				}),
			),
		);
		expect(pastDateResponse.status).toBe(400);
		await expect(pastDateResponse.json()).resolves.toMatchObject({
			error: "Festival start date cannot be in the past.",
		});

		const listResponse = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/festivals",
				withAuth("admin"),
			),
		);
		const listData = (await listResponse.json()) as {
			festivals: Array<{ name: string; startDate: string; endDate: string }>;
		};
		expect(listData.festivals).toHaveLength(1);
		expect(listData.festivals[0]).toMatchObject({
			name: "Spring Festival (West)",
			startDate: "2027-06-10",
			endDate: "2027-06-12",
		});
	});

	it("saves and verifies Shopify settings without returning the secret", async () => {
		const { app, shopifyTester } = await createTestAppWithShopify();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Admins",
						shortName: "pafe",
					}),
				}),
			),
		);

		const saveResponse = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/shopify",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						storeUrl: "https://example.myshopify.com/admin",
						clientId: "client-id",
						clientSecret: "client-secret",
						storefrontPrivateToken: "private-storefront-token",
					}),
				}),
			),
		);

		expect(saveResponse.status).toBe(200);
		const saveBody = await saveResponse.text();
		expect(saveBody).not.toContain("client-secret");
		const saveData = JSON.parse(saveBody) as {
			settings: {
				storeDomain: string;
				clientId: string;
				hasClientSecret: boolean;
				verificationStatus: string;
			};
		};
		expect(saveData.settings).toMatchObject({
			storeDomain: "example.myshopify.com",
			clientId: "client-id",
			hasClientSecret: true,
			hasStorefrontPrivateToken: true,
			verificationStatus: "ok",
		});
		expect(shopifyTester.calls[0]).toMatchObject({
			storeDomain: "example.myshopify.com",
			clientId: "client-id",
			clientSecret: "client-secret",
			integrationVersion: 1,
		});
		expect(shopifyTester.calls[0]?.organizationId).toBeTruthy();

		const getResponse = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/shopify",
				withAuth("admin"),
			),
		);
		const getBody = await getResponse.text();

		expect(getResponse.status).toBe(200);
		expect(getBody).not.toContain("client-secret");
	});

	it("runs bodyless Admin-only Shopify diagnostics for the verified tenant domain", async () => {
		const { app, diagnosticClient } = await createTestAppWithShopify();
		await createOrganizationViaApi(app);
		const saveResponse = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/shopify",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						storeUrl: "https://example.myshopify.com/admin",
						clientId: "client-id",
						clientSecret: "client-secret",
					}),
				}),
			),
		);
		expect(saveResponse.status).toBe(200);

		const diagnosticUrl =
			"http://test/api/organizations/pafe/admin/shopify/diagnostics";
		const unauthenticated = await app.fetch(
			new Request(diagnosticUrl, { method: "POST" }),
		);
		expect(unauthenticated.status).toBe(401);
		const outsider = await app.fetch(
			new Request(diagnosticUrl, withAuth("outsider", { method: "POST" })),
		);
		expect(outsider.status).toBe(403);
		const browserAuthority = await app.fetch(
			new Request(
				diagnosticUrl,
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({ domain: "attacker.myshopify.com" }),
				}),
			),
		);
		expect(browserAuthority.status).toBe(400);
		expect(diagnosticClient.domains).toHaveLength(0);

		const passed = await app.fetch(
			new Request(diagnosticUrl, withAuth("admin", { method: "POST" })),
		);
		expect(passed.status).toBe(200);
		await expect(passed.json()).resolves.toEqual({
			checks: [
				{
					id: "public_storefront_access",
					status: "passed",
					message: "Public Storefront access is available.",
				},
			],
		});
		expect(diagnosticClient.domains).toEqual(["example.myshopify.com"]);

		diagnosticClient.result = "locked";
		const locked = await app.fetch(
			new Request(diagnosticUrl, withAuth("admin", { method: "POST" })),
		);
		expect(locked.status).toBe(200);
		await expect(locked.json()).resolves.toEqual({
			checks: [
				{
					id: "public_storefront_access",
					status: "failed",
					message:
						"Shopify's Online Store channel is locked. Public membership browsing is unavailable until the storefront is publicly accessible.",
				},
			],
		});
	});

	it("rejects malformed Shopify settings payloads with validation errors", async () => {
		const { app, shopifyTester } = await createTestAppWithShopify();

		await app.fetch(
			new Request(
				"http://test/api/organizations",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						name: "Festival Admins",
						shortName: "pafe",
					}),
				}),
			),
		);

		for (const payload of [{}, null]) {
			const response = await app.fetch(
				new Request(
					"http://test/api/organizations/pafe/admin/shopify",
					withAuth("admin", {
						method: "POST",
						body: JSON.stringify(payload),
					}),
				),
			);

			expect(response.status).toBe(400);
			await expect(response.json()).resolves.toMatchObject({
				error:
					"Shopify store URL is required. Shopify client ID is required. Shopify client secret is required.",
			});
		}
		expect(shopifyTester.calls).toHaveLength(0);
	});

	it("rejects browser-selected tenant and token fields in Shopify settings", async () => {
		const { app, shopifyTester } = await createTestAppWithShopify();
		await createOrganizationViaApi(app);
		const response = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/shopify",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify({
						storeUrl: "example.myshopify.com",
						clientId: "client-id",
						clientSecret: "client-secret",
						organizationId: "other-organization",
						accessToken: "browser-token-canary",
					}),
				}),
			),
		);
		expect(response.status).toBe(400);
		expect(await response.text()).not.toContain("browser-token-canary");
		expect(shopifyTester.calls).toHaveLength(0);
	});

	it("rejects unauthenticated membership product creation", async () => {
		const { app } = await createTestAppWithMembershipProducts();

		const response = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/membership-products",
				{
					method: "POST",
					body: JSON.stringify(membershipProductPayload()),
				},
			),
		);

		expect(response.status).toBe(401);
	});

	it("rejects unauthenticated membership product listing", async () => {
		const { app } = await createTestAppWithMembershipProducts();

		const response = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/membership-products",
			),
		);

		expect(response.status).toBe(401);
	});

	it("rejects non-admin membership product creation", async () => {
		const { app, repository } = await createTestAppWithMembershipProducts();
		await createOrganizationViaApi(app);
		const reviewer = await repository.upsertUser({
			uid: "uid-reviewer",
			email: "reviewer@example.com",
			displayName: "Reviewer User",
		});
		const organization = await repository.findOrganizationBySlug("pafe");
		if (!organization) {
			throw new Error("Expected test organization to exist.");
		}
		await repository.createMembership({
			organizationId: organization.id,
			userId: reviewer.id,
			role: "Music Reviewer",
			origin: "direct",
		});

		const response = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/membership-products",
				withAuth("reviewer", {
					method: "POST",
					body: JSON.stringify(membershipProductPayload()),
				}),
			),
		);

		expect(response.status).toBe(403);
	});

	it("rejects non-admin membership product listing before Shopify access", async () => {
		const { app, repository, shopifyProductClient } =
			await createTestAppWithMembershipProducts();
		await createOrganizationViaApi(app);
		const reviewer = await repository.upsertUser({
			uid: "uid-reviewer",
			email: "reviewer@example.com",
			displayName: "Reviewer User",
		});
		const organization = await repository.findOrganizationBySlug("pafe");
		if (!organization) {
			throw new Error("Expected test organization to exist.");
		}
		await repository.createMembership({
			organizationId: organization.id,
			userId: reviewer.id,
			role: "Music Reviewer",
			origin: "direct",
		});
		const shopifySpy = spyOn(shopifyProductClient, "readProductsByGid");

		const response = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/membership-products",
				withAuth("reviewer"),
			),
		);

		expect(response.status).toBe(403);
		expect(shopifySpy).not.toHaveBeenCalled();
	});

	it("lists membership products for an authenticated Admin", async () => {
		const { app, repository, encryptor, shopifyProductClient } =
			await createTestAppWithMembershipProducts();
		await createOrganizationViaApi(app);
		const organization = await saveVerifiedShopifyIntegration(
			repository,
			encryptor,
		);
		await repository.createMembershipProductRecord({
			organizationId: organization.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/generated",
			shopifyVariantGid: "gid://shopify/ProductVariant/generated",
			productNameSnapshot: "Teacher Membership",
		});

		const response = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/membership-products",
				withAuth("admin"),
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			membershipProducts: [
				{
					name: "Teacher Membership",
					entitlementClass: "teacher_membership",
					durationDays: 365,
					isActive: true,
					shopifyProductGid: "gid://shopify/Product/generated",
					shopifyVariantGid: "gid://shopify/ProductVariant/generated",
					price: { amount: "75.00", currencyCode: "USD" },
				},
			],
		});
		expect(shopifyProductClient.readProductGids).toEqual([
			["gid://shopify/Product/generated"],
		]);
	});

	it("rejects invalid membership product payloads before Shopify creation", async () => {
		const { app, repository, encryptor, shopifyProductClient } =
			await createTestAppWithMembershipProducts();
		await createOrganizationViaApi(app);
		await saveVerifiedShopifyIntegration(repository, encryptor);

		const response = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/membership-products",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(
						membershipProductPayload({ name: "", price: "1.234" }),
					),
				}),
			),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error:
				"Membership product name is required. Membership product price must be a non-negative decimal string with at most 2 decimal places.",
		});
		expect(shopifyProductClient.readProductGids).toHaveLength(0);
	});

	it("rejects membership product creation without verified Shopify integration", async () => {
		const { app } = await createTestAppWithMembershipProducts();
		await createOrganizationViaApi(app);

		const response = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/membership-products",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(membershipProductPayload()),
				}),
			),
		);

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toMatchObject({
			error: "Shopify integration is not configured.",
		});
	});

	it("rejects browser-supplied Shopify identifiers before creation", async () => {
		const { app, repository, encryptor, shopifyProductClient } =
			await createTestAppWithMembershipProducts();
		await createOrganizationViaApi(app);
		await saveVerifiedShopifyIntegration(repository, encryptor);

		const response = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/membership-products",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(
						membershipProductPayload({
							shopifyProductGid: "gid://shopify/Product/browser-supplied",
							shopifyVariantGid:
								"gid://shopify/ProductVariant/browser-supplied",
							credentials: { clientSecret: "browser-secret" },
						}),
					),
				}),
			),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error:
				"Membership product request cannot include browser-controlled fields: shopifyProductGid, shopifyVariantGid, credentials.",
		});
		expect(shopifyProductClient.readProductGids).toHaveLength(0);
	});

	it("creates a membership product from server-generated Shopify IDs and persists the association", async () => {
		const { app, repository, encryptor, shopifyProductClient } =
			await createTestAppWithMembershipProducts();
		await createOrganizationViaApi(app);
		const organization = await saveVerifiedShopifyIntegration(
			repository,
			encryptor,
		);

		const response = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/membership-products",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(membershipProductPayload()),
				}),
			),
		);

		expect(response.status).toBe(201);
		const data = (await response.json()) as {
			membershipProduct: {
				id: string;
				name: string;
				shopifyProductGid: string;
				shopifyVariantGid: string;
				variantName: string;
				entitlementClass: string;
				durationDays: number;
				isActive: boolean;
				price: { amount: string; currencyCode: string };
			};
		};
		expect(data.membershipProduct).toMatchObject({
			name: "Teacher Membership",
			shopifyProductGid: "gid://shopify/Product/generated",
			shopifyVariantGid: "gid://shopify/ProductVariant/generated",
			variantName: "Standard",
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
			price: { amount: "75.00", currencyCode: "USD" },
		});
		expect(shopifyProductClient.readProductGids).toEqual([
			["gid://shopify/Product/generated"],
		]);
		const records = await repository.listMembershipProductRecords(
			organization.id,
		);
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/generated",
			shopifyVariantGid: "gid://shopify/ProductVariant/generated",
			productNameSnapshot: "Teacher Membership",
		});
	});

	it("returns an explicit conflict for a duplicate active Teacher Membership before Shopify", async () => {
		const { app, repository, encryptor, shopifyProductClient, auditWriter } =
			await createTestAppWithMembershipProducts();
		await createOrganizationViaApi(app);
		const organization = await saveVerifiedShopifyIntegration(
			repository,
			encryptor,
		);
		await repository.createMembershipProductRecord({
			organizationId: organization.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/existing",
			shopifyVariantGid: "gid://shopify/ProductVariant/existing",
			productNameSnapshot: "Existing Teacher Membership",
		});
		const createSpy = spyOn(shopifyProductClient, "createProduct");
		const updateSpy = spyOn(shopifyProductClient, "updateVariantPrice");
		const deleteSpy = spyOn(shopifyProductClient, "deleteProduct");

		const response = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/membership-products",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(membershipProductPayload()),
				}),
			),
		);

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toEqual({
			error:
				"An active Teacher Membership already exists for this organization.",
		});
		expect(createSpy).not.toHaveBeenCalled();
		expect(updateSpy).not.toHaveBeenCalled();
		expect(deleteSpy).not.toHaveBeenCalled();
		expect(auditWriter.records).toHaveLength(0);
	});

	it("cleans up the Shopify product when route persistence fails", async () => {
		const repository = new FailingMembershipProductRepository();
		const { app, encryptor, shopifyProductClient } =
			await createTestAppWithMembershipProducts(repository);
		await createOrganizationViaApi(app);
		await saveVerifiedShopifyIntegration(repository, encryptor);

		const response = await app.fetch(
			new Request(
				"http://test/api/organizations/pafe/admin/membership-products",
				withAuth("admin", {
					method: "POST",
					body: JSON.stringify(membershipProductPayload()),
				}),
			),
		);

		expect(response.status).toBe(502);
		expect(shopifyProductClient.deletedProductGids).toEqual([
			"gid://shopify/Product/generated",
		]);
	});

	it("returns the allowlisted current Teacher Membership through the credential-free public catalog", async () => {
		const {
			app,
			repository,
			encryptor,
			shopifyProductClient,
			publicCatalogClient,
		} = await createTestAppWithMembershipProducts();
		await createOrganizationViaApi(app);
		const organization = await saveVerifiedShopifyIntegration(
			repository,
			encryptor,
		);
		const offering = await repository.createMembershipProductRecord({
			organizationId: organization.id,
			entitlementClass: "teacher_membership",
			durationDays: 365,
			isActive: true,
			shopifyProductGid: "gid://shopify/Product/generated",
			shopifyVariantGid: "gid://shopify/ProductVariant/generated",
			productNameSnapshot: "Stale local name",
		});
		const shopifySpy = spyOn(shopifyProductClient, "readProductsByGid");

		const response = await app.fetch(
			new Request("http://test/api/organizations/pafe/membership-products"),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		const payload = await response.json();
		expect(payload).toEqual({
			organization: { slug: "pafe", name: "Festival Admins" },
			membershipProducts: [
				{
					id: offering.id,
					name: "Current Teacher Membership",
					description: "Current public Shopify description.",
					entitlementClass: "teacher_membership",
					durationDays: 365,
					available: true,
					price: { amount: "75.00", currencyCode: "USD" },
				},
			],
		});
		expect(JSON.stringify(payload)).not.toMatch(
			/shopifyProductGid|shopifyVariantGid|organizationId|clientSecret|token|customer/i,
		);
		expect(publicCatalogClient.calls).toEqual([
			{
				domain: "example.myshopify.com",
				productGid: "gid://shopify/Product/generated",
			},
		]);
		expect(shopifySpy).not.toHaveBeenCalled();

		const head = await app.fetch(
			new Request("http://test/api/organizations/pafe/membership-products", {
				method: "HEAD",
			}),
		);
		expect(head.status).toBe(200);
		expect(await head.text()).toBe("");
	});

	it("rejects credentials and bodies on the public membership route", async () => {
		const { app, publicCatalogClient } =
			await createTestAppWithMembershipProducts();
		const bearer = await app.fetch(
			new Request("http://test/api/organizations/pafe/membership-products", {
				headers: { Authorization: "Bearer admin" },
			}),
		);
		expect(bearer.status).toBe(400);
		const body = await app.fetch(
			new Request("http://test/api/organizations/pafe/membership-products", {
				method: "GET",
				headers: { "Content-Length": "1" },
			}),
		);
		expect(body.status).toBe(400);
		const invalidLength = await app.fetch(
			new Request("http://test/api/organizations/pafe/membership-products", {
				headers: { "Content-Length": "invalid" },
			}),
		);
		expect(invalidLength.status).toBe(400);
		expect(publicCatalogClient.calls).toHaveLength(0);
	});
});
