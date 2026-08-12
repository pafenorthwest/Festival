export interface ShopifyCredentials {
	storeDomain: string;
	clientId: string;
	clientSecret: string;
}

export interface ShopifyConnectivityTester {
	testCredentials(credentials: ShopifyCredentials): Promise<void>;
}

export interface ShopifyMoney {
	amount: string;
	currencyCode: string;
}

export interface ShopifyProductVariant {
	id: string;
	title: string;
	price: ShopifyMoney;
	productId: string;
	selectedOptions: Array<{
		name: string;
		value: string;
	}>;
}

export interface ShopifyProductDetails {
	id: string;
	title: string;
	description?: string;
	status: "ACTIVE" | "DRAFT" | "ARCHIVED";
	variants: ShopifyProductVariant[];
}

export interface ShopifyMembershipProductClient {
	createProduct(
		credentials: ShopifyCredentials,
		input: {
			name: string;
			description?: string;
		},
	): Promise<ShopifyProductDetails>;
	updateVariantPrice(
		credentials: ShopifyCredentials,
		input: {
			productId: string;
			variantId: string;
			price: string;
		},
	): Promise<ShopifyProductDetails>;
	readProductsByGid(
		credentials: ShopifyCredentials,
		productGids: string[],
	): Promise<ShopifyProductDetails[]>;
	deleteProduct(
		credentials: ShopifyCredentials,
		productGid: string,
	): Promise<void>;
}
