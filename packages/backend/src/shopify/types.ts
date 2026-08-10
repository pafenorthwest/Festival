export interface ShopifyCredentials {
	storeDomain: string;
	clientId: string;
	clientSecret: string;
}

export interface ShopifyConnectivityTester {
	testCredentials(credentials: ShopifyCredentials): Promise<void>;
}
