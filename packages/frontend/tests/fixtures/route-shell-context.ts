import { mock } from "bun:test";
import assert from "node:assert/strict";
import { transformSync as babelTransform } from "@babel/core";
import solidPreset from "babel-preset-solid";
import { transformSync as esbuildTransform } from "esbuild";

const solid = await import("solid-js/dist/solid.js");
mock.module("solid-js", () => solid);
mock.module("solid-js/web", () => ({
	createComponent: solid.createComponent,
	memo: solid.createMemo,
}));

interface RouteNode {
	path: string | string[];
	component?: () => unknown;
	children?: unknown;
}

const capturedClicks: Array<{
	routePath: string;
	pageName: string;
	readAppOnClick: () => unknown;
}> = [];

let activeRoutePath = "";

function makePageStub(pageName: string) {
	return function StubPage(props: { app?: unknown }) {
		const routePath = activeRoutePath;
		capturedClicks.push({
			routePath,
			pageName,
			readAppOnClick: () => props.app,
		});
		return null;
	};
}

const passThroughProvider = (props: { children?: unknown }) => props.children;

mock.module("@solidjs/router", () => ({
	Route: (props: RouteNode): RouteNode => ({
		path: props.path,
		component: props.component,
		children: props.children,
	}),
	useParams: () => ({
		slug: "pafe",
		festivalSlug: "spring",
		token: "tok-123",
		classId: "solo-1",
	}),
}));

mock.module("../../src/domains/admin-org/AdminOrgContext.js", () => ({
	AdminOrgProvider: passThroughProvider,
}));
mock.module(
	"../../src/domains/registration/ClassRegistrationContext.js",
	() => ({
		ClassRegistrationProvider: passThroughProvider,
	}),
);
mock.module("../../src/domains/admin-commerce/AdminCommerceContext.js", () => ({
	AdminCommerceProvider: passThroughProvider,
	useAdminCommerce: () => ({ shopifyPrerequisiteMet: () => true }),
}));
mock.module("../../src/domains/catalog/CatalogRepertoireContext.js", () => ({
	CatalogRepertoireProvider: passThroughProvider,
}));
mock.module("../../src/domains/directory/TeacherDirectoryContext.js", () => ({
	TeacherDirectoryProvider: passThroughProvider,
}));
mock.module("../../src/domains/volunteers/VolunteersContext.js", () => ({
	VolunteersProvider: passThroughProvider,
}));
mock.module("../../src/pages/HomePage.js", () => ({
	HomePage: makePageStub("HomePage"),
}));
mock.module("../../src/pages/OrganizationChooser.js", () => ({
	OrganizationChooser: makePageStub("OrganizationChooser"),
}));

const pageNames = [
	"AccompanistMembershipPage",
	"AdminCheckoutRecoveryPage",
	"AdminConcertoRepertoirePage",
	"AdminDivisionsPage",
	"AdminFestivalsPage",
	"AdminHomePage",
	"AdminIntegrationsPage",
	"AdminMembershipProductsPage",
	"AdminRoomsPage",
	"AdminRosterPage",
	"AdminSettingsPage",
	"AdminUsersPage",
	"BillingReconciliationPage",
	"CommunicationTemplatesPage",
	"CreateOrganizationPage",
	"CustomerAccountAvailabilityPage",
	"CustomerAccountClassesPage",
	"CustomerAccountContactPage",
	"CustomerAccountMembershipsPage",
	"CustomerAccountOrdersPage",
	"CustomerCheckoutRecoveryPage",
	"CustomerChildrenPage",
	"FestivalAdminClassesPage",
	"FestivalAdminDashboardPage",
	"FestivalClassRegistrationPage",
	"FestivalLandingPage",
	"FestivalVolunteersPage",
	"InviteLandingPage",
	"LegacyCustomerAccountRedirect",
	"MembershipPage",
	"MusicReviewPage",
	"OrganizationRootPage",
	"PrivacyPolicyPage",
	"PublicDirectoryPage",
	"VolunteerRolesPage",
] as const;

