import type {
	CustomerFestivalAvailabilityResponse,
	SaveCustomerFestivalAvailabilityRequest,
} from "@festival/common";
import { ApiError } from "./api.js";

async function requestCustomerJson<T>(
	path: string,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(path, {
		...init,
		credentials: "include",
		headers: {
			"Content-Type": "application/json",
			...(init?.headers ?? {}),
		},
	});

	const payload = (await response.json()) as
		| T
		| { error?: string; code?: string };
	if (!response.ok) {
		throw new ApiError(
			(payload as { error?: string }).error ?? `Request failed for ${path}`,
			response.status,
			(payload as { code?: string }).code,
		);
	}

	return payload as T;
}

export function getCustomerFestivalAvailability(
	slug: string,
	festivalId?: string,
): Promise<CustomerFestivalAvailabilityResponse> {
	const query = festivalId
		? `?festivalId=${encodeURIComponent(festivalId)}`
		: "";
	return requestCustomerJson<CustomerFestivalAvailabilityResponse>(
		`/api/organizations/${encodeURIComponent(slug)}/customer-account/availability${query}`,
	);
}

export function saveCustomerFestivalAvailability(
	slug: string,
	csrfToken: string,
	input: SaveCustomerFestivalAvailabilityRequest,
): Promise<CustomerFestivalAvailabilityResponse> {
	return requestCustomerJson<CustomerFestivalAvailabilityResponse>(
		`/api/organizations/${encodeURIComponent(slug)}/customer-account/availability`,
		{
			method: "PUT",
			headers: { "X-CSRF-Token": csrfToken },
			body: JSON.stringify(input),
		},
	);
}
