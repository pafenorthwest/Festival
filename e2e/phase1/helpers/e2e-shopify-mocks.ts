import { CUSTOMER_ACCOUNT_API_VERSION } from "@festival/common";
import type { CustomerAccountRepository } from "../../../packages/backend/src/customer/customer-account-repository.js";
import { CustomerAccountTransport } from "../../../packages/backend/src/customer/customer-account-transport.js";
import type {
	ShopifyProductClient,
	ShopifyProductDetails,
} from "../../../packages/backend/src/domains/commerce-projection/shopify-types.js";
import type { OrganizationRepository } from "../../../packages/backend/src/repo/organization-repository.js";
import {
	SHOPIFY_CLIENT_SECRET_PURPOSE,
	SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE,
	type ShopifySecretKeyring,
} from "../../../packages/backend/src/shopify/encryption.js";

export const E2E_STOREFRONT_DOMAIN = "pafe-e2e.myshopify.com";
export const E2E_OIDC_ISSUER = `https://${E2E_STOREFRONT_DOMAIN}`;

class E2eCustomerAccountTransport extends CustomerAccountTransport {
	constructor(private readonly origin: string) {
		super();
	}

	override assertDestination(_url: URL, _configuredDomain: string): void {}

	override async json(url: URL): Promise<Record<string, unknown>> {
		if (url.pathname.endsWith("/.well-known/openid-configuration")) {
			return {
				issuer: E2E_OIDC_ISSUER,
				authorization_endpoint: `${this.origin}/__e2e/oidc/authorize`,
				token_endpoint: `${this.origin}/__e2e/oidc/token`,
				end_session_endpoint: `${this.origin}/__e2e/oidc/logout`,
				jwks_uri: `${this.origin}/__e2e/oidc/jwks`,
				scopes_supported: ["openid", "email", "customer-account-api:full"],
			};
		}
		if (url.pathname.endsWith("/.well-known/customer-account-api")) {
			return {
				graphql_api: `https://${E2E_STOREFRONT_DOMAIN}/customer/api/${CUSTOMER_ACCOUNT_API_VERSION}/graphql`,
			};
		}
		if (url.pathname.endsWith("/__e2e/oidc/jwks")) return { keys: [] };
		return {
			data: {
				customer: {
					orders: {
						nodes: [],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			},
		};
	}
}

export function createE2eCustomerAccountTransport(
	origin: string,
): CustomerAccountTransport {
	return new E2eCustomerAccountTransport(origin);
}

const E2E_SHOPIFY_PRODUCTS: ShopifyProductDetails[] = [
	{
		id: "gid://shopify/Product/9001001",
		title: "Annual Teacher",
		description: "Annual teacher membership",
		status: "ACTIVE",
		variants: [
			{
				id: "gid://shopify/ProductVariant/900100101",
				title: "Default Title",
				price: { amount: "65.00", currencyCode: "USD" },
				productId: "gid://shopify/Product/9001001",
				selectedOptions: [{ name: "Plan", value: "Standard" }],
				requiresShipping: false,
			},
		],
	},
	{
		id: "gid://shopify/Product/9001002",
		title: "Annual Accompanist",
		description: "Annual accompanist membership",
		status: "ACTIVE",
		variants: [
			{
				id: "gid://shopify/ProductVariant/900100201",
				title: "Default Title",
				price: { amount: "0.00", currencyCode: "USD" },
				productId: "gid://shopify/Product/9001002",
				selectedOptions: [{ name: "Plan", value: "Standard" }],
				requiresShipping: false,
			},
		],
	},
];

function buildMockProduct(params: {
	id: string;
	variantId: string;
	title: string;
	description: string;
	amount: string;
	status?: "ACTIVE" | "ARCHIVED";
}): ShopifyProductDetails {
	return {
		id: params.id,
		title: params.title,
		description: params.description,
		status: params.status ?? "ACTIVE",
		variants: [
			{
				id: params.variantId,
				title: "Default Title",
				price: { amount: params.amount, currencyCode: "USD" },
				productId: params.id,
				selectedOptions: [{ name: "Plan", value: "Standard" }],
				requiresShipping: false,
			},
		],
	};
}

async function resolveProductsByGid(
	organizations: OrganizationRepository,
	byId: Map<string, ShopifyProductDetails>,
	organizationId: string,
	productGids: string[],
): Promise<ShopifyProductDetails[]> {
	const records =
		await organizations.listMembershipProductRecords(organizationId);
	const recordByProductGid = new Map(
		records.map((r) => [r.shopifyProductGid, r]),
	);
	const results: ShopifyProductDetails[] = [];
	for (const gid of productGids) {
		const rec = recordByProductGid.get(gid);
		if (rec) {
			const isAccompanist = rec.entitlementClass === "accompanist_membership";
			results.push(
				buildMockProduct({
					id: rec.shopifyProductGid,
					variantId: rec.shopifyVariantGid,
					title: rec.productNameSnapshot,
					description: rec.productNameSnapshot,
					amount: isAccompanist ? "0.00" : "65.00",
					status: rec.isActive ? "ACTIVE" : "ARCHIVED",
				}),
			);
			continue;
		}
		const known = byId.get(gid);
		if (known) results.push(known);
	}
	return results;
}

export function createE2eShopifyProductClient(
	organizations: OrganizationRepository,
): ShopifyProductClient {
	const byId = new Map(E2E_SHOPIFY_PRODUCTS.map((p) => [p.id, p]));
	return {
		async createProduct(_ctx, input) {
			const id = `gid://shopify/Product/${Date.now()}`;
			const product = buildMockProduct({
				id,
				variantId: `gid://shopify/ProductVariant/${Date.now()}`,
				title: input.name,
				description: input.description,
				amount: "0.00",
			});
			byId.set(id, product);
			return { value: product };
		},
		async updateVariantPrice(_ctx, input) {
			const product = byId.get(input.productId) ?? E2E_SHOPIFY_PRODUCTS[0];
			return { value: product };
		},
		async updateInventoryItem(_ctx, input) {
			return { value: { requiresShipping: input.requiresShipping } };
		},
		async publishProductToHeadlessStorefront() {
			return { value: undefined };
		},
		async updateProductDetails(_ctx, input) {
			const product = byId.get(input.productId) ?? E2E_SHOPIFY_PRODUCTS[0];
			return { value: product };
		},
		async readProductsByGid(ctx, productGids) {
			const results = await resolveProductsByGid(
				organizations,
				byId,
				ctx.organizationId,
				productGids,
			);
			return { value: results };
		},
		async deleteProduct(_ctx, productGid) {
			byId.delete(productGid);
			return { value: undefined };
		},
	};
}

export async function ensureE2eCustomerAccountIntegration(params: {
	accounts: CustomerAccountRepository;
	keyring: ShopifySecretKeyring;
	organizationId: string;
	nowIso: string;
}): Promise<number> {
	const { accounts, keyring, organizationId, nowIso } = params;
	if (!(await accounts.getIntegration(organizationId))) {
		await accounts.upsertIntegration({
			organizationId,
			storefrontDomain: E2E_STOREFRONT_DOMAIN,
			clientId: "shp_e2e_client_id",
			encryptedClientSecret: keyring.encrypt("e2e-shopify-client-secret", {
				organizationId,
				purpose: SHOPIFY_CUSTOMER_CLIENT_SECRET_PURPOSE,
			}),
		});
	}
	const integration = await accounts.setIntegrationReadiness(organizationId, {
		readiness: "ready",
		canReadOrders: true,
		verifiedAtIso: nowIso,
	});
	return integration.integrationVersion;
}

export async function ensureE2eShopifyAdminIntegration(params: {
	organizations: OrganizationRepository;
	keyring: ShopifySecretKeyring;
	organizationId: string;
	nowIso: string;
}): Promise<void> {
	const { organizations, keyring, organizationId, nowIso } = params;
	if (!(await organizations.getShopifyIntegration(organizationId))) {
		await organizations.upsertShopifyIntegration({
			organizationId,
			storeDomain: E2E_STOREFRONT_DOMAIN,
			clientId: "shp_e2e_admin_client_id",
			encryptedClientSecret: keyring.encrypt("e2e-shopify-admin-secret", {
				organizationId,
				purpose: SHOPIFY_CLIENT_SECRET_PURPOSE,
			}),
		});
	}
	await organizations.updateShopifyVerification({
		organizationId,
		verificationStatus: "ok",
		lastTestedAtIso: nowIso,
		verifiedAtIso: nowIso,
		verifiedShopGid: "gid://shopify/Shop/9000001",
		verifiedShopDomain: E2E_STOREFRONT_DOMAIN,
		grantedScopes: [
			"read_products",
			"write_products",
			"write_inventory",
			"read_orders",
		],
		capabilities: {
			read_products: "granted",
			write_products: "granted",
			write_inventory: "granted",
			read_orders: "granted",
			write_orders: "disabled",
		},
	});
}

export async function ensureE2eMembershipProducts(
	organizations: OrganizationRepository,
	organizationId: string,
): Promise<void> {
	const defaults = [
		{
			entitlementClass: "teacher_membership" as const,
			shopifyProductGid: "gid://shopify/Product/9001001",
			shopifyVariantGid: "gid://shopify/ProductVariant/900100101",
			productNameSnapshot: "Annual Teacher",
		},
		{
			entitlementClass: "accompanist_membership" as const,
			shopifyProductGid: "gid://shopify/Product/9001002",
			shopifyVariantGid: "gid://shopify/ProductVariant/900100201",
			productNameSnapshot: "Annual Accompanist",
		},
	];
	for (const item of defaults) {
		const existing = await organizations.findMembershipProductRecordByClass(
			organizationId,
			item.entitlementClass,
		);
		if (!existing) {
			await organizations.createMembershipProductRecord({
				organizationId,
				durationDays: 365,
				isActive: true,
				...item,
			});
		}
	}
}
