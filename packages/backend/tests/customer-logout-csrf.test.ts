import { describe, expect, it } from "bun:test";
import { createApp } from "../src/app.js";
import type { CustomerAccountService } from "../src/customer/customer-account-service.js";
import { AppError } from "../src/errors/app-error.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";

const PUBLIC_ORIGIN = "https://festival.example.com";
const LOGOUT_PATH = "/api/organizations/festival/customer/logout";

async function createLogoutFixture() {
	const repository = new InMemoryOrganizationRepository();
	await repository.createOrganization({ name: "Festival", slug: "festival" });
	const calls: Array<{
		slug: string;
		sessionId: string | undefined;
		csrf: string | undefined;
		origin: string | undefined;
	}> = [];
	const customerAccountService = {
		logout: async (
			...[slug, sessionId, csrf, origin]: Parameters<
				CustomerAccountService["logout"]
			>
		) => {
			calls.push({ slug, sessionId, csrf, origin });
			if (!csrf || csrf !== "csrf" || origin !== PUBLIC_ORIGIN) {
				throw new AppError("CSRF validation failed.", 403);
			}
			return "https://accounts.shopify.com/logout";
		},
	} as unknown as CustomerAccountService;
	const { app } = await createApp({
		env: { port: 3000 },
		repository,
		authVerifier: {
			verify: async () => {
				throw new Error("unexpected bearer verification");
			},
		},
		customerAccountService,
	});
	return { app, calls };
}

describe("customer POST logout CSRF enforcement", () => {
	it("performs logout when same-origin Origin header matches publicOrigin", async () => {
		const { app, calls } = await createLogoutFixture();
		const response = await app.request(LOGOUT_PATH, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Cookie: "festival_customer_session=opaque-session",
				Origin: PUBLIC_ORIGIN,
			},
			body: "csrfToken=csrf",
		});
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			"https://accounts.shopify.com/logout",
		);
		expect(response.headers.get("set-cookie")).toContain(
			"festival_customer_session=",
		);
		expect(calls).toEqual([
			{
				slug: "festival",
				sessionId: "opaque-session",
				csrf: "csrf",
				origin: PUBLIC_ORIGIN,
			},
		]);
	});

	it("performs logout when Origin is omitted and same-origin Referer matches publicOrigin", async () => {
		const { app, calls } = await createLogoutFixture();
		const response = await app.request(LOGOUT_PATH, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Cookie: "festival_customer_session=opaque-session",
				Referer: "https://festival.example.com/org/festival/account",
			},
			body: "csrfToken=csrf",
		});
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			"https://accounts.shopify.com/logout",
		);
		expect(response.headers.get("set-cookie")).toContain(
			"festival_customer_session=",
		);
		expect(calls).toEqual([
			{
				slug: "festival",
				sessionId: "opaque-session",
				csrf: "csrf",
				origin: PUBLIC_ORIGIN,
			},
		]);
	});

	it("rejects logout with 403 when literal Origin 'null' is sent", async () => {
		const { app, calls } = await createLogoutFixture();
		const response = await app.request(LOGOUT_PATH, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Cookie: "festival_customer_session=opaque-session",
				Origin: "null",
				Referer: "https://festival.example.com/org/festival/account",
				Host: "festival.example.com",
			},
			body: "csrfToken=csrf",
		});
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: "CSRF validation failed.",
		});
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(calls).toHaveLength(0);
	});

	it("rejects logout with 403 when Origin and Referer are omitted despite forged Host and X-Forwarded-* headers", async () => {
		const { app, calls } = await createLogoutFixture();
		const response = await app.request(LOGOUT_PATH, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Cookie: "festival_customer_session=opaque-session",
				"X-Forwarded-Host": "festival.example.com",
				"X-Forwarded-Proto": "https",
				Host: "festival.example.com",
			},
			body: "csrfToken=csrf",
		});
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: "CSRF validation failed.",
		});
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(calls).toEqual([
			{
				slug: "festival",
				sessionId: "opaque-session",
				csrf: "csrf",
				origin: undefined,
			},
		]);
	});
});