const lazyPagesMock: Record<string, unknown> = {};
for (const name of pageNames) {
	lazyPagesMock[name] = makePageStub(name);
}
mock.module("../../src/app/lazyPages.js", () => lazyPagesMock);

// Compile route and context TSX with Solid's real JSX transform so inline
// props like `app={useFestivalShell()}` compile to lazy getters just as in Vite.
Bun.plugin({
	name: "solid-jsx-route-transform",
	setup(build) {
		build.onLoad(
			{ filter: /(AppRoutes|AdminRoutes|FestivalShellContext)\.tsx$/ },
			async ({ path }) => {
				const source = await Bun.file(path).text();
				const stripped = esbuildTransform(source, {
					loader: "tsx",
					jsx: "preserve",
				}).code;
				const compiled = babelTransform(stripped, {
					filename: path.replace(/\.tsx$/, ".jsx"),
					presets: [[solidPreset, { generate: "dom" }]],
				});
				if (!compiled?.code) {
					throw new Error(`Failed to compile ${path} with babel-preset-solid`);
				}
				return { loader: "js", contents: compiled.code };
			},
		);
	},
});

const { FestivalShellProvider } = await import(
	"../../src/app/FestivalShellContext.js"
);
const { AppRoutes } = await import("../../src/app/AppRoutes.js");

function collectRoutes(node: unknown, out: RouteNode[] = []): RouteNode[] {
	if (!node) return out;
	if (typeof node === "function") {
		return collectRoutes((node as () => unknown)(), out);
	}
	if (Array.isArray(node)) {
		for (const item of node) collectRoutes(item, out);
		return out;
	}
	if (typeof node === "object" && "path" in node) {
		const route = node as RouteNode;
		if (route.component) out.push(route);
		if (route.children) collectRoutes(route.children, out);
	}
	return out;
}

const mockApp = { id: "festival-shell-controller" } as unknown as Parameters<
	typeof FestivalShellProvider
>[0]["value"];

const dispose = solid.createRoot((cleanup) => {
	const routes = collectRoutes(AppRoutes());
	assert.ok(routes.length > 0, "Expected AppRoutes to define routes");
	for (const route of routes) {
		if (!route.component || route.children) continue;
		const routePath = Array.isArray(route.path)
			? route.path.join("|")
			: route.path;
		const Component = route.component;
		solid.createComponent(FestivalShellProvider, {
			value: mockApp,
			get children() {
				activeRoutePath = routePath;
				return solid.createComponent(Component, {});
			},
		});
	}
	return cleanup;
});

// Simulate browser DOM click events where SolidJS reactive Owner is null.
assert.equal(solid.getOwner(), null, "Expected null Owner during DOM event");
assert.ok(
	capturedClicks.length > 0,
	"Expected mounted routes to capture page props",
);

const requiredAppPages = new Set([
	"OrganizationRootPage",
	"CustomerCheckoutRecoveryPage",
	"FestivalLandingPage",
	"CreateOrganizationPage",
	"InviteLandingPage",
	"AdminUsersPage",
	"AdminDivisionsPage",
	"AdminSettingsPage",
	"AdminConcertoRepertoirePage",
	"AdminCheckoutRecoveryPage",
]);
const verifiedRequired = new Set<string>();

for (const entry of capturedClicks) {
	const resolvedApp = entry.readAppOnClick();
	if (requiredAppPages.has(entry.pageName)) {
		assert.equal(
			resolvedApp,
			mockApp,
			`Expected ${entry.pageName} (${entry.routePath}) to retain FestivalShell controller on DOM click`,
		);
		verifiedRequired.add(entry.pageName);
	} else if (resolvedApp !== undefined) {
		assert.equal(
			resolvedApp,
			mockApp,
			`Expected ${entry.pageName} (${entry.routePath}) to retain FestivalShell controller on DOM click`,
		);
	}
}
assert.equal(
	verifiedRequired.size,
	requiredAppPages.size,
	"Expected all 10 target routes to be mounted and verified",
);

dispose();
console.log("ROUTE_SHELL_CONTEXT_OK");
