import type { Context, MiddlewareHandler } from "hono";

export const MAX_API_BODY_BYTES = 64 * 1024;

async function requestBodyIsTooLarge(c: Context): Promise<boolean> {
	const declaredSize = Number.parseInt(
		c.req.header("content-length") ?? "0",
		10,
	);
	if (declaredSize > MAX_API_BODY_BYTES) {
		return true;
	}

	if (!c.req.raw.body || declaredSize > 0) {
		return false;
	}

	const reader = c.req.raw.clone().body?.getReader();
	if (!reader) {
		return false;
	}

	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			return false;
		}

		size += value.byteLength;
		if (size > MAX_API_BODY_BYTES) {
			await reader.cancel();
			return true;
		}
	}
}

export function apiRequestSecurity(): MiddlewareHandler {
	return async (c, next) => {
		const isCustomerLogout =
			/^\/api\/organizations\/[^/]+\/customer\/logout$/.test(c.req.path);
		const isCustomerProfile =
			/^\/api\/organizations\/[^/]+\/customer\/profile$/.test(c.req.path);
		if (
			c.req.method === "POST" &&
			c.req.raw.body &&
			(c.req.header("Authorization") !== undefined ||
				isCustomerLogout ||
				isCustomerProfile)
		) {
			if (await requestBodyIsTooLarge(c)) {
				return c.json({ error: "Request body is too large." }, 413);
			}

			const contentType = c.req.header("content-type")?.toLowerCase() ?? "";
			if (!isCustomerLogout && !contentType.startsWith("application/json")) {
				return c.json({ error: "Content-Type must be application/json." }, 415);
			}
		}

		return next();
	};
}
