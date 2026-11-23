import type {
	CustomerAccountSettingsResponse,
	CustomerChildDto,
	CustomerFestivalAvailabilityResponse,
	CustomerMembershipStatusResponse,
	CustomerOrdersResponse,
	CustomerProfileResponse,
	CustomerSessionResponse,
	SaveCustomerAccountSettingsInput,
	SaveCustomerAccountSettingsResponse,
	SaveCustomerFestivalAvailabilityRequest,
	UpdateCustomerProfileInput,
} from "@festival/common";
import { hc } from "hono/client";
import type {
	CommerceRoutesType,
	CustomerRoutesType,
} from "../../../../backend/dist/routes/api-router.js";
import { apiPrefix, createRpcFetch, rpcCall, rpcQuery } from "./client.js";

export type {
	CustomerAccountSettingsResponse,
	CustomerChildDto,
	CustomerFestivalAvailabilityResponse,
	CustomerMembershipStatusResponse,
	CustomerOrdersResponse,
	CustomerProfileResponse,
	CustomerSessionResponse,
	SaveCustomerAccountSettingsInput,
	SaveCustomerAccountSettingsResponse,
	SaveCustomerFestivalAvailabilityRequest,
	UpdateCustomerProfileInput,
};

const commerceRpcClient = (options?: {
	idToken?: string;
	useApiBase?: boolean;
}) =>
	hc<CommerceRoutesType>(apiPrefix(options?.useApiBase ?? true), {
		fetch: createRpcFetch({ idToken: options?.idToken }),
	});
const customerRpcClient = (options?: { csrfToken?: string }) =>
	hc<CustomerRoutesType>(apiPrefix(false), {
		fetch: createRpcFetch(
			options?.csrfToken
				? { extraHeaders: { "X-CSRF-Token": options.csrfToken } }
				: undefined,
		),
	});

export function getCustomerAccountSettings(idToken: string, slug: string) {
	const param = { slug: encodeURIComponent(slug) };
	const endpoint = commerceRpcClient({ idToken }).organizations[":slug"].admin[
		"shopify-customer-account"
	];
	return rpcCall<CustomerAccountSettingsResponse>(
		endpoint.$get({ param }),
		endpoint.$path({ param }),
	);
}

export function saveCustomerAccountSettings(
	idToken: string,
	slug: string,
	input: SaveCustomerAccountSettingsInput,
) {
	const param = { slug: encodeURIComponent(slug) };
	const endpoint = commerceRpcClient({ idToken }).organizations[":slug"].admin[
		"shopify-customer-account"
	];
	return rpcCall<SaveCustomerAccountSettingsResponse>(
		endpoint.$post({ param, json: input }),
		endpoint.$path({ param }),
	);
}

export function getCustomerSession(slug: string) {
	const param = { slug: encodeURIComponent(slug) };
	const endpoint = customerRpcClient().organizations[":slug"].customer.session;
	return rpcCall<CustomerSessionResponse>(
		endpoint.$get({ param }),
		endpoint.$path({ param }),
	);
}

export function getCustomerOrders(slug: string, after?: string) {
	const param = { slug: encodeURIComponent(slug) };
	const query = rpcQuery({ after: after || undefined });
	const endpoint = customerRpcClient().organizations[":slug"].customer.orders;
	return rpcCall<CustomerOrdersResponse>(
		endpoint.$get({ param, query }),
		endpoint.$path({ param, query }),
	);
}

export function getCustomerMembershipStatus(slug: string) {
	const param = { slug: encodeURIComponent(slug) };
	const endpoint = commerceRpcClient({ useApiBase: false }).organizations[
		":slug"
	].customer["membership-status"];
	return rpcCall<CustomerMembershipStatusResponse>(
		endpoint.$get({ param }),
		endpoint.$path({ param }),
	);
}

export function getCustomerProfile(slug: string) {
	const param = { slug: encodeURIComponent(slug) };
	const customerRpc = customerRpcClient();
	return rpcCall<CustomerProfileResponse>(
		customerRpc.organizations[":slug"].customer.profile.$get({ param }),
		customerRpc.organizations[":slug"].customer.profile.$path({ param }),
	);
}

export function getCustomerChildren(slug: string) {
	const param = { slug: encodeURIComponent(slug) };
	const endpoint = customerRpcClient().organizations[":slug"].customer.children;
	return rpcCall<{ children: CustomerChildDto[] }>(
		endpoint.$get({ param }),
		endpoint.$path({ param }),
	);
}

export function createCustomerChild(
	slug: string,
	csrfToken: string,
	input: { displayName: string; birthday: string },
) {
	const param = { slug: encodeURIComponent(slug) };
	const endpoint = customerRpcClient({ csrfToken }).organizations[":slug"]
		.customer.children;
	return rpcCall<{ child: CustomerChildDto }>(
		endpoint.$post({ param, json: input }),
		endpoint.$path({ param }),
	);
}

export function refreshCustomerChildAgeSnapshot(
	slug: string,
	childId: string,
	csrfToken: string,
	birthday: string,
) {
	const param = {
		slug: encodeURIComponent(slug),
		childId: encodeURIComponent(childId),
	};
	const endpoint = customerRpcClient({ csrfToken }).organizations[":slug"]
		.customer.children[":childId"]["age-snapshot"];
	return rpcCall<unknown>(
		endpoint.$post({ param, json: { birthday } }),
		endpoint.$path({ param }),
	);
}

export function updateCustomerProfile(
	slug: string,
	csrfToken: string,
	input: UpdateCustomerProfileInput,
) {
	const param = { slug: encodeURIComponent(slug) };
	const endpoint = customerRpcClient({ csrfToken }).organizations[":slug"]
		.customer.profile;
	return rpcCall<CustomerProfileResponse>(
		endpoint.$post({ param, json: input }),
		endpoint.$path({ param }),
	);
}

export function logoutCustomer(slug: string, csrfToken: string): void {
	const customerRpc = customerRpcClient();
	const path = customerRpc.organizations[":slug"].customer.logout.$path({
		param: { slug: encodeURIComponent(slug) },
	});
	const form = document.createElement("form");
	form.method = "POST";
	form.action = `${apiPrefix(false)}${path}`;
	const input = document.createElement("input");
	input.type = "hidden";
	input.name = "csrfToken";
	input.value = csrfToken;
	form.append(input);
	document.body.append(form);
	form.submit();
}
