import { AppError } from "../../errors/app-error.js";

export function assertAllowedFields(
	payload: unknown,
	allowedFields: readonly string[],
	context: string,
): void {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new AppError(`${context} payload must be an object.`, 400);
	}

	const allowedSet = new Set(allowedFields);
	const disallowed = Object.keys(payload).filter((key) => !allowedSet.has(key));

	if (disallowed.length > 0) {
		throw new AppError(
			`${context} contains unexpected fields: ${disallowed.join(", ")}`,
			400,
		);
	}
}
