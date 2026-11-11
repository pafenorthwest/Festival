import { AppError } from "@festival/common";
import type { Context } from "hono";

function parseValidatedOrigin(rawUrl: string): string {
	let parsedOrigin: string;
	try {
		parsedOrigin = new URL(rawUrl).origin;
	} catch {
		throw new AppError("CSRF validation failed.", 403);
	}
	if (parsedOrigin === "null") {
		throw new AppError("CSRF validation failed.", 403);
	}
	return parsedOrigin;
}

export function resolveRequestOrigin(c: Context): string | undefined {
	const origin = c.req.header("Origin");
	if (origin) {
		return parseValidatedOrigin(origin);
	}

	const referer = c.req.header("Referer");
	if (referer) {
		return parseValidatedOrigin(referer);
	}

	return undefined;
}
