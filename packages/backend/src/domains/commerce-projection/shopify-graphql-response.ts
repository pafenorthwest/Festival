import { normalizeEffectiveShopifyScopes } from "@festival/common";
import {
	ShopifyAdminApiError,
	ShopifyCredentialsError,
} from "./shopify-errors.js";
import type {
	ShopifyAdminResult,
	ShopifyCredentials,
} from "./shopify-types.js";

export function buildShopifyRequestError(
	errorKind: "credentials" | "admin",
	message: string,
	metadata: { requestId?: string; retryAfterSeconds?: number } = {},
): ShopifyCredentialsError | ShopifyAdminApiError {
	return errorKind === "credentials"
		? new ShopifyCredentialsError(message)
		: new ShopifyAdminApiError(
				message,
				metadata,
				message === "Shopify authorization failed."
					? "credentials"
					: "upstream",
			);
}

export function assertShopifyResponseOk(
	response: Response,
	errorKind: "credentials" | "admin",
	maxResponseBytes: number,
): void {
	if (response.status >= 300 && response.status < 400) {
		throw buildShopifyRequestError(errorKind, "Shopify redirect was rejected.");
	}
	if (!response.ok) {
		const requestId =
			response.headers.get("x-request-id") ??
			response.headers.get("x-shopify-request-id") ??
			undefined;
		const retryAfter = Number.parseInt(
			response.headers.get("retry-after") ?? "",
			10,
		);
		const message =
			response.status === 401 || response.status === 403
				? "Shopify authorization failed."
				: response.status === 429
					? "Shopify request was throttled."
					: "Shopify upstream request failed.";
		throw buildShopifyRequestError(errorKind, message, {
			requestId,
			retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
		});
	}
	const contentLength = Number.parseInt(
		response.headers.get("content-length") ?? "0",
		10,
	);
	if (contentLength > maxResponseBytes) {
		throw buildShopifyRequestError(
			errorKind,
			"Shopify response was too large.",
		);
	}
}

export async function readShopifyResponseJson<T>(
	response: Response,
	errorKind: "credentials" | "admin",
	maxResponseBytes: number,
): Promise<ShopifyAdminResult<T>> {
	const reader = response.body?.getReader();
	if (!reader) {
		throw buildShopifyRequestError(
			errorKind,
			"Shopify returned an empty response.",
		);
	}
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > maxResponseBytes) {
			await reader.cancel();
			throw buildShopifyRequestError(
				errorKind,
				"Shopify response was too large.",
			);
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return {
			value: JSON.parse(new TextDecoder().decode(bytes)) as T,
			requestId:
				response.headers.get("x-request-id") ??
				response.headers.get("x-shopify-request-id") ??
				undefined,
		};
	} catch {
		throw buildShopifyRequestError(errorKind, "Shopify returned invalid JSON.");
	}
}

export function normalizeGrantedScopes(scope: unknown): string[] {
	if (typeof scope !== "string") {
		throw new ShopifyCredentialsError(
			"Shopify token response did not include granted scopes.",
		);
	}
	const scopes = [...new Set(scope.split(",").map((value) => value.trim()))]
		.filter(Boolean)
		.sort();
	if (
		scopes.length === 0 ||
		scopes.some((value) => !/^[a-z][a-z0-9_]*$/.test(value))
	) {
		throw new ShopifyCredentialsError(
			"Shopify token response included invalid granted scopes.",
		);
	}
	return normalizeEffectiveShopifyScopes(scopes);
}

export function buildShopifyUrl(storeDomain: string, path: string): URL {
	if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(storeDomain)) {
		throw new ShopifyCredentialsError(
			"Shopify store domain is not a canonical myshopify.com host.",
		);
	}
	const url = new URL(`https://${storeDomain}${path}`);
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.port ||
		url.hostname !== storeDomain
	) {
		throw new ShopifyCredentialsError("Shopify destination is not allowed.");
	}
	return url;
}

export function accessTokenCacheKey(credentials: ShopifyCredentials): string {
	if (
		!credentials.organizationId ||
		!Number.isSafeInteger(credentials.integrationVersion) ||
		credentials.integrationVersion <= 0
	) {
		throw new ShopifyCredentialsError(
			"Shopify integration identity is invalid.",
		);
	}
	return [
		credentials.organizationId,
		credentials.storeDomain,
		credentials.clientId,
		String(credentials.integrationVersion),
	].join("\u0000");
}
