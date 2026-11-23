import { expect, isExternalTarget, signInCustomer, test } from "./helpers/fixtures.ts";

const LOCAL_ORG_SLUG = "pafe-northwest";

async function resolveTargetOrgSlug(
	page: import("@playwright/test").Page,
): Promise<string> {
	if (!isExternalTarget()) {
		return LOCAL_ORG_SLUG;
	}
	await page.goto("/");
	const firstTile = page.locator("a.home-organization-tile").first();
	await expect(firstTile).toBeVisible();
	const href = await firstTile.getAttribute("href");
	const match = href?.match(/^\/org\/([^/?#]+)/);
	expect(match?.[1], `Unexpected org tile href: ${href ?? "(null)"}`).toBeTruthy();
	return match?.[1] ?? LOCAL_ORG_SLUG;
}

async function openAndAssertTooltip(
	page: import("@playwright/test").Page,
	triggerLabel: string,
): Promise<void> {
	const trigger = page.getByRole("button", { name: triggerLabel });
	await expect(trigger).toBeVisible();
	const tooltipId = await trigger.getAttribute("aria-describedby");
	expect(tooltipId).toBeTruthy();
	const tooltip = page.locator(`[role="tooltip"]#${tooltipId}`);

	await trigger.click();
	const isOpenAfterFirstClick = await tooltip.getAttribute("data-open");
	if (isOpenAfterFirstClick !== "true") {
		await trigger.click();
	}
	await expect(tooltip).toHaveAttribute("data-open", "true");
}

test.describe("Phase 1 public journeys", () => {
	test("HomePage organizations, SignInModal, and Privacy Policy", async ({
		page,
	}) => {
		await page.goto("/");

		await expect(page.locator("h2#home-organizations")).toHaveText(
			"Organizations",
		);
		const orgTiles = page.locator("a.home-organization-tile");
		await expect(orgTiles.first()).toBeVisible();
		if (!isExternalTarget()) {
			const pafeTile = page.locator(
				`a.home-organization-tile[href="/org/${LOCAL_ORG_SLUG}"]`,
			);
			await expect(pafeTile).toBeVisible();
			await expect(pafeTile).toContainText("PAFE Northwest");
		}

		await page.getByRole("button", { name: "Log-In" }).click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText("Log in to your account");
		await expect(dialog.getByRole("button", { name: /Google Auth/i })).toBeVisible();
		await expect(
			dialog.getByRole("button", { name: /Email Link Auth/i }),
		).toBeVisible();
		await dialog.getByRole("button", { name: "Cancel" }).click();
		await expect(dialog).toBeHidden();

		await expect(page.locator("p.site-footer-disclaimer")).toBeVisible();
		await page.locator('a[href="/privacy-policy"]').click();

		await expect(page).toHaveURL(/\/privacy-policy$/);
		await expect(
			page.getByRole("heading", { level: 1, name: "Privacy Policy" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Shopify data sharing" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", {
				name: "Public teacher and accompanist directory",
			}),
		).toBeVisible();
	});

	test("Org landing page SVG festival banner and audience links", async ({
		page,
	}) => {
		const slug = await resolveTargetOrgSlug(page);
		await page.goto(`/org/${slug}`);

		const banner = page.locator("a.org-festival-banner[data-season]").first();
		await expect(banner).toBeVisible();

		const bgImage = await banner.evaluate(
			(el) => window.getComputedStyle(el).backgroundImage,
		);
		expect(bgImage).toMatch(/\/seasons\/[^")]+\.svg/i);

		const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/i);
		expect(urlMatch?.[1], `Could not extract SVG URL from ${bgImage}`).toBeTruthy();
		const svgResponse = await page.request.get(urlMatch?.[1] ?? "");
		expect(svgResponse.status()).toBe(200);
		expect(await svgResponse.text()).toContain("<svg");

		await banner.click();
		for (const audience of [
			"Teachers",
			"Parents",
			"Volunteers",
			"Accompanists",
		]) {
			await expect(
				page.getByRole("link", { name: new RegExp(audience, "i") }).first(),
			).toBeVisible();
		}
	});

	test("Public teacher and accompanist directory renders and filters", async ({
		page,
	}) => {
		const slug = await resolveTargetOrgSlug(page);
		await page.goto(`/org/${slug}/directory`);

		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Public Directory",
		);
		await expect(
			page.getByRole("heading", { level: 2, name: "Teachers" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { level: 2, name: "Accompanists" }),
		).toBeVisible();

		if (!isExternalTarget()) {
			const teachersSection = page.locator("section.directory-section").filter({
				has: page.getByRole("heading", { level: 2, name: "Teachers" }),
			});
			const accompanistsSection = page
				.locator("section.directory-section")
				.filter({
					has: page.getByRole("heading", { level: 2, name: "Accompanists" }),
				});

			await expect(teachersSection).toContainText("Dr. Clara Schumann");
			await expect(teachersSection).toContainText("Piano");
			await expect(accompanistsSection).toContainText("Gerald Moore");
			await expect(accompanistsSection).toContainText("Piano");

			const filters = page.locator("section.directory-filters");
			await filters.locator('input[type="search"]').fill("Clara");
			await filters.locator("select").selectOption({ label: "Piano" });

			await expect(teachersSection).toContainText("Dr. Clara Schumann");
			await expect(accompanistsSection).not.toContainText("Gerald Moore");

			await filters.getByRole("button", { name: "Clear filters" }).click();
			await expect(accompanistsSection).toContainText("Gerald Moore");
		}
	});

	test("$0 accompanist signup form, tooltips, and activation", async ({
		page,
	}) => {
		const slug = await resolveTargetOrgSlug(page);
		if (isExternalTarget()) {
			await page.goto(`/org/${slug}/accompanist-membership`);
			await expect(
				page.getByRole("heading", { name: "Sign in to continue" }),
			).toBeVisible();
			return;
		}

		await signInCustomer(page, "accompanist-prospect");
		await page.goto(`/org/${LOCAL_ORG_SLUG}/accompanist-membership`);

		await expect(
			page.getByRole("heading", { level: 2, name: "Accompanist Membership" }),
		).toBeVisible();
		await expect(page.locator('[name="staffAccessConsent"]')).toHaveCount(0);
		await expect(page.locator("#staffAccessConsent")).toHaveCount(0);

		await openAndAssertTooltip(page, "About accompanist divisions");
		await openAndAssertTooltip(page, "About Public Directory publishing");

		const pianoCheckbox = page
			.locator("fieldset label.membership-consent")
			.filter({ hasText: "Piano" })
			.locator('input[type="checkbox"]');
		await expect(pianoCheckbox).toBeVisible();
		await pianoCheckbox.check();

		await page.getByRole("button", { name: "Activate membership" }).click();

		await expect(page).toHaveURL(
			new RegExp(`/org/${LOCAL_ORG_SLUG}/account/memberships$`),
		);
		await expect(
			page.locator("article.customer-membership-card").filter({
				hasText: /Accompanist/i,
			}),
		).toBeVisible();
	});
});
