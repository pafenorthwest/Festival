import { AppError } from "@festival/common";
import type { Context } from "hono";

export function resolveRequestOrigin(c: Context): string | undefined {
	const origin = c.req.header("Origin");
	if (origin) {
		return origin;
	}

	const referer = c.req.header("Referer");
	if (referer) {
		try {
			return new URL(referer).origin;
		} catch {
			throw new AppError("CSRF validation failed.", 403);
		}
	}

	return undefined;
}
