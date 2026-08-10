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
