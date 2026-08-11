export class ShopifyIntegrationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ShopifyIntegrationError";
	}
}

export class ShopifyCredentialsError extends ShopifyIntegrationError {
	constructor(message: string) {
		super(message);
		this.name = "ShopifyCredentialsError";
	}
}

export class ShopifyAdminApiError extends ShopifyIntegrationError {
	constructor(message: string) {
		super(message);
		this.name = "ShopifyAdminApiError";
	}
}

export class ShopifyUserError extends ShopifyIntegrationError {
	constructor(message: string) {
		super(message);
		this.name = "ShopifyUserError";
	}
}
