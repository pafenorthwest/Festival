import type { ShopifyFailureCategory } from "@festival/common";

export class ShopifyIntegrationError extends Error {
	readonly failureCategory: ShopifyFailureCategory;
	readonly requestId?: string;
	readonly retryAfterSeconds?: number;

	constructor(
		message: string,
		failureCategory: ShopifyFailureCategory,
		metadata: { requestId?: string; retryAfterSeconds?: number } = {},
	) {
		super(message);
		this.name = "ShopifyIntegrationError";
		this.failureCategory = failureCategory;
		this.requestId = metadata.requestId;
		this.retryAfterSeconds = metadata.retryAfterSeconds;
	}
}

export class ShopifyCredentialsError extends ShopifyIntegrationError {
	constructor(
		message: string,
		failureCategory:
			| "credentials"
			| "identity_mismatch"
			| "missing_scope" = "credentials",
	) {
		super(message, failureCategory);
		this.name = "ShopifyCredentialsError";
	}
}

export class ShopifyIdentityError extends ShopifyCredentialsError {
	constructor() {
		super(
			"Shopify Admin API returned a different shop identity.",
			"identity_mismatch",
		);
		this.name = "ShopifyIdentityError";
	}
}

export class ShopifyScopeError extends ShopifyCredentialsError {
	constructor() {
		super(
			"Shopify integration is missing a required product scope.",
			"missing_scope",
		);
		this.name = "ShopifyScopeError";
	}
}

export class ShopifyAdminApiError extends ShopifyIntegrationError {
	constructor(
		message: string,
		metadata: { requestId?: string; retryAfterSeconds?: number } = {},
		failureCategory: "credentials" | "upstream" = "upstream",
	) {
		super(message, failureCategory, metadata);
		this.name = "ShopifyAdminApiError";
	}
}

export class ShopifyUserError extends ShopifyIntegrationError {
	constructor(message: string, requestId?: string) {
		super(message, "upstream", { requestId });
		this.name = "ShopifyUserError";
	}
}

export class ShopifyTransportError extends ShopifyIntegrationError {
	constructor(message = "Shopify transport request failed.") {
		super(message, "transport");
		this.name = "ShopifyTransportError";
	}
}
