import { describe, expect, it } from "bun:test";
import { AppError } from "@festival/common";
import { type Context, Hono } from "hono";
import { resolveRequestOrigin } from "../src/routes/shared/csrf-guard.js";

function createMockContext(
	headers: Record<string, string | undefined> = {},
): Context {
	return {
		req: {
			header: (name: string) => {
				const lower = name.toLowerCase();
				for (const [key, value] of Object.entries(headers)) {
					if (key.toLowerCase() === lower) {
						return value;
					}
				}
				return undefined;
			},
		},
	} as unknown as Context;
}

function createTestApp() {
	const app = new Hono();
	app.onError((err, c) => {
		if (err instanceof AppError) {
			return c.json({ error: err.message }, err.status as 403);
		}
		return c.json({ error: "Internal server error." }, 500);
	});
	app.post("/test-csrf", (c) => {
		const origin = resolveRequestOrigin(c);
		return c.json({ origin: origin ?? null });
	});
	return app;
}

describe("resolveRequestOrigin", () => {
	describe("unit tests with mock context", () => {
		it("returns Origin header value when Origin header is present", () => {
			const c = createMockContext({ Origin: "https://example.com" });
			const result = resolveRequestOrigin(c);
			expect(result).toBe("https://example.com");
		});

		it("returns Origin header value including custom port", () => {
			const c = createMockContext({ Origin: "http://localhost:3000" });
			const result = resolveRequestOrigin(c);
			expect(result).toBe("http://localhost:3000");
		});

		it("returns origin derived from valid Referer when Origin is absent", () => {
			const c = createMockContext({
				Referer: "https://example.com/page?query=param#hash",
			});
			const result = resolveRequestOrigin(c);
			expect(result).toBe("https://example.com");
		});

		it("returns origin derived from valid Referer with port and path", () => {
			const c = createMockContext({
				Referer: "http://localhost:8080/nested/path",
			});
			const result = resolveRequestOrigin(c);
			expect(result).toBe("http://localhost:8080");
		});

		it("throws AppError with status 403 and CSRF message when Origin is absent and Referer is malformed", () => {
			const c = createMockContext({ Referer: "invalid-url-string" });
			expect(() => resolveRequestOrigin(c)).toThrow(AppError);

			try {
				resolveRequestOrigin(c);
				expect().unreachable("Expected resolveRequestOrigin to throw");
			} catch (error) {
				expect(error).toBeInstanceOf(AppError);
				const appError = error as AppError;
				expect(appError.status).toBe(403);
				expect(appError.message).toBe("CSRF validation failed.");
			}
		});

		it("throws AppError with status 403 when Referer is a relative path", () => {
			const c = createMockContext({ Referer: "/relative/path/only" });
			try {
				resolveRequestOrigin(c);
				expect().unreachable("Expected resolveRequestOrigin to throw");
			} catch (error) {
				expect(error).toBeInstanceOf(AppError);
				const appError = error as AppError;
				expect(appError.status).toBe(403);
				expect(appError.message).toBe("CSRF validation failed.");
			}
		});

		it("returns undefined when neither Origin nor Referer is present", () => {
			const c = createMockContext({});
			const result = resolveRequestOrigin(c);
			expect(result).toBeUndefined();
		});

		it("returns Origin even if Referer is malformed", () => {
			const c = createMockContext({
				Origin: "https://example.com",
				Referer: "not-a-valid-url",
			});
			const result = resolveRequestOrigin(c);
			expect(result).toBe("https://example.com");
		});

		it("returns Origin even if Referer is a relative path", () => {
			const c = createMockContext({
				Origin: "https://example.com",
				Referer: "/just/a/path",
			});
			const result = resolveRequestOrigin(c);
			expect(result).toBe("https://example.com");
		});

		it("prefers Origin over valid Referer when both are present", () => {
			const c = createMockContext({
				Origin: "https://origin.example.com",
				Referer: "https://referer.example.com/other",
			});
			const result = resolveRequestOrigin(c);
			expect(result).toBe("https://origin.example.com");
		});
	});

	describe("integration with Hono app.request", () => {
		it("successfully extracts origin when Origin header is sent", async () => {
			const app = createTestApp();
			const response = await app.request("/test-csrf", {
				method: "POST",
				headers: {
					Origin: "https://example.com",
				},
			});

			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body).toEqual({ origin: "https://example.com" });
		});

		it("successfully extracts origin derived from Referer when Origin is absent", async () => {
			const app = createTestApp();
			const response = await app.request("/test-csrf", {
				method: "POST",
				headers: {
					Referer: "https://example.com/some/deep/page?tab=overview#section",
				},
			});

			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body).toEqual({ origin: "https://example.com" });
		});

		it("returns null origin when neither Origin nor Referer is provided", async () => {
			const app = createTestApp();
			const response = await app.request("/test-csrf", {
				method: "POST",
			});

			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body).toEqual({ origin: null });
		});

		it("successfully extracts origin when Origin is present despite malformed Referer", async () => {
			const app = createTestApp();
			const response = await app.request("/test-csrf", {
				method: "POST",
				headers: {
					Origin: "https://example.com",
					Referer: "malformed-referer-url",
				},
			});

			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body).toEqual({ origin: "https://example.com" });
		});

		it("returns 403 error when Referer is malformed and Origin is absent", async () => {
			const app = createTestApp();
			const response = await app.request("/test-csrf", {
				method: "POST",
				headers: {
					Referer: "invalid-url",
				},
			});

			expect(response.status).toBe(403);
			const body = await response.json();
			expect(body).toEqual({ error: "CSRF validation failed." });
		});

		it("returns 403 error when Referer is a relative URL and Origin is absent", async () => {
			const app = createTestApp();
			const response = await app.request("/test-csrf", {
				method: "POST",
				headers: {
					Referer: "/relative/path/only",
				},
			});

			expect(response.status).toBe(403);
			const body = await response.json();
			expect(body).toEqual({ error: "CSRF validation failed." });
		});
	});
});
