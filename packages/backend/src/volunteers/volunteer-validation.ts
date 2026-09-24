export interface EnrollVolunteerRequest {
	name: string;
	phone: string;
}

function asString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function validateEnrollVolunteerRequest(
	payload: unknown,
): { request: EnrollVolunteerRequest } | { errors: string[] } {
	const body = (payload ?? {}) as Record<string, unknown>;
	const errors: string[] = [];

	const name = asString(body.name);
	if (name.length === 0) {
		errors.push("Name is required.");
	} else if (name.length > 200) {
		errors.push("Name must be 200 characters or less.");
	}

	const phone = asString(body.phone);
	if (phone.length === 0) {
		errors.push("Phone is required.");
	} else if (phone.length > 40) {
		errors.push("Phone must be 40 characters or less.");
	}

	if (errors.length > 0) return { errors };
	return { request: { name, phone } };
}
