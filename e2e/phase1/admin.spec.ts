import { readFile } from "node:fs/promises";
import {
	expect,
	isExternalTarget,
	signInAdmin,
	test,
} from "./helpers/fixtures.ts";

const LOCAL_ORG_SLUG = "pafe-northwest";

test.describe("Phase 1 admin journeys", () => {
	test.skip(
		isExternalTarget(),
		"Authenticated admin specs require local E2E harness",
	);

	test.beforeEach(async ({ page }) => {
		await signInAdmin(page);
	});

	test("Memberships admin cards, summary badges, 6-column table, moderation switch, and teacher division edit", async ({
		page,
	}) => {
		await page.goto(`/org/${LOCAL_ORG_SLUG}/admin/memberships`);

		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Admin > Memberships",
		);
		await expect(
			page.locator("article.admin-membership-item.admin-membership-card").first(),
		).toBeVisible();

		const summaryList = page.locator("ul.entitlement-summary-counts");
		await expect(summaryList).toBeVisible();
		await expect(
			summaryList.locator("li.entitlement-summary-card").first(),
		).toBeVisible();
		const summaryLayout = await summaryList.evaluate((el) => {
			const style = window.getComputedStyle(el);
			return { display: style.display, flexWrap: style.flexWrap };
		});
		expect(summaryLayout).toEqual({ display: "flex", flexWrap: "wrap" });

		await expect(page.getByRole("columnheader")).toHaveText([
			"Customer",
			"Membership",
			"Divisions",
			"Status",
			"Edit",
			"Actions",
		]);

		await expect(
			page.getByRole("heading", { level: 2, name: "Shopify Order Reconciliation" }),
		).toHaveCount(0);

		const claraRow = page
			.getByRole("row")
			.filter({ hasText: "Dr. Clara Schumann" })
			.first();
		await expect(claraRow).toBeVisible();
		await claraRow.getByRole("button", { name: /Edit/i }).click();

		const dirSwitch = claraRow.locator(
			'button.entitlement-report-directory-switch[role="switch"]',
		);
		await expect(dirSwitch).toBeVisible();
		await dirSwitch.click();
		await expect(page.locator("body")).toContainText(
			"Profile hidden from the public directory.",
		);
		await dirSwitch.click();
		await expect(page.locator("body")).toContainText(
			"Profile shown in the public directory.",
		);

		const divisionSelect = claraRow.locator(
			"select.entitlement-report-division-select",
		);
		await expect(divisionSelect).toBeVisible();
		expect(await divisionSelect.getAttribute("multiple")).toBeNull();

		await divisionSelect.selectOption({ label: "Strings" });
		await expect(page.locator("body")).toContainText("Teacher division saved.");

		await divisionSelect.selectOption({ label: "Piano" });
		await expect(page.locator("body")).toContainText("Teacher division saved.");
	});

	test("Concerto repertoire CSV export and dry-run diff preview", async ({
		page,
	}) => {
		await page.goto(`/org/${LOCAL_ORG_SLUG}/admin/concerto-repertoire`);

		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Admin > Concerto Repertoire",
		);

		const downloadPromise = page.waitForEvent("download");
		await page
			.getByRole("button", { name: "Export Current Concerto CSV" })
			.click();
		const download = await downloadPromise;
		const downloadPath = await download.path();
		expect(downloadPath).toBeTruthy();
		const exportedCsv = await readFile(downloadPath ?? "", "utf8");

		expect(exportedCsv).toContain("work_id,title,composer,imslp_url");
		expect(exportedCsv).toContain("Piano Concerto No. 21");

		const replacementCsv = [
			exportedCsv.trimEnd(),
			',"Violin Concerto in D major, Op. 77",Johannes Brahms,"https://imslp.org/wiki/Violin_Concerto,_Op.77_(Brahms,_Johannes)"',
		].join("\n");

		await page.locator("textarea.concerto-csv-textarea").fill(replacementCsv);
		await page.getByRole("button", { name: "Preview Replacement" }).click();

		await expect(
			page.getByRole("heading", { level: 3, name: "2. Dry-Run Diff Preview" }),
		).toBeVisible();

		const errorsValue = page
			.locator(".metric-card")
			.filter({ hasText: "Errors" })
			.locator(".metric-value");
		await expect(errorsValue).toHaveText("0");

		const addedValue = page
			.locator(".metric-card")
			.filter({ hasText: "Added" })
			.locator(".metric-value");
		const addedCount = Number((await addedValue.textContent())?.trim() ?? "0");
		expect(addedCount).toBeGreaterThanOrEqual(1);
	});

	test("Direct admin subroute navigation renders expected breadcrumbs and primary panels", async ({
		page,
	}) => {
		const routes = [
			{
				path: `/org/${LOCAL_ORG_SLUG}/admin/settings`,
				breadcrumb: "Admin > Settings",
				headings: ["Organization timezone"],
			},
			{
				path: `/org/${LOCAL_ORG_SLUG}/admin/roster`,
				breadcrumb: "Admin > Staff Roster",
				headings: ["Staff roster"],
			},
			{
				path: `/org/${LOCAL_ORG_SLUG}/admin/rooms`,
				breadcrumb: "Admin > Rooms",
				headings: ["Rooms"],
			},
			{
				path: `/org/${LOCAL_ORG_SLUG}/admin/volunteers`,
				breadcrumb: "Admin > Volunteers",
				headings: ["Volunteer Roles"],
			},
			{
				path: `/org/${LOCAL_ORG_SLUG}/admin/integrations`,
				breadcrumb: "Admin > Integrations",
				headings: [
					"Shopify Integration",
					"Shopify Order Reconciliation",
					"Unresolved Validation Decisions",
				],
			},
		];

		for (const route of routes) {
			await page.goto(route.path);
			await expect(page.getByRole("heading", { level: 1 })).toHaveText(
				route.breadcrumb,
			);
			for (const heading of route.headings) {
				await expect(
					page.getByRole("heading", { name: heading, exact: true }),
				).toBeVisible();
			}
		}
	});
});
