import {
	expect,
	isExternalTarget,
	signInCustomer,
	test,
} from "./helpers/fixtures.ts";

const LOCAL_ORG_SLUG = "pafe-northwest";

test.describe("Phase 1 authenticated customer journeys", () => {
	test.skip(
		isExternalTarget(),
		"Authenticated customer specs require local E2E harness",
	);

	test("Zero unauthenticated flash during customer account navigation", async ({
		page,
	}) => {
		await page.addInitScript(() => {
			const w = window as unknown as {
				__e2eFlashCount?: number;
				__e2eFlashSamples?: string[];
			};
			w.__e2eFlashCount = 0;
			w.__e2eFlashSamples = [];

			const recordIfFlashed = () => {
				const bodyText = document.body?.textContent ?? "";
				const hasSignInPrompt = bodyText.includes(
					"Sign in using the header to view your account.",
				);
				const hasSignInButton = Boolean(
					document.querySelector('button[aria-label="Sign in"]'),
				);
				if (hasSignInPrompt || hasSignInButton) {
					w.__e2eFlashCount = (w.__e2eFlashCount ?? 0) + 1;
					w.__e2eFlashSamples?.push(
						`${window.location.pathname}:prompt=${hasSignInPrompt},button=${hasSignInButton}`,
					);
				}
			};

			const observer = new MutationObserver(() => {
				recordIfFlashed();
			});

			const start = () => {
				if (document.documentElement) {
					observer.observe(document.documentElement, {
						childList: true,
						subtree: true,
						characterData: true,
					});
					recordIfFlashed();
				}
			};

			if (document.readyState === "loading") {
				document.addEventListener("DOMContentLoaded", start, { once: true });
			} else {
				start();
			}
		});

		await signInCustomer(page, "teacher");

		await page.goto(`/org/${LOCAL_ORG_SLUG}/account/memberships`);
		await expect(
			page.locator('button[aria-label="Sign out"]'),
		).toBeVisible();

		await page.goto(`/org/${LOCAL_ORG_SLUG}/account/contact`);
		await expect(
			page.locator('button[aria-label="Sign out"]'),
		).toBeVisible();

		await page.goto(`/org/${LOCAL_ORG_SLUG}/account/memberships`);
		await expect(
			page.locator('button[aria-label="Sign out"]'),
		).toBeVisible();

		const flashReport = await page.evaluate(() => {
			const w = window as unknown as {
				__e2eFlashCount?: number;
				__e2eFlashSamples?: string[];
			};
			return {
				count: w.__e2eFlashCount ?? 0,
				samples: w.__e2eFlashSamples ?? [],
			};
		});

		expect(
			flashReport.count,
			`Unexpected unauthenticated flash samples: ${flashReport.samples.join("; ")}`,
		).toBe(0);
	});

	test("Current Memberships, Acquire Memberships, read-only Teacher division, and HelpTooltip", async ({
		page,
	}) => {
		await signInCustomer(page, "teacher");
		await page.goto(`/org/${LOCAL_ORG_SLUG}/account/memberships`);

		await expect(
			page.getByRole("heading", { level: 1, name: "Acquire Memberships" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { level: 1, name: "Current Memberships" }),
		).toBeVisible();

		const teachersButton = page.locator("button.teachers");
		await expect(teachersButton).toContainText("Annual Teacher");
		await expect(teachersButton).toBeDisabled();

		const accompanistsButton = page.locator("button.accompanists");
		await expect(accompanistsButton).toContainText("Annual Accompanist");
		await expect(accompanistsButton).toBeEnabled();

		await expect(
			page.locator("article.customer-membership-card").filter({
				hasText: /Teacher/i,
			}),
		).toBeVisible();

		const directoryCard = page.locator("section.teacher-directory-card");
		await expect(directoryCard).toBeVisible();
		await expect(directoryCard).toContainText("Public Teacher Directory");
		await expect(directoryCard).toContainText("Assigned division");
		await expect(directoryCard.locator(".directory-division-tag")).toContainText(
			"Piano",
		);
		await expect(directoryCard.locator("select")).toHaveCount(0);
		await expect(
			directoryCard.locator('fieldset input[type="checkbox"]'),
		).toHaveCount(0);

		const tooltipTrigger = directoryCard.getByRole("button", {
			name: "About Public Teacher Directory publishing",
		});
		await expect(tooltipTrigger).toBeVisible();
		const tooltipId = await tooltipTrigger.getAttribute("aria-describedby");
		expect(tooltipId).toBeTruthy();
		const tooltip = page.locator(`[role="tooltip"]#${tooltipId}`);
		await tooltipTrigger.click();
		if ((await tooltip.getAttribute("data-open")) !== "true") {
			await tooltipTrigger.click();
		}
		await expect(tooltip).toHaveAttribute("data-open", "true");

		await directoryCard
			.getByRole("button", { name: "Save directory profile" })
			.click();
		await expect(directoryCard).toContainText("Directory profile saved.");
	});

	test("POST form customer logout completes with zero 403 responses", async ({
		page,
	}) => {
		await signInCustomer(page, "logout");
		await page.goto(`/org/${LOCAL_ORG_SLUG}/account/memberships`);
		await expect(
			page.locator('button[aria-label="Sign out"]'),
		).toBeVisible();

		const forbiddenResponses: string[] = [];
		const logoutRequests: Array<{ method: string; url: string }> = [];

		page.on("response", (response) => {
			if (response.status() === 403) {
				forbiddenResponses.push(
					`403 ${response.request().method()} ${response.url()}`,
				);
			}
		});
		page.on("request", (request) => {
			if (request.url().includes(`/api/organizations/${LOCAL_ORG_SLUG}/customer/logout`)) {
				logoutRequests.push({
					method: request.method(),
					url: request.url(),
				});
			}
		});

		await page.locator('button[aria-label="Sign out"]').click();

		await expect
			.poll(async () => {
				const url = page.url();
				const signInVisible = await page
					.locator('button[aria-label="Sign in"]')
					.isVisible()
					.catch(() => false);
				return url.includes("logged_out=1") || signInVisible;
			})
			.toBe(true);

		expect(
			logoutRequests.some((req) => req.method === "POST"),
			`Expected POST logout request, observed: ${JSON.stringify(logoutRequests)}`,
		).toBe(true);
		expect(
			forbiddenResponses,
			`Unexpected 403 responses during logout:\n${forbiddenResponses.join("\n")}`,
		).toEqual([]);
	});
});
