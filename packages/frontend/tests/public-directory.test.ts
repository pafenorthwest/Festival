import { afterEach, describe, expect, it } from "bun:test";
import type { PublicDirectoryProfileDto } from "@festival/common";
import { getPublicDirectoryProfiles } from "../src/lib/api.js";
import {
	buildOrgPublicDirectoryPath,
	isOrganizationPageRoute,
	parseRoute,
} from "../src/lib/routes.js";
import {
	partitionDirectoryProfiles,
	readReadyProfiles,
	sortProfilesByName,
} from "../src/pages/publicDirectoryHelpers.js";

type DirectoryResource = Parameters<typeof readReadyProfiles>[0];

function createErroredResource(error: Error): DirectoryResource {
	// Mimics Solid 1.9 createResource: reading an errored resource throws.
	const read = (): never => {
		throw error;
	};
	return Object.assign(read, {
		state: "errored" as const,
		loading: false as const,
		error,
		latest: undefined as never,
	});
}

function createReadyResource(
	value: PublicDirectoryProfileDto[],
): DirectoryResource {
	return Object.assign(() => value, {
		state: "ready" as const,
		loading: false as const,
		error: undefined,
		latest: value,
	});
}

function profile(
	displayName: string,
	role: PublicDirectoryProfileDto["role"],
): PublicDirectoryProfileDto {
	return { displayName, role, approvedDivisions: [], isActiveMember: true };
}

const appSource = await Bun.file(
	new URL("../src/App.tsx", import.meta.url),
).text();

const sideNavigationSource = await Bun.file(
	new URL("../src/components/OrganizationSideNavigation.tsx", import.meta.url),
).text();

const publicDirectoryPageSource = await Bun.file(
	new URL("../src/pages/PublicDirectoryPage.tsx", import.meta.url),
).text();

