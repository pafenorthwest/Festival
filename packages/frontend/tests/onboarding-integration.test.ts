import { afterEach, describe, expect, it } from "bun:test";
import type { FestivalAppState } from "../src/app/createFestivalAppState.js";
import { createFestivalDataLoaders } from "../src/app/createFestivalDataLoaders.js";
import {
	acceptInvite,
	createInvite,
	createMembershipProduct,
	createOrganization,
	dismissWelcome,
	getAdminMembershipProducts,
	getBootstrap,
	getFirebaseSession,
	getInvite,
	getMembershipProducts,
	getMemberships,
	getOrganization,
	getShopifySettings,
	saveShopifySettings,
} from "../src/lib/api.js";
import {
	buildShopifyAppUrl,
	missingRequiredShopifyScopes,
} from "../src/pages/AdminIntegrationsPage.js";

let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

function mockJsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
		},
	});
}

function mockFetch(body: unknown = {}) {
	fetchCalls = [];
	globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
		const requestUrl =
			typeof url === "string"
				? url
				: url instanceof URL
					? url.toString()
					: url.url;
		fetchCalls.push({ url: requestUrl, init });
		return Promise.resolve(mockJsonResponse(body));
	}) as typeof fetch;
}

afterEach(() => {
	fetchCalls = [];
});

async function readFrontendSource(): Promise<string> {
	const paths = [
		"src/App.tsx",
		"src/app/appFormatting.ts",
		"src/app/appTypes.ts",
		"src/app/createFestivalActions.ts",
		"src/app/createFestivalAppState.ts",
		"src/app/createFestivalDataLoaders.ts",
		"src/app/useFestivalAppController.ts",
		"src/app/useFestivalLifecycle.ts",
		"src/components/AccessDeniedPanel.tsx",
		"src/components/AppBanners.tsx",
		"src/components/AppHeader.tsx",
		"src/components/SignInModal.tsx",
		"src/lib/api.ts",
		"src/lib/sanitize-html.ts",
		"src/pages/AdminFestivalsPage.tsx",
		"src/pages/AdminHomePage.tsx",
		"src/pages/AdminIntegrationsPage.tsx",
		"src/pages/AdminMembershipProductsPage.tsx",
		"src/pages/AdminUsersPage.tsx",
		"src/pages/CreateOrganizationPage.tsx",
		"src/pages/HomePage.tsx",
		"src/pages/InviteLandingPage.tsx",
		"src/pages/MembershipPage.tsx",
		"src/pages/OrganizationChooser.tsx",
		"src/pages/OrganizationRootPage.tsx",
	];
	const sources = await Promise.all(paths.map((path) => Bun.file(path).text()));
	return sources.join("\n");
}

