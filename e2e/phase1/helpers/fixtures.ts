import { test as base, expect, type Page } from "@playwright/test";
import type {
	E2eCustomerRole,
	MintedCustomerSession,
} from "./seed-e2e.js";

export { expect };

export function isExternalTarget(): boolean {
	return Boolean(process.env.PLAYWRIGHT_BASE_URL?.trim());
}

export const test = base.extend({
	page: async ({ page }, use) => {
		const consoleErrors: string[] = [];
		const pageErrors: string[] = [];
		const serverErrors: string[] = [];
		const clientErrorResponses: string[] = [];

		page.on("console", (msg) => {
			if (msg.type() === "error") {
				consoleErrors.push(msg.text());
			}
		});
		page.on("pageerror", (error) => {
			pageErrors.push(error.stack ?? error.message);
		});
		page.on("response", (response) => {
			if (response.status() >= 500) {
				serverErrors.push(
					`${response.status()} ${response.request().method()} ${response.url()}`,
				);
			} else if (response.status() >= 400) {
				clientErrorResponses.push(
					`${response.status()} ${response.request().method()} ${response.url()}`,
				);
			}
		});

		await use(page);

		expect(
			consoleErrors,
			`Unexpected browser console errors:\n${consoleErrors.join("\n")}${clientErrorResponses.length > 0 ? `\n4xx responses:\n${clientErrorResponses.join("\n")}` : ""}`,
		).toEqual([]);
		expect(
			pageErrors,
			`Unexpected uncaught page errors:\n${pageErrors.join("\n")}`,
		).toEqual([]);
		expect(
			serverErrors,
			`Unexpected HTTP >= 500 responses:\n${serverErrors.join("\n")}`,
		).toEqual([]);
	},
});

export async function signInCustomer(
	page: Page,
	role: E2eCustomerRole,
): Promise<MintedCustomerSession> {
	const response = await page.request.post("/__e2e/session", {
		data: { role },
	});
	expect(
		response.ok(),
		`POST /__e2e/session failed with ${response.status()}`,
	).toBeTruthy();

	const minted = (await response.json()) as MintedCustomerSession;
	const targetOrigin = new URL(response.url()).origin;
	await page.context().addCookies([
		{
			name: minted.cookieName,
			value: minted.sessionId,
			url: targetOrigin,
			httpOnly: true,
			sameSite: "Lax",
		},
	]);
	return minted;
}

export async function signInAdmin(
	page: Page,
	email = "admin@pafe-northwest.example.org",
): Promise<void> {
	await page.goto("/");
	await page.evaluate((targetEmail) => {
		window.localStorage.setItem("festival.organizerLoginEmail", targetEmail);
	}, email);

	const loginCallbackUrl =
		"/?organizer-login=1&apiKey=e2e-api-key&oobCode=e2e-admin-oob&mode=signIn";
	await page.goto(loginCallbackUrl);

	await page.waitForFunction(() => {
		const params = new URLSearchParams(window.location.search);
		return (
			!params.has("oobCode") &&
			window.localStorage.getItem("festival.organizerLoginEmail") === null
		);
	});
}
