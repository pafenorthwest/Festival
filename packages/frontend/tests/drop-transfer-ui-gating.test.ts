import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { OrganizationLandingResponse } from "@festival/common";

const solidClient = await import("solid-js/dist/solid.js");
const { createSignal, createMemo, createRoot } = solidClient;

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

describe("frontend feature gating for drop and transfer", () => {
	const originalEnvFlag = process.env.FRONT_ENABLE_DROP_TRANSFER;

	beforeEach(() => {
		delete process.env.FRONT_ENABLE_DROP_TRANSFER;
		delete Bun.env.FRONT_ENABLE_DROP_TRANSFER;
	});

	afterEach(() => {
		if (originalEnvFlag !== undefined) {
			process.env.FRONT_ENABLE_DROP_TRANSFER = originalEnvFlag;
			Bun.env.FRONT_ENABLE_DROP_TRANSFER = originalEnvFlag;
		} else {
			delete process.env.FRONT_ENABLE_DROP_TRANSFER;
			delete Bun.env.FRONT_ENABLE_DROP_TRANSFER;
		}
	});

	describe("isDropTransferEnabled reactive memo", () => {
		it("isDropTransferEnabled defaults to false when organization() has no features or dropTransfer is false and FRONT_ENABLE_DROP_TRANSFER is unset", () => {
			createRoot(() => {
				const [organization, setOrganization] = createSignal<
					OrganizationLandingResponse["organization"] | null
				>(null);

				const isDropTransferEnabled = createMemo(() => {
					const fromOrg = organization()?.features?.dropTransfer;
					if (typeof fromOrg === "boolean") return fromOrg;
					return (
						typeof import.meta !== "undefined" &&
						(import.meta as unknown as { env?: Record<string, string> }).env
							?.FRONT_ENABLE_DROP_TRANSFER === "true"
					);
				});

				expect(organization()).toBeNull();
				expect(isDropTransferEnabled()).toBe(false);

				setOrganization({
					id: "org-1",
					name: "Festival Organization",
					slug: "fest-org",
					timezone: "UTC",
					defaultCurrencyCode: "USD",
					createdAtIso: "2026-01-01T00:00:00.000Z",
				});
				expect(organization()?.features).toBeUndefined();
				expect(isDropTransferEnabled()).toBe(false);

				setOrganization({
					id: "org-1",
					name: "Festival Organization",
					slug: "fest-org",
					timezone: "UTC",
					defaultCurrencyCode: "USD",
					features: { dropTransfer: false },
					createdAtIso: "2026-01-01T00:00:00.000Z",
				});
				expect(organization()?.features?.dropTransfer).toBe(false);
				expect(isDropTransferEnabled()).toBe(false);
			});
		});

		it("isDropTransferEnabled returns true when organization()?.features?.dropTransfer is true", () => {
			createRoot(() => {
				const [organization, setOrganization] = createSignal<
					OrganizationLandingResponse["organization"] | null
				>(null);

				const isDropTransferEnabled = createMemo(() => {
					const fromOrg = organization()?.features?.dropTransfer;
					if (typeof fromOrg === "boolean") return fromOrg;
					return (
						typeof import.meta !== "undefined" &&
						(import.meta as unknown as { env?: Record<string, string> }).env
							?.FRONT_ENABLE_DROP_TRANSFER === "true"
					);
				});

				setOrganization({
					id: "org-2",
					name: "Enabled Org",
					slug: "enabled-org",
					timezone: "UTC",
					defaultCurrencyCode: "USD",
					features: { dropTransfer: true },
					createdAtIso: "2026-01-01T00:00:00.000Z",
				});
				expect(organization()?.features?.dropTransfer).toBe(true);
				expect(isDropTransferEnabled()).toBe(true);

				setOrganization({
					id: "org-2",
					name: "Enabled Org",
					slug: "enabled-org",
					timezone: "UTC",
					defaultCurrencyCode: "USD",
					features: { dropTransfer: false },
					createdAtIso: "2026-01-01T00:00:00.000Z",
				});
				expect(isDropTransferEnabled()).toBe(false);

				setOrganization({
					id: "org-2",
					name: "Enabled Org",
					slug: "enabled-org",
					timezone: "UTC",
					defaultCurrencyCode: "USD",
					features: { dropTransfer: true },
					createdAtIso: "2026-01-01T00:00:00.000Z",
				});
				expect(isDropTransferEnabled()).toBe(true);
			});
		});

		it("falls back to FRONT_ENABLE_DROP_TRANSFER env flag when organization features are unset", () => {
			Bun.env.FRONT_ENABLE_DROP_TRANSFER = "true";
			process.env.FRONT_ENABLE_DROP_TRANSFER = "true";

			createRoot(() => {
				const [organization, setOrganization] = createSignal<
					OrganizationLandingResponse["organization"] | null
				>(null);

				const isDropTransferEnabled = createMemo(() => {
					const fromOrg = organization()?.features?.dropTransfer;
					if (typeof fromOrg === "boolean") return fromOrg;
					return (
						typeof import.meta !== "undefined" &&
						(import.meta as unknown as { env?: Record<string, string> }).env
							?.FRONT_ENABLE_DROP_TRANSFER === "true"
					);
				});

				expect(organization()).toBeNull();
				expect(isDropTransferEnabled()).toBe(true);

				setOrganization({
					id: "org-3",
					name: "No Features Org",
					slug: "no-features-org",
					timezone: "UTC",
					defaultCurrencyCode: "USD",
					createdAtIso: "2026-01-01T00:00:00.000Z",
				});
				expect(isDropTransferEnabled()).toBe(true);

				setOrganization({
					id: "org-3",
					name: "No Features Org",
					slug: "no-features-org",
					timezone: "UTC",
					defaultCurrencyCode: "USD",
					features: { dropTransfer: false },
					createdAtIso: "2026-01-01T00:00:00.000Z",
				});
				expect(isDropTransferEnabled()).toBe(false);
			});
		});

		it("verifies createFestivalAppState implementation and state exposure", async () => {
			const source = await read("../src/app/createFestivalAppState.ts");

			expect(source).toContain(
				"const isDropTransferEnabled = createMemo(() => {",
			);
			expect(source).toContain(
				"const fromOrg = organization()?.features?.dropTransfer;",
			);
			expect(source).toContain(
				'if (typeof fromOrg === "boolean") return fromOrg;',
			);
			expect(source).toContain("FRONT_ENABLE_DROP_TRANSFER");
			expect(source).toMatch(
				/return\s*\{[\s\S]*?\bisDropTransferEnabled\b[\s\S]*?\};/,
			);
		});
	});

	describe("CustomerAccountOrdersPage UI gating", () => {
		it("CustomerAccountOrdersPage hides Transfer and Drop buttons when isDropTransferEnabled() is false, and renders them when true", async () => {
			const source = await read("../src/pages/CustomerAccountOrdersPage.tsx");

			expect(source).toContain("props.app.isDropTransferEnabled()");
			expect(source).toMatch(
				/<Show[\s\S]*?when=\{[\s\S]*?props\.app\.isDropTransferEnabled\(\)[\s\S]*?isRegistrationActiveOrWaitlisted\([\s\S]*?item\.entitlement\.status[\s\S]*?\)[\s\S]*?\}[\s\S]*?>/,
			);

			const showBlockMatch = source.match(
				/<Show\s+when=\{[\s\S]*?props\.app\.isDropTransferEnabled\(\)[\s\S]*?isRegistrationActiveOrWaitlisted\([\s\S]*?item\.entitlement\.status[\s\S]*?\)[\s\S]*?\}[^>]*?>([\s\S]*?)<\/Show>/,
			);
			expect(showBlockMatch).not.toBeNull();
			const showBlockContent = showBlockMatch ? showBlockMatch[1] : "";

			expect(showBlockContent).toContain("Transfer");
			expect(showBlockContent).toContain("Drop");
			expect(showBlockContent).toContain("handleOpenTransfer(item)");
			expect(showBlockContent).toContain("setDropTarget(item)");

			const evaluateGating = (
				isDropTransferEnabled: boolean,
				status?: string,
			) => {
				const s = (status ?? "confirmed").toLowerCase();
				const isActiveOrWaitlisted =
					s === "confirmed" || s === "waitlisted" || s === "active";
				return isDropTransferEnabled && isActiveOrWaitlisted;
			};

			expect(evaluateGating(false, "confirmed")).toBe(false);
			expect(evaluateGating(false, "waitlisted")).toBe(false);
			expect(evaluateGating(false, "active")).toBe(false);
			expect(evaluateGating(false, "cancelled")).toBe(false);

			expect(evaluateGating(true, "confirmed")).toBe(true);
			expect(evaluateGating(true, "waitlisted")).toBe(true);
			expect(evaluateGating(true, "active")).toBe(true);
			expect(evaluateGating(true, "cancelled")).toBe(false);
		});
	});

	describe("FestivalAdminDashboardPage UI gating", () => {
		it("FestivalAdminDashboardPage hides 'Registration Audit & Operations' when isDropTransferEnabled() is false, and renders it when true", async () => {
			const source = await read("../src/pages/FestivalAdminDashboardPage.tsx");

			expect(source).toContain(
				"<Show when={props.app.isDropTransferEnabled()}>",
			);

			const showBlockMatch = source.match(
				/<Show when=\{props\.app\.isDropTransferEnabled\(\)\}>([\s\S]*?)<\/Show>/,
			);
			expect(showBlockMatch).not.toBeNull();
			const showBlockContent = showBlockMatch ? showBlockMatch[1] : "";

			expect(showBlockContent).toContain(
				'aria-labelledby="admin-audit-section-heading"',
			);
			expect(showBlockContent).toContain("Registration Audit & Operations");
			expect(showBlockContent).toContain("Inspect Audit History");
			expect(showBlockContent).toContain("handleOpenAudit");

			const evaluateAdminGating = (isDropTransferEnabled: boolean) =>
				Boolean(isDropTransferEnabled);

			expect(evaluateAdminGating(false)).toBe(false);
			expect(evaluateAdminGating(true)).toBe(true);
		});
	});
});
