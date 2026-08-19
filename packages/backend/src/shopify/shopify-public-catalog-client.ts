import { AppError } from "../errors/app-error.js";

const STOREFRONT_API_VERSION = "2026-07";
const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const SHOPIFY_GID_PATTERN =
	/^gid:\/\/shopify\/(Product|ProductVariant)\/[A-Za-z0-9]+$/;
const MONEY_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export interface PublicShopifyCatalogProduct {
	id: string;
	title: string;
	description?: string;
	availableForSale: boolean;
	variant: {
		id: string;
		availableForSale: boolean;
		price: { amount: string; currencyCode: string };
	};
}

export interface ShopifyPublicCatalogClient {
	readProduct(
		shopDomain: string,
		productGid: string,
	): Promise<PublicShopifyCatalogProduct | null>;
}

type Fetch = typeof fetch;

function unavailable(): AppError {
	return new AppError(
		"Membership information is temporarily unavailable.",
		503,
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertPublicShopDomain(value: string): string {
	const normalized = value.toLowerCase();
	if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)) {
		throw unavailable();
	}
	return normalized;
}

function parseProduct(value: unknown): PublicShopifyCatalogProduct | null {
	if (value === null) return null;
	if (!isRecord(value) || !Array.isArray(value.variants)) throw unavailable();
	if (
		typeof value.id !== "string" ||
		!SHOPIFY_GID_PATTERN.test(value.id) ||
		typeof value.title !== "string" ||
		value.title.length === 0 ||
		value.title.length > 255 ||
		(value.description !== undefined &&
			(typeof value.description !== "string" ||
				value.description.length > 5_000)) ||
		typeof value.availableForSale !== "boolean" ||
		value.variants.length !== 1
	) {
		throw unavailable();
	}
	const variant = value.variants[0];
	if (
		!isRecord(variant) ||
		typeof variant.id !== "string" ||
		!SHOPIFY_GID_PATTERN.test(variant.id) ||
		typeof variant.availableForSale !== "boolean" ||
		!isRecord(variant.price) ||
		typeof variant.price.amount !== "string" ||
		!MONEY_PATTERN.test(variant.price.amount) ||
		typeof variant.price.currencyCode !== "string" ||
		!CURRENCY_PATTERN.test(variant.price.currencyCode)
	) {
		throw unavailable();
	}
	return {
		id: value.id,
		title: value.title,
		description: value.description as string | undefined,
		availableForSale: value.availableForSale,
		variant: {
			id: variant.id,
			availableForSale: variant.availableForSale,
			price: {
				amount: variant.price.amount,
				currencyCode: variant.price.currencyCode,
			},
		},
	};
}

export class TokenlessShopifyPublicCatalogClient
	implements ShopifyPublicCatalogClient
{
	constructor(private readonly request: Fetch = fetch) {}

	async readProduct(
		shopDomain: string,
		productGid: string,
	): Promise<PublicShopifyCatalogProduct | null> {
		if (!SHOPIFY_GID_PATTERN.test(productGid)) throw unavailable();
		const domain = assertPublicShopDomain(shopDomain);
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		try {
			const response = await this.request(
				`https://${domain}/api/${STOREFRONT_API_VERSION}/graphql.json`,
				{
					method: "POST",
					redirect: "error",
					signal: controller.signal,
					headers: {
						"Content-Type": "application/json",
						"User-Agent": "Festival-Public-Catalog/1.0",
					},
					body: JSON.stringify({
						query: `query FestivalPublicMembership($id: ID!) {
							product(id: $id) {
								id title description availableForSale
								variants(first: 2) { nodes { id availableForSale price { amount currencyCode } } }
							}
						}`,
						variables: { id: productGid },
					}),
				},
			);
			const declaredSize = Number.parseInt(
				response.headers.get("content-length") ?? "0",
				10,
			);
			if (!response.ok || declaredSize > MAX_RESPONSE_BYTES)
				throw unavailable();
			const bytes = new Uint8Array(await response.arrayBuffer());
			if (bytes.byteLength > MAX_RESPONSE_BYTES) throw unavailable();
			const payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
			if (!isRecord(payload) || payload.errors !== undefined)
				throw unavailable();
			const data = payload.data;
			if (!isRecord(data)) throw unavailable();
			const product = data.product;
			if (product === null) return null;
			if (!isRecord(product) || !isRecord(product.variants))
				throw unavailable();
			return parseProduct({ ...product, variants: product.variants.nodes });
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw unavailable();
		} finally {
			clearTimeout(timeout);
		}
	}
}
