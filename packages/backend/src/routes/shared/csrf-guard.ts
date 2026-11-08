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

	const host =
		c.req.header("X-Forwarded-Host")?.split(",")[0]?.trim() ||
		c.req.header("Host")?.split(",")[0]?.trim();
	if (host) {
		const rawProto =
			c.req.header("X-Forwarded-Proto")?.split(",")[0]?.trim() || "https";
		const proto = rawProto.replace(/:.*$/, "") || "https";
		try {
			return new URL(`${proto}://${host}`).origin;
		} catch {
			return undefined;
		}
	}

	return undefined;
}