describe("organization onboarding integration", () => {
	it("shows the issue 81 Shopify setup instructions before the integration form", async () => {
		const pageSource = await Bun.file(
			"src/pages/AdminIntegrationsPage.tsx",
		).text();
		const setupIndex = pageSource.indexOf("Shopify app setup instructions");
		const integrationIndex = pageSource.indexOf("Shopify Integration");

		expect(setupIndex).toBeGreaterThanOrEqual(0);
		expect(integrationIndex).toBeGreaterThan(setupIndex);
		expect(pageSource).toContain(
			'<details class="panel flow-panel shopify-setup-card" open>',
		);
		expect(pageSource).toContain(
			"<summary>Shopify app setup instructions</summary>",
		);
		expect(pageSource).toContain("PAFE Test 2026-08");
		expect(pageSource).toContain("read_orders,read_products,write_products");
		expect(pageSource).toContain("Use legacy install flow");
		expect(pageSource).toContain("Embedded");
		expect(pageSource).toContain("Webhooks API version");
		expect(pageSource).toContain("2026-07");
		expect(pageSource).toContain("window.location.origin");
		expect(pageSource).toContain("route.slug");
		expect(pageSource).toContain("Production Shopify app URLs must use HTTPS.");
		expect(pageSource).not.toContain("localStorage");
		expect(pageSource).not.toContain("clipboard");
		expect(buildShopifyAppUrl("https://festival.passmore.xyz", "new")).toBe(
			"https://festival.passmore.xyz/org/new/admin",
		);
	});

	it("shows only safe Shopify identity and capability diagnostics", async () => {
		const source = await readFrontendSource();
		expect(source).toContain("Verified shop:");
		expect(source).toContain("Product reads:");
		expect(source).toContain("Product writes:");
		expect(source).toContain("Order reads:");
		expect(source).toContain("settings.capabilities.read_products");
		expect(source).toContain("settings.capabilities.write_products");
		expect(source).not.toContain("settings.grantedScopes");
		expect(source).not.toContain("accessToken");
	});

	it("warns when a verified Shopify integration is missing required scopes", async () => {
		const source = await readFrontendSource();
		const styles = await Bun.file("src/styles.css").text();

		expect(
			missingRequiredShopifyScopes({
				read_products: "granted",
				write_products: "missing",
				read_orders: "missing",
				write_orders: "disabled",
			}),
		).toEqual(["write_products", "read_orders"]);
		expect(
			missingRequiredShopifyScopes({
				read_products: "granted",
				write_products: "granted",
				read_orders: "granted",
				write_orders: "disabled",
			}),
		).toEqual([]);
		expect(source).toContain(
			"Shopify is verified, but required scopes are missing.",
		);
		expect(source).toContain('settings.verificationStatus === "ok"');
		expect(source).toContain("Missing scopes:");
		expect(source).toContain("then run Save &amp; Test again");
		expect(source).toContain('class="shopify-warning-banner" role="alert"');
		expect(styles).toContain(".shopify-warning-banner");
	});
	it("keeps issue 22 wired to router, Firebase auth helpers, and API helpers", async () => {
		const source = await readFrontendSource();

		expect(source).toContain("@solidjs/router");
		expect(source).toContain("lib/api.js");
		expect(source).toContain("lib/firebase-auth.js");
		expect(source).toContain("signInWithGoogle");
		expect(source).toContain("sendPasswordlessEmailLink");
		expect(source).toContain("completePasswordlessEmailLinkSignIn");
		expect(source).toContain("subscribeToAuthChanges");
		expect(source).toContain("logoutCurrentUser");
		expect(source).toContain("getBootstrap");
		expect(source).toContain("getFirebaseSession");
		expect(source).toContain("getMemberships");
		expect(source).toContain("createOrganization");
		expect(source).toContain("createInvite");
		expect(source).toContain("getInvite");
		expect(source).toContain("acceptInvite");
		expect(source).toContain("getOrganization");
	});

	it("uses the canonical organization route and an org chooser for multiple memberships", async () => {
		const source = await readFrontendSource();

		expect(source).toContain("buildOrgPath(membership.organizationSlug)");
		expect(source).toContain("Choose an organization");
		expect(source).toContain("memberships().length > 1");
		expect(source).toContain("organization-choice");
		expect(source).not.toContain("/o/");
	});

	it("keeps logout implemented as Firebase sign-out instead of a no-op", async () => {
		const source = await readFrontendSource();

		expect(source).toContain("await logoutCurrentUser()");
		expect(source).toContain("setSession({ authenticated: false })");
		expect(source).toContain("setMemberships([])");
		expect(source).toContain("resetOnboardingFlowState()");
		expect(source).toContain('navigate("/")');
		expect(source).not.toContain('button("Logout", () => undefined');
	});

	it("keeps passwordless email-link auth as the email sign-in path", async () => {
		const source = await readFrontendSource();
		const authSource = await Bun.file("src/lib/firebase-auth.ts").text();

		expect(source).toContain("sendPasswordlessEmailLink");
		expect(source).toContain("Email Link Auth");
		expect(source).toContain("Send email link");
		expect(source).toContain('setSignInStep("email")');
		expect(authSource).toContain("sendSignInLinkToEmail");
		expect(authSource).toContain("signInWithEmailLink");
	});

	it("keeps the sign-in method dialog narrow with stacked auth choices", async () => {
		const source = await readFrontendSource();
		const styles = await Bun.file("src/styles.css").text();

		expect(source).toContain("sign-in-card");
		expect(source).toContain("auth-method-stack");
		expect(source).toContain("Google Auth");
		expect(source).toContain("Email Link Auth");
		expect(styles).toContain("width: min(360px, 100%)");
		expect(styles).toContain(".auth-method-stack");
		expect(styles).toContain("grid-template-columns: 1fr");
	});

	it("sends bearer tokens through the existing API helpers", async () => {
		mockFetch({ ok: true });

		await getBootstrap();
		await getFirebaseSession("token-1");
		await getMemberships("token-2");
		await createOrganization("token-3", {
			name: "Festival Admins",
			shortName: "pafe",
		});
		await createInvite("token-4", {
			organizationSlug: "pafe",
			email: "reviewer@example.com",
			role: "Music Reviewer",
		});
		await acceptInvite("token-5", "invite-token", { name: "Pat Reviewer" });
		await getOrganization("token-6", "pafe");
		await getMembershipProducts("pafe");
		await createMembershipProduct("token-8", "pafe", {
			name: "Teacher Membership",
			description: "Annual membership",
			price: "75.00",
			membershipType: "teacher",
			entitlementPeriod: "1_year",
		});
		await dismissWelcome("token-7", "pafe");
		await getShopifySettings("token-9", "pafe");
		await saveShopifySettings("token-10", "pafe", {
			storeUrl: "example.myshopify.com",
			clientId: "client-id",
			clientSecret: "client-secret",
		});

		expect(
			fetchCalls.map((call) => call.init?.headers as Record<string, string>),
		).toEqual([
			expect.not.objectContaining({ Authorization: expect.any(String) }),
			expect.objectContaining({ Authorization: "Bearer token-1" }),
			expect.objectContaining({ Authorization: "Bearer token-2" }),
			expect.objectContaining({ Authorization: "Bearer token-3" }),
			expect.objectContaining({ Authorization: "Bearer token-4" }),
			expect.objectContaining({ Authorization: "Bearer token-5" }),
			expect.objectContaining({ Authorization: "Bearer token-6" }),
			expect.not.objectContaining({ Authorization: expect.any(String) }),
			expect.objectContaining({ Authorization: "Bearer token-8" }),
			expect.objectContaining({ Authorization: "Bearer token-7" }),
			expect.objectContaining({ Authorization: "Bearer token-9" }),
			expect.objectContaining({ Authorization: "Bearer token-10" }),
		]);
	});

	it("calls the expected Hono API paths for onboarding integration", async () => {
		mockFetch({ ok: true });

		await getBootstrap();
		await getFirebaseSession("token");
		await getMemberships("token");
		await createOrganization("token", {
			name: "Festival Admins",
			shortName: "pafe",
		});
		await createInvite("token", {
			organizationSlug: "pafe",
			email: "reviewer@example.com",
			role: "Music Reviewer",
		});
		await getInvite("invite-token");
		await acceptInvite("token", "invite-token", { name: "Pat Reviewer" });
		await getOrganization("token", "pafe");
		await getMembershipProducts("pafe");
		await getAdminMembershipProducts("token", "pafe");
		await createMembershipProduct("token", "pafe", {
			name: "Teacher Membership",
			price: "75.00",
			membershipType: "teacher",
			entitlementPeriod: "1_year",
		});
		await getShopifySettings("token", "pafe");
		await saveShopifySettings("token", "pafe", {
			storeUrl: "example.myshopify.com",
			clientId: "client-id",
			clientSecret: "client-secret",
		});

		expect(fetchCalls.map((call) => call.url)).toEqual([
			"/api/bootstrap",
			"/api/firebase-session",
			"/api/memberships",
			"/api/organizations",
			"/api/invites",
			"/api/invites/invite-token",
			"/api/invites/invite-token/accept",
			"/api/organizations/pafe",
			"/api/organizations/pafe/membership-products",
			"/api/organizations/pafe/admin/membership-products",
			"/api/organizations/pafe/admin/membership-products",
			"/api/organizations/pafe/admin/shopify",
			"/api/organizations/pafe/admin/shopify",
		]);
	});

	it("wires the public membership page through the backend API only", async () => {
		const source = await readFrontendSource();

		expect(source).toContain('route().kind === "org-membership"');
		expect(source).toContain("getMembershipProducts(slug)");
		expect(source).toContain(
			"Membership information is temporarily unavailable. Please try again",
		);
		expect(source).toContain(`/api/organizations/\${slug}/membership-products`);
		expect(source).not.toContain("myshopify.com/admin");
		expect(source).not.toContain("admin/api/2026-07");
		expect(source).toContain("DOMPurify.sanitize");
		expect(source).toContain("ALLOWED_TAGS");
		expect(source).toContain("ALLOWED_ATTR");
		expect(source).toContain("innerHTML={sanitizeShopifyDescriptionHtml(");
	});

	it("surfaces Shopify settings load failures on both admin pages", async () => {
		const lifecycleSource = await Bun.file(
			"src/app/useFestivalLifecycle.ts",
		).text();

		const settingsLoadFailureHandlers = lifecycleSource.match(
			/loadShopifySettings\(currentRoute\.slug\)\.catch/g,
		);
		expect(settingsLoadFailureHandlers).toHaveLength(2);
		expect(lifecycleSource).toContain(
			"state.setErrorMessage((error as Error).message)",
		);
	});

	it("requires the create organization flow to collect and submit a short name", async () => {
		const source = await readFrontendSource();

		expect(source).toContain("organizationShortName");
		expect(source).toContain("Short name");
		expect(source).toContain("ORGANIZATION_SHORT_NAME_PATTERN");
		expect(source).toContain("shortName:");
		expect(source).toContain("organizationShortName().trim().toLowerCase()");
	});

	it("keeps issue 63 onboarding validation and invite UX wired in the frontend", async () => {
		const source = await readFrontendSource();
		const styles = await Bun.file("src/styles.css").text();

		expect(source).toContain("ORGANIZATION_NAME_PATTERN");
		expect(source).toContain("ORGANIZATION_SHORT_NAME_PATTERN");
		expect(source).toContain("Organization name is required.");
		expect(source).toContain("Short name is required.");
		expect(source).toContain("hasOrganizationNameError()");
		expect(source).toContain("hasOrganizationShortNameError()");
		expect(source).toContain("readOnly={props.app.organizationCreated()}");
		expect(source).toContain("INVITE_CARD_SCROLL_DELAY_MS = 600");
		expect(source).toContain("scrollIntoView");
		expect(source).toContain("Send another invite");
		expect(source).toContain("That email has already been invited.");
		expect(source).toContain("entry.email.toLowerCase() === normalizedEmail");
		expect(source).toContain("class={`invite-feedback invite-feedback-");
		expect(styles).toContain("invite-feedback-success");
		expect(styles).toContain("invite-feedback-error");
		expect(source).not.toContain(
			"window.location.origin}/invite/{entry.token}",
		);
		expect(styles).toContain('input[aria-invalid="true"]');
		expect(styles).toContain("button:disabled");
		expect(styles).toContain("@keyframes invite-feedback-fade");
	});

	it("clears user-scoped onboarding drafts when the authenticated user changes", async () => {
		const source = await readFrontendSource();

		expect(source).toContain("function resetOnboardingFlowState()");
		expect(source).toContain("setCreatedOrganizationSlug(null)");
		expect(source).toContain("setCreatedInvites([])");
		expect(source).toContain('setOrganizationName("")');
		expect(source).toContain('setOrganizationShortName("")');
		expect(source).toContain('email: "",');
		expect(source).toContain("const previousUser = state.firebaseUser()");
		expect(source).toContain("previousUser?.uid !== user?.uid");
	});

	it("keeps admin headers compact with breadcrumbs and header-level back navigation", async () => {
		const source = await readFrontendSource();
		const styles = await Bun.file("src/styles.css").text();

		expect(source).toContain("Admin > Users");
		expect(source).toContain("Admin > Integrations");
		expect(source).toContain("Admin > Memberships");
		expect(source).toContain("Admin > Festivals");
		expect(source).toContain("Log out {props.app.adminUserLabel()}");
		expect(source).toContain("function shortUserLabel");
		expect(source).toContain("function backToAdmin()");
		expect(source).toContain("clearMessages()");
		expect(source).toContain("validateFestivalDates(draft)");
		expect(source).toContain('class="masthead-actions"');
		expect(source).toContain('class="secondary-button compact-header-button"');
		expect(styles).toContain(".compact-header-button");
		expect(styles).toContain("background: rgba(31, 122, 87, 0.08);");
	});

	it("wires issue 70 admin membership UI through existing admin access control", async () => {
		const source = await readFrontendSource();

		expect(source).toContain('route().kind === "org-admin-memberships"');
		expect(source).toContain("AdminMembershipProductsPage");
		expect(source).toContain("buildOrgAdminMembershipsPath");
		expect(source).toContain("admin/memberships");
		expect(source).toContain("Only Admin members can manage memberships.");
		expect(source).toContain("props.app.isAdminMember()");
		expect(source).toContain("getAdminMembershipProducts(token, slug)");
		expect(source).toContain("getIdToken(state.firebaseUser())");
		expect(source).toContain("createMembershipProduct(token");
		expect(source).toContain("admin/membership-products");
		expect(source).not.toContain("SHOPIFY_ADMIN_ACCESS_TOKEN");
		expect(source).not.toContain("admin/api/2026-07");
	});

	it("covers issue 70 admin membership create states in source", async () => {
		const source = await readFrontendSource();
		const pageSource = await Bun.file(
			"src/pages/AdminMembershipProductsPage.tsx",
		).text();

		expect(source).toContain("Verified Shopify integration is required");
		expect(source).toContain("shopifyPrerequisiteMet");
		expect(pageSource).toContain(
			'props.app.shopifySettings()?.verificationStatus === "ok"',
		);
		expect(pageSource).toContain(
			'props.app.shopifyPrerequisiteMet() ? "Ready" : "Not Ready"',
		);
		expect(pageSource).toContain("shopify-status-not-ready");
		expect(pageSource).toContain("<Show when={!shopifyIntegrationVerified()}>");
		expect(pageSource).toContain("!props.app.shopifyPrerequisiteMet() ||");
		expect(source).toContain("Membership product created.");
		expect(source).toContain("Plan: Standard");
		expect(source).toContain("isCreatingMembershipProduct()");
		expect(source).toContain('fallback="Create Membership"');
		expect(source).toContain("setCreateMembershipProductAttempted(true)");
		expect(source).toContain("membershipProductValidationMessage()");
		expect(source).toContain("setMembershipProductDraft((current) =>");
		expect(source).toContain("await loaders.loadMembershipProducts");
		expect(source).toContain('name: "",');
		expect(source).toContain('description: "",');
		expect(source).toContain('price: "",');
	});

	it("surfaces membership product load failures without retaining stale data", async () => {
		let products: unknown[] = [{ id: "stale-product" }];
		let loading = false;
		let loadError = "";
		const state = {
			firebaseUser() {
				return {
					getIdToken: () => Promise.resolve("firebase-token"),
				};
			},
			setIsLoadingMembershipProducts(value: boolean) {
				loading = value;
			},
			setMembershipProducts(value: unknown[]) {
				products = value;
			},
			setMembershipProductsLoadError(value: string) {
				loadError = value;
			},
		} as unknown as FestivalAppState;
		globalThis.fetch = (() =>
			Promise.resolve(
				mockJsonResponse({ error: "Shopify unavailable" }, 503),
			)) as typeof fetch;

		const loaders = createFestivalDataLoaders(state);
		await loaders.loadMembershipProducts("pafe");

		expect(products).toEqual([]);
		expect(loading).toBe(false);
		expect(loadError).toBe(
			"Membership products are temporarily unavailable. Please try again.",
		);
	});
});
