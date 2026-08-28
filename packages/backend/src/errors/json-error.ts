import type { Context } from "hono";
import { AppError } from "./app-error.js";

export function jsonError(c: Context, error: unknown) {
	if (error instanceof AppError) {
		c.status(error.status as 400 | 401 | 403 | 404 | 409 | 500);
		return c.json({
			error: error.message,
			...(error.code ? { code: error.code } : {}),
		});
	}

	c.status(500);
	return c.json({ error: "Internal server error." });
}