const stylesSource = await Bun.file(
	new URL("../src/styles.css", import.meta.url),
).text();

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("public directory routing, navigation, and API", () => {
	it("parses and builds public directory routes", () => {
		expect(buildOrgPublicDirectoryPath("pafe")).toBe("/org/pafe/directory");
		expect(parseRoute("/org/pafe/directory")).toEqual({
			kind: "org-public-directory",
			slug: "pafe",
		});
		expect(parseRoute("/org/pafe/directory/")).toEqual({
			kind: "org-public-directory",
			slug: "pafe",
		});
		expect(
			isOrganizationPageRoute({
				kind: "org-public-directory",
				slug: "pafe",
			}),
		).toBe(true);
	});

	it("wires Directory link into OrganizationSideNavigation with active state and icon", () => {
		expect(sideNavigationSource).toContain("buildOrgPublicDirectoryPath");
		expect(sideNavigationSource).toContain('aria-label="Directory"');
		expect(sideNavigationSource).toContain("org-public-directory");
		expect(sideNavigationSource).toContain("groups");
	});

	it("wires public directory route and page component in App.tsx", () => {
		expect(appSource).toMatch(
			/PublicDirectoryPage[\s\S]*?from\s*["']\.\/(?:pages\/PublicDirectoryPage|app\/lazyPages)(?:\.js)?["']/,
		);
		expect(appSource).toContain('app.route().kind === "org-public-directory"');
		expect(appSource).toContain("<PublicDirectoryPage");
		expect(appSource).toContain(
			"slug={(app.route() as { slug: string }).slug}",
		);
	});

	it("fetches public directory profiles from GET /api/org-info/:orgSlug/directory/profiles", async () => {
		let requestedUrl = "";
		let requestedInit: RequestInit | undefined;
		const payload: PublicDirectoryProfileDto[] = [
			{
				displayName: "Jane Doe",
				role: "Teacher",
				approvedDivisions: [{ id: "div-1", name: "Piano" }],
				isActiveMember: true,
			},
		];

		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			requestedUrl = typeof input === "string" ? input : input.toString();
			requestedInit = init;
			return new Response(JSON.stringify(payload), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as typeof fetch;

		const profiles = await getPublicDirectoryProfiles("pafe");
		expect(requestedUrl).toBe("/api/org-info/pafe/directory/profiles");
		expect(requestedInit?.method).toBeUndefined();
		expect(profiles).toEqual(payload);
	});
});

describe("public directory CSS styling presence in styles.css", () => {
	it("includes all required public directory styling classes", () => {
		expect(stylesSource).toContain(".public-directory-page");
		expect(stylesSource).toContain(".directory-profile-card");
		expect(stylesSource).toContain(".directory-division-tag");
		expect(stylesSource).toContain(".directory-profile-color-indicator");
		expect(stylesSource).toContain(".directory-status-tag");
		expect(stylesSource).toContain(".directory-grid");
		expect(stylesSource).toContain(".directory-section");
		expect(stylesSource).toContain(".directory-loading");
		expect(stylesSource).toContain(".directory-error");
	});
});

describe("PublicDirectoryPage component exports and architectural contracts", () => {
	it("exports PublicDirectoryPage and DirectoryProfileCard components", () => {
		expect(publicDirectoryPageSource).toMatch(
			/export\s+function\s+PublicDirectoryPage\b/,
		);
		expect(publicDirectoryPageSource).toMatch(
			/export\s+function\s+DirectoryProfileCard\b/,
		);
	});

	it("satisfies all architectural imports and reactive primitives", () => {
		expect(publicDirectoryPageSource).toMatch(/from\s+["']solid-js["']/);
		expect(publicDirectoryPageSource).toContain("createResource");
		expect(publicDirectoryPageSource).toContain("createMemo");
		expect(publicDirectoryPageSource).toContain("For");
		expect(publicDirectoryPageSource).toContain("Show");
		expect(publicDirectoryPageSource).toMatch(
			/from\s+["']@festival\/common["']/,
		);
		expect(publicDirectoryPageSource).toContain("PublicDirectoryProfileDto");
		expect(publicDirectoryPageSource).toContain("createResource(");
		expect(publicDirectoryPageSource).toContain("getPublicDirectoryProfiles");
	});
});

describe("alphabetical case-insensitive sorting contract", () => {
	it("sorts profiles alphabetically case-insensitive with mixed case", () => {
		const sampleProfiles: PublicDirectoryProfileDto[] = [
			{
				displayName: "charlie",
				role: "Teacher",
				approvedDivisions: [],
				isActiveMember: true,
			},
			{
				displayName: "Alice",
				role: "Teacher",
				approvedDivisions: [],
				isActiveMember: true,
			},
			{
				displayName: "bob",
				role: "Teacher",
				approvedDivisions: [],
				isActiveMember: true,
			},
		];

		const sorted = sortProfilesByName(sampleProfiles);
		expect(sorted.map((p) => p.displayName)).toEqual([
			"Alice",
			"bob",
			"charlie",
		]);
	});

	it("sorts accented names deterministically in alphabetical order", () => {
		const accentedProfiles: PublicDirectoryProfileDto[] = [
			{
				displayName: "Zoë",
				role: "Teacher",
				approvedDivisions: [],
				isActiveMember: true,
			},
			{
				displayName: "André",
				role: "Teacher",
				approvedDivisions: [],
				isActiveMember: true,
			},
			{
				displayName: "Alice",
				role: "Teacher",
				approvedDivisions: [],
				isActiveMember: true,
			},
			{
				displayName: "éllie",
				role: "Teacher",
				approvedDivisions: [],
				isActiveMember: true,
			},
		];

		const sorted = sortProfilesByName(accentedProfiles);
		expect(sorted.map((p) => p.displayName)).toEqual([
			"Alice",
			"André",
			"éllie",
			"Zoë",
		]);
	});

	it("handles duplicate names and ties deterministically without dropping entries", () => {
		const duplicateProfiles: PublicDirectoryProfileDto[] = [
			{
				displayName: "Jane Doe",
				role: "Teacher",
				approvedDivisions: [],
				isActiveMember: true,
			},
			{
				displayName: "Jane Doe",
				role: "Teacher",
				approvedDivisions: [],
				isActiveMember: false,
			},
		];

		const sorted = sortProfilesByName(duplicateProfiles);
		expect(sorted).toHaveLength(2);
		expect(sorted.map((p) => p.displayName)).toEqual(["Jane Doe", "Jane Doe"]);
	});

	it("preserves immutability and handles empty/single-element lists", () => {
		const emptyList: PublicDirectoryProfileDto[] = [];
		const sortedEmpty = sortProfilesByName(emptyList);
		expect(sortedEmpty).toEqual([]);
		expect(sortedEmpty).not.toBe(emptyList);

		const single: PublicDirectoryProfileDto[] = [
			{
				displayName: "Solo",
				role: "Teacher",
				approvedDivisions: [],
				isActiveMember: true,
			},
		];
		const sortedSingle = sortProfilesByName(single);
		expect(sortedSingle.map((p) => p.displayName)).toEqual(["Solo"]);
		expect(sortedSingle).not.toBe(single);
	});
});

describe("section ordering and role filtering (Teachers first, Accompanists second)", () => {
	it("renders Teachers section before Accompanists section in source structure", () => {
		const teachersIndex = publicDirectoryPageSource.indexOf('title="Teachers"');
		const accompanistsIndex = publicDirectoryPageSource.indexOf(
			'title="Accompanists"',
		);

		expect(teachersIndex).toBeGreaterThan(-1);
		expect(accompanistsIndex).toBeGreaterThan(-1);
		expect(teachersIndex).toBeLessThan(accompanistsIndex);

		expect(publicDirectoryPageSource).toContain('roleClass="teachers-section"');
		expect(publicDirectoryPageSource).toContain(
			'roleClass="accompanists-section"',
		);
	});

	it("partitions profiles by role and sorts each list", () => {
		const mixedProfiles: PublicDirectoryProfileDto[] = [
			profile("Zach Accompanist", "Accompanist"),
			profile("Beth Teacher", "Teacher"),
			profile("Adam Teacher", "Teacher"),
			profile("Aaron Accompanist", "Accompanist"),
			// Simulates unexpected server data with a role outside ProfileRole.
			{
				...profile("Sam Other", "Teacher"),
				role: "Volunteer",
			} as unknown as PublicDirectoryProfileDto,
		];

		const { teachers, accompanists } =
			partitionDirectoryProfiles(mixedProfiles);

		expect(teachers.map((p) => p.displayName)).toEqual([
			"Adam Teacher",
			"Beth Teacher",
		]);
		expect(accompanists.map((p) => p.displayName)).toEqual([
			"Aaron Accompanist",
			"Zach Accompanist",
		]);
	});

	it("returns empty lists for undefined or empty input", () => {
		expect(partitionDirectoryProfiles(undefined)).toEqual({
			teachers: [],
			accompanists: [],
		});
		expect(partitionDirectoryProfiles([])).toEqual({
			teachers: [],
			accompanists: [],
		});
	});

	it("reads errored resource without throwing so error state can render", () => {
		const errored = createErroredResource(new Error("network down"));
		expect(() => errored()).toThrow("network down");
		expect(readReadyProfiles(errored)).toBeUndefined();
		expect(partitionDirectoryProfiles(readReadyProfiles(errored))).toEqual({
			teachers: [],
			accompanists: [],
		});
	});

	it("reads profiles from a ready resource", () => {
		const value: PublicDirectoryProfileDto[] = [profile("Ann", "Teacher")];
		expect(readReadyProfiles(createReadyResource(value))).toBe(value);
	});

	it("guards resource reads in PublicDirectoryPage", () => {
		expect(publicDirectoryPageSource).toContain("readReadyProfiles(profiles)");
		expect(publicDirectoryPageSource).toContain("partitionDirectoryProfiles(");
	});
});

describe("DirectoryProfileCard rendering contracts", () => {
	it("renders division badges under name when approvedDivisions are present", () => {
		expect(publicDirectoryPageSource).toContain("profile().approvedDivisions");
		expect(publicDirectoryPageSource).toContain(
			"Show when={divisions().length > 0}",
		);
		expect(publicDirectoryPageSource).toContain("directory-profile-divisions");
		expect(publicDirectoryPageSource).toContain("directory-division-tag");
		expect(publicDirectoryPageSource).toContain("{division.name}");
	});

	it("renders deterministic color accent indicator when teacherColor is defined", () => {
		expect(publicDirectoryPageSource).toContain(
			"Show when={profile().teacherColor}",
		);
		expect(publicDirectoryPageSource).toContain(
			"directory-profile-color-indicator",
		);
		expect(publicDirectoryPageSource).toMatch(
			/style=\{\{\s*['"]background-color['"]:\s*profile\(\)\.teacherColor\s*\}\}/,
		);
		expect(publicDirectoryPageSource).toContain('aria-hidden="true"');
	});

	it("renders active member status indicator with appropriate badge class", () => {
		expect(publicDirectoryPageSource).toContain("directory-status-tag");
		expect(publicDirectoryPageSource).toMatch(
			/profile\(\)\.isActiveMember\s*\?\s*['"]badge-active['"]\s*:\s*['"]badge-inactive['"]/,
		);
		expect(publicDirectoryPageSource).toMatch(
			/profile\(\)\.isActiveMember\s*\?\s*['"]Active Member['"]\s*:\s*['"]Inactive Member['"]/,
		);
	});
});

describe("empty, loading, and error states", () => {
	it("renders empty state fallback per section when list is empty", () => {
		expect(publicDirectoryPageSource).toContain(
			"when={props.profiles.length > 0}",
		);
		expect(publicDirectoryPageSource).toContain(
			'fallback={<p class="empty-state">{props.emptyText}</p>}',
		);
		expect(publicDirectoryPageSource).toContain(
			'emptyText="No teachers currently listed."',
		);
		expect(publicDirectoryPageSource).toContain(
			'emptyText="No accompanists currently listed."',
		);
		expect(publicDirectoryPageSource).toContain("directory-grid");
	});

	it("renders loading state with spinner and accessibility attributes", () => {
		expect(publicDirectoryPageSource).toContain("Show when={profiles.loading}");
		expect(publicDirectoryPageSource).toContain("DirectoryLoadingState");
		expect(publicDirectoryPageSource).toContain("directory-loading");
		expect(publicDirectoryPageSource).toContain('aria-busy="true"');
		expect(publicDirectoryPageSource).toContain('aria-live="polite"');
		expect(publicDirectoryPageSource).toContain("button-spinner");
		expect(publicDirectoryPageSource).toContain("Loading directory...");
	});

	it("renders error state with alert banner and refetch retry button", () => {
		expect(publicDirectoryPageSource).toContain("Show when={profiles.error}");
		expect(publicDirectoryPageSource).toContain("DirectoryErrorState");
		expect(publicDirectoryPageSource).toContain('role="alert"');
		expect(publicDirectoryPageSource).toContain(
			"banner error-banner directory-error",
		);
		expect(publicDirectoryPageSource).toContain(
			"Failed to load directory profiles.",
		);
		expect(publicDirectoryPageSource).toContain(
			"onRetry={() => void refetch()}",
		);
		expect(publicDirectoryPageSource).toContain(
			"onClick={() => props.onRetry()}",
		);
		expect(publicDirectoryPageSource).toContain("button secondary-button");
		expect(publicDirectoryPageSource).toContain("Retry");
	});
});
