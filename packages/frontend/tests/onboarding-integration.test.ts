import { afterEach, describe, expect, it } from "bun:test";
import {
	acceptInvite,
	createInvite,
	createOrganization,
	dismissWelcome,
	getInvite,
	getMemberships,
	getOrganization,
	getSession,
	getShopifySettings,
	saveShopifySettings,
} from "../src/lib/api.js";

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
		"src/pages/AdminFestivalsPage.tsx",
		"src/pages/AdminHomePage.tsx",
		"src/pages/AdminUsersPage.tsx",
		"src/pages/CreateOrganizationPage.tsx",
		"src/pages/HomePage.tsx",
		"src/pages/InviteLandingPage.tsx",
		"src/pages/OrganizationChooser.tsx",
		"src/pages/OrganizationRootPage.tsx",
	];
	const sources = await Promise.all(paths.map((path) => Bun.file(path).text()));
	return sources.join("\n");
}

describe("organization onboarding integration", () => {
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
		expect(source).toContain("getSession");
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

		await getSession("token-1");
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
		await dismissWelcome("token-7", "pafe");
		await getShopifySettings("token-8", "pafe");
		await saveShopifySettings("token-9", "pafe", {
			storeUrl: "example.myshopify.com",
			clientId: "client-id",
			clientSecret: "client-secret",
		});

		expect(
			fetchCalls.map((call) => call.init?.headers as Record<string, string>),
		).toEqual([
			expect.objectContaining({ Authorization: "Bearer token-1" }),
			expect.objectContaining({ Authorization: "Bearer token-2" }),
			expect.objectContaining({ Authorization: "Bearer token-3" }),
			expect.objectContaining({ Authorization: "Bearer token-4" }),
			expect.objectContaining({ Authorization: "Bearer token-5" }),
			expect.objectContaining({ Authorization: "Bearer token-6" }),
			expect.objectContaining({ Authorization: "Bearer token-7" }),
			expect.objectContaining({ Authorization: "Bearer token-8" }),
			expect.objectContaining({ Authorization: "Bearer token-9" }),
		]);
	});

	it("calls the expected Hono API paths for onboarding integration", async () => {
		mockFetch({ ok: true });

		await getSession("token");
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
		await getShopifySettings("token", "pafe");
		await saveShopifySettings("token", "pafe", {
			storeUrl: "example.myshopify.com",
			clientId: "client-id",
			clientSecret: "client-secret",
		});

		expect(fetchCalls.map((call) => call.url)).toEqual([
			"/api/session",
			"/api/memberships",
			"/api/organizations",
			"/api/invites",
			"/api/invites/invite-token",
			"/api/invites/invite-token/accept",
			"/api/organizations/pafe",
			"/api/organizations/pafe/admin/shopify",
			"/api/organizations/pafe/admin/shopify",
		]);
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
});
