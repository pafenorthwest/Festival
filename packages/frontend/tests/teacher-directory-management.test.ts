import { afterEach, describe, expect, it } from "bun:test";
import type {
	AccompanistProfileRecord,
	CustomerMembershipStatusEntry,
	MembershipDivisionSelectionPolicy,
	PublicOrganizationDivision,
	TeacherProfileRecord,
} from "@festival/common";
import * as apiMod from "../src/lib/api.js";
import { ApiError } from "../src/lib/api.js";
import * as adminHelpersMod from "../src/pages/adminTeacherDirectoryHelpers.js";
import type { StorageLike } from "../src/pages/teacherDirectoryHelpers.js";
import * as customerHelpersMod from "../src/pages/teacherDirectoryHelpers.js";

type ModerationProfile =
	| (TeacherProfileRecord & { role: "Teacher" })
	| (AccompanistProfileRecord & { role: "Accompanist" });

type DirectoryApiModule = Omit<
	typeof apiMod,
	"upsertCustomerTeacherProfile"
> & {
	upsertCustomerTeacherProfile?: (
		orgSlug: string,
		csrfToken: string,
		input: { displayName: string; publicDirectoryOptIn: boolean },
	) => Promise<TeacherProfileRecord>;
	updateAdminTeacherProfileDivisions?: (
		idToken: string,
		orgSlug: string,
		input: { profileId: string; divisionIds: string[] },
	) => Promise<TeacherProfileRecord>;
};

type TeacherDirectoryHelpersModule = typeof customerHelpersMod & {
	hasActiveAccompanistMembership?: (
		memberships: readonly CustomerMembershipStatusEntry[],
	) => boolean;
	resolveActiveAccompanistGrantDivisionIds?: (
		memberships: readonly CustomerMembershipStatusEntry[],
		divisions: readonly PublicOrganizationDivision[],
	) => string[];
	resolveInitialAccompanistDirectoryOptIn?: (
		existingProfile?: Pick<
			AccompanistProfileRecord,
			"public_directory_opt_in"
		> | null,
	) => boolean;
	formatAccompanistDivisionPolicyHint?: (
		policy: MembershipDivisionSelectionPolicy,
	) => string;
	isAccompanistDivisionCheckboxDisabled?: (
		policy: MembershipDivisionSelectionPolicy,
		selectedIds: readonly string[],
		divisionId: string,
	) => boolean;
	toggleAccompanistDivisionSelection?: (
		policy: MembershipDivisionSelectionPolicy,
		selectedIds: readonly string[],
		divisionId: string,
	) => string[];
};

type AdminTeacherDirectoryHelpersModule = typeof adminHelpersMod & {
	toAdminDirectoryModerationProfiles?: (
		teachers: readonly TeacherProfileRecord[],
		accompanists: readonly AccompanistProfileRecord[],
	) => ModerationProfile[];
	applyUpdatedModerationProfile?: (
		profiles: readonly ModerationProfile[],
		updated: ModerationProfile,
	) => ModerationProfile[];
};

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function sampleTeacherRecord(
	overrides: Partial<TeacherProfileRecord> = {},
): TeacherProfileRecord {
	return {
		id: "prof-1",
		organization_id: "org-1",
		customer_id: "cust-1",
		display_name: "Clara Schumann",
		teacher_color: "#1D4ED8",
		public_directory_opt_in: true,
		approval_status: "approved",
		division_ids: ["11111111-1111-4111-8111-111111111111"],
		created_at: "2026-09-01T00:00:00.000Z",
		updated_at: "2026-09-01T00:00:00.000Z",
		...overrides,
	};
}

function createMemoryStorage(): StorageLike {
	const store = new Map<string, string>();
	return {
		getItem: (key) => store.get(key) ?? null,
		setItem: (key, value) => {
			store.set(key, value);
		},
		removeItem: (key) => {
			store.delete(key);
		},
	};
}

const readSource = (relativePath: string) =>
	Bun.file(new URL(relativePath, import.meta.url)).text();
const readOptionalSource = async (relativePath: string) => {
	const file = Bun.file(new URL(relativePath, import.meta.url));
	return (await file.exists()) ? file.text() : "";
};
const loadApi = async () => apiMod as unknown as DirectoryApiModule;
const loadCustomerHelpers = async () =>
	customerHelpersMod as TeacherDirectoryHelpersModule;
const loadAdminHelpers = async () =>
	adminHelpersMod as AdminTeacherDirectoryHelpersModule;

describe("customer teacher directory API client helpers", () => {
	it("getCustomerTeacherProfile returns profile on 200, null on 404, and rethrows non-404", async () => {
		const api = await loadApi();
		expect(typeof api.getCustomerTeacherProfile).toBe("function");
		let capturedUrl = "";
		let capturedInit: RequestInit | undefined;
		const record = sampleTeacherRecord();

		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			capturedUrl = String(input);
			capturedInit = init;
			return Response.json(record, { status: 200 });
		}) as typeof fetch;

		const found = await api.getCustomerTeacherProfile?.("pafe");
		expect(capturedUrl).toBe("/api/customer/orgs/pafe/profiles/teacher");
		expect(capturedInit?.credentials).toBe("include");
		expect(
			(capturedInit?.headers as Record<string, string> | undefined)
				?.Authorization,
		).toBeUndefined();
		expect(found).toEqual(record);

		globalThis.fetch = (async () =>
			Response.json({ error: "Not found" }, { status: 404 })) as typeof fetch;
		expect(await api.getCustomerTeacherProfile?.("pafe")).toBeNull();

		globalThis.fetch = (async () =>
			Response.json(
				{ error: "Server error" },
				{ status: 500 },
			)) as typeof fetch;
		await expect(
			api.getCustomerTeacherProfile?.("pafe"),
		).rejects.toBeInstanceOf(ApiError);
	});
});

describe("customer upsert and admin teacher directory API client helpers", () => {
	it("upsertCustomerTeacherProfile sends PUT with credentials, X-CSRF-Token, and JSON body without divisionIds", async () => {
		const api = await loadApi();
		let capturedUrl = "";
		let capturedInit: RequestInit | undefined;
		const payload = {
			displayName: "Clara Schumann",
			publicDirectoryOptIn: true,
		};
		const expected = sampleTeacherRecord();
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			capturedUrl = String(input);
			capturedInit = init;
			return Response.json(expected, { status: 200 });
		}) as typeof fetch;
		const saved = await api.upsertCustomerTeacherProfile?.(
			"pafe",
			"csrf-123",
			payload,
		);
		expect(capturedUrl).toBe("/api/customer/orgs/pafe/profiles/teacher");
		expect(capturedInit?.method).toBe("PUT");
		expect(capturedInit?.credentials).toBe("include");
		const headers = capturedInit?.headers as Record<string, string>;
		expect(headers["X-CSRF-Token"]).toBe("csrf-123");
		expect(headers.Authorization).toBeUndefined();
		const parsedBody = JSON.parse(String(capturedInit?.body));
		expect(parsedBody).toEqual(payload);
		expect(parsedBody).not.toHaveProperty("divisionIds");
		expect(saved).toEqual(expected);
	});
});

describe("admin teacher directory API client helpers", () => {
	it("listAdminTeacherProfiles and updateAdminTeacherProfileApproval send Bearer token", async () => {
		const api = await loadApi();
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const hidden = sampleTeacherRecord({ approval_status: "rejected" });

		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			calls.push({ url: String(input), init });
			return calls.length === 1
				? Response.json([sampleTeacherRecord()], { status: 200 })
				: Response.json(hidden, { status: 200 });
		}) as typeof fetch;

		const listed = await api.listAdminTeacherProfiles?.("id-token-1", "pafe");
		expect(listed).toHaveLength(1);
		expect(calls[0]?.url).toBe("/api/admin/orgs/pafe/profiles/teachers");
		expect(
			(calls[0]?.init?.headers as Record<string, string>).Authorization,
		).toBe("Bearer id-token-1");

		const updated = await api.updateAdminTeacherProfileApproval?.(
			"id-token-1",
			"pafe",
			{ profileId: "prof-1", approvalStatus: "rejected" },
		);
		expect(updated).toEqual(hidden);
		expect(calls[1]?.url).toBe(
			"/api/admin/orgs/pafe/profiles/teachers/prof-1/approval",
		);
		expect(calls[1]?.init?.method).toBe("PATCH");
		expect(
			(calls[1]?.init?.headers as Record<string, string>).Authorization,
		).toBe("Bearer id-token-1");
		expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
			approvalStatus: "rejected",
		});
	});

	it("updateAdminTeacherProfileDivisions sends PATCH with Bearer token and single-division body", async () => {
		const api = await loadApi();
		expect(typeof api.updateAdminTeacherProfileDivisions).toBe("function");
		let capturedUrl = "";
		let capturedInit: RequestInit | undefined;
		const nextDivId = "22222222-2222-4222-8222-222222222222";
		const reassigned = sampleTeacherRecord({ division_ids: [nextDivId] });

		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			capturedUrl = String(input);
			capturedInit = init;
			return Response.json(reassigned, { status: 200 });
		}) as typeof fetch;

		const updated = await api.updateAdminTeacherProfileDivisions?.(
			"id-token-1",
			"pafe",
			{ profileId: "prof-1", divisionIds: [nextDivId] },
		);
		expect(updated).toEqual(reassigned);
		expect(capturedUrl).toBe(
			"/api/admin/orgs/pafe/profiles/teachers/prof-1/divisions",
		);
		expect(capturedInit?.method).toBe("PATCH");
		expect(
			(capturedInit?.headers as Record<string, string>).Authorization,
		).toBe("Bearer id-token-1");
		expect(JSON.parse(String(capturedInit?.body))).toEqual({
			divisionIds: [nextDivId],
		});
	});
});

describe("customer teacher directory checkout opt-in storage helpers", () => {
	it("defaults opt-in to true when no profile or pending checkout choice exists", async () => {
		const h = await loadCustomerHelpers();
		expect(h.DEFAULT_TEACHER_DIRECTORY_OPT_IN).toBe(true);
		expect(h.resolveInitialCheckoutDirectoryOptIn(undefined)).toBe(true);
		expect(h.resolveInitialCheckoutDirectoryOptIn(null)).toBe(true);
		expect(h.resolveInitialCheckoutDirectoryOptIn(false)).toBe(false);

		const draft = h.buildTeacherDirectoryDraft({
			profile: null,
			customerName: "  Clara Schumann  ",
			activeDivisionIds: ["div-piano"],
		});
		expect(draft).toEqual({
			displayName: "Clara Schumann",
			publicDirectoryOptIn: true,
			divisionIds: ["div-piano"],
			visibilityStatus: "opted_out",
		});
	});

	it("persists and clears pending checkout opt-in preference per orgSlug", async () => {
		const h = await loadCustomerHelpers();
		const storage = createMemoryStorage();
		expect(h.readPendingTeacherDirectoryOptIn("pafe", storage)).toBeNull();

		h.writePendingTeacherDirectoryOptIn("pafe", false, storage);
		h.writePendingTeacherDirectoryOptIn("other-org", true, storage);
		expect(h.readPendingTeacherDirectoryOptIn("pafe", storage)).toBe(false);
		expect(h.readPendingTeacherDirectoryOptIn("other-org", storage)).toBe(true);

		const carriedDraft = h.buildTeacherDirectoryDraft({
			profile: null,
			customerName: "Clara",
			activeDivisionIds: ["div-piano"],
			pendingOptIn: h.readPendingTeacherDirectoryOptIn("pafe", storage),
		});
		expect(carriedDraft.publicDirectoryOptIn).toBe(false);

		h.clearPendingTeacherDirectoryOptIn("pafe", storage);
		expect(h.readPendingTeacherDirectoryOptIn("pafe", storage)).toBeNull();
		expect(h.readPendingTeacherDirectoryOptIn("other-org", storage)).toBe(true);
	});
});

describe("customer teacher profile state and visibility helpers", () => {
	it("initializes existing TeacherProfileRecord, grant divisions, and visibility statuses", async () => {
		const h = await loadCustomerHelpers();
		const memberships: CustomerMembershipStatusEntry[] = [
			{
				entitlementClass: "teacher_membership",
				displayName: "Teacher Membership",
				status: "active",
				divisionName: "Piano",
			},
			{
				entitlementClass: "teacher_membership",
				displayName: "Teacher Membership",
				status: "expired",
				divisionName: "Voice",
			},
		];
		const divisions: PublicOrganizationDivision[] = [
			{ id: "div-piano", displayName: "Piano", displayOrder: 1 },
			{ id: "div-voice", displayName: "Voice", displayOrder: 2 },
		];

		expect(h.hasActiveTeacherMembership(memberships)).toBe(true);
		expect(h.hasActiveTeacherMembership([memberships[1]])).toBe(false);
		expect(
			h.resolveActiveTeacherGrantDivisionIds(memberships, divisions),
		).toEqual(["div-piano"]);

		const listedRecord = sampleTeacherRecord();
		expect(h.buildTeacherDirectoryDraft({ profile: listedRecord })).toEqual({
			displayName: "Clara Schumann",
			publicDirectoryOptIn: true,
			divisionIds: ["11111111-1111-4111-8111-111111111111"],
			visibilityStatus: "listed",
		});
		expect(
			h.computeTeacherDirectoryVisibility(
				sampleTeacherRecord({ public_directory_opt_in: false }),
			),
		).toBe("opted_out");
		expect(
			h.computeTeacherDirectoryVisibility(
				sampleTeacherRecord({
					public_directory_opt_in: true,
					approval_status: "rejected",
				}),
			),
		).toBe("hidden_by_admin");
	});

	it("enforces accompanist division policy hints, checkbox disabling, and toggle transitions", async () => {
		const h = await loadCustomerHelpers();
		expect(typeof h.formatAccompanistDivisionPolicyHint).toBe("function");
		expect(typeof h.isAccompanistDivisionCheckboxDisabled).toBe("function");
		expect(typeof h.toggleAccompanistDivisionSelection).toBe("function");
		if (
			!h.formatAccompanistDivisionPolicyHint ||
			!h.isAccompanistDivisionCheckboxDisabled ||
			!h.toggleAccompanistDivisionSelection
		)
			return;
		const hint = h.formatAccompanistDivisionPolicyHint;
		const dis = h.isAccompanistDivisionCheckboxDisabled;
		const tog = h.toggleAccompanistDivisionSelection;

		const [h1, h2, hAll] = [
			hint("exactly_one"),
			hint("one_to_two"),
			hint("one_to_all"),
		];
		expect(h1).toMatch(/1|one/i);
		expect(h2).toMatch(/2|two/i);
		expect(hAll.length).toBeGreaterThan(0);
		expect(new Set([h1, h2, hAll]).size).toBe(3);

		expect(dis("exactly_one", ["d1"], "d2")).toBe(false);
		expect(dis("exactly_one", ["d1", "d2"], "d3")).toBe(true);
		expect(dis("exactly_one", ["d1", "d2"], "d1")).toBe(false);
		expect(tog("exactly_one", ["d1"], "d2")).toEqual(["d2"]);
		expect(tog("exactly_one", ["d1"], "d1")).toEqual(["d1"]);
		expect(tog("exactly_one", ["d1", "d2"], "d1")).toEqual(["d2"]);
		expect(tog("exactly_one", ["d1", "d2"], "d3")).toEqual(["d1", "d2"]);

		expect(dis("one_to_two", ["d1"], "d2")).toBe(false);
		expect(dis("one_to_two", ["d1", "d2"], "d3")).toBe(true);
		expect(dis("one_to_two", ["d1", "d2"], "d1")).toBe(false);
		expect(tog("one_to_two", ["d1"], "d2")).toEqual(["d1", "d2"]);
		expect(tog("one_to_two", ["d1", "d2"], "d3")).toEqual(["d1", "d2"]);
		expect(tog("one_to_two", ["d1", "d2"], "d1")).toEqual(["d2"]);

		expect(dis("one_to_all", ["d1", "d2"], "d3")).toBe(false);
		expect(tog("one_to_all", ["d1", "d2"], "d3")).toEqual(["d1", "d2", "d3"]);
		expect(tog("one_to_all", ["d1", "d2", "d3"], "d2")).toEqual(["d1", "d3"]);
	});
});

describe("admin one-click teacher directory toggle helpers", () => {
	it("maps approval status for one-click Hide and Reinstate/Approve", async () => {
		const h = await loadAdminHelpers();
		expect(h.nextAdminTeacherApprovalStatus("approved")).toBe("rejected");
		expect(h.nextAdminTeacherApprovalStatus("rejected")).toBe("approved");
		expect(h.nextAdminTeacherApprovalStatus("pending")).toBe("approved");
	});

	it("replaces updated profile deterministically while preserving display name order", async () => {
		const h = await loadAdminHelpers();
		const first = sampleTeacherRecord({ id: "p-1", display_name: "Alice" });
		const second = sampleTeacherRecord({ id: "p-2", display_name: "Beth" });
		const original = [second, first];
		const hiddenFirst = {
			...first,
			approval_status: "rejected" as const,
		};

		const next = h.applyUpdatedTeacherProfile(original, hiddenFirst);
		expect(next.map((p) => `${p.display_name}:${p.approval_status}`)).toEqual([
			"Alice:rejected",
			"Beth:approved",
		]);
		expect(original[0]?.id).toBe("p-2");
	});

	it("supports accompanist membership helpers and combined Teacher + Accompanist moderation without cross-role ID collision", async () => {
		const ch = await loadCustomerHelpers();
		const ah = await loadAdminHelpers();
		const adminHelperSrc = await readSource(
			"../src/pages/adminTeacherDirectoryHelpers.ts",
		);
		expect(adminHelperSrc).toContain("AdminDirectoryModerationProfile");
		expect(typeof ch.hasActiveAccompanistMembership).toBe("function");
		expect(typeof ch.resolveActiveAccompanistGrantDivisionIds).toBe("function");
		expect(typeof ch.resolveInitialAccompanistDirectoryOptIn).toBe("function");
		expect(typeof ah.toAdminDirectoryModerationProfiles).toBe("function");
		expect(typeof ah.applyUpdatedModerationProfile).toBe("function");

		expect(ch.resolveInitialAccompanistDirectoryOptIn?.(null)).toBe(true);
		expect(
			ch.resolveInitialAccompanistDirectoryOptIn?.({
				public_directory_opt_in: false,
			}),
		).toBe(false);
		expect(
			ch.resolveInitialAccompanistDirectoryOptIn?.({
				public_directory_opt_in: true,
			}),
		).toBe(true);

		const memberships: CustomerMembershipStatusEntry[] = [
			{
				entitlementClass: "accompanist_membership",
				displayName: "Accompanist Membership",
				status: "active",
				divisionName: "Strings",
			},
			{
				entitlementClass: "accompanist_membership",
				displayName: "Accompanist Membership",
				status: "expired",
				divisionName: "Piano",
			},
		];
		const divisions: PublicOrganizationDivision[] = [
			{ id: "div-piano", displayName: "Piano", displayOrder: 1 },
			{ id: "div-strings", displayName: "Strings", displayOrder: 2 },
		];
		expect(ch.hasActiveAccompanistMembership?.(memberships)).toBe(true);
		expect(ch.hasActiveAccompanistMembership?.([memberships[1]])).toBe(false);
		expect(
			ch.resolveActiveAccompanistGrantDivisionIds?.(memberships, divisions),
		).toEqual(["div-strings"]);
		expect(
			ch.resolveActiveAccompanistGrantDivisionIds?.(
				[
					{
						entitlementClass: "accompanist_membership",
						displayName: "Accompanist Membership",
						status: "active",
						divisionName: "Piano, Strings",
					},
				],
				divisions,
			),
		).toEqual(["div-piano", "div-strings"]);

		const teacher = sampleTeacherRecord({
			id: "shared-1",
			display_name: "Zoe Teacher",
		});
		const accompanist: AccompanistProfileRecord = {
			id: "shared-1",
			organization_id: "org-1",
			customer_id: "cust-2",
			display_name: "Ava Accompanist",
			public_directory_opt_in: true,
			approval_status: "approved",
			division_ids: ["div-strings"],
			created_at: "2026-09-01T00:00:00.000Z",
			updated_at: "2026-09-01T00:00:00.000Z",
		};
		const combined =
			ah.toAdminDirectoryModerationProfiles?.([teacher], [accompanist]) ?? [];
		expect(combined.map((p) => `${p.role}:${p.display_name}`)).toEqual([
			"Accompanist:Ava Accompanist",
			"Teacher:Zoe Teacher",
		]);
		const updatedList =
			ah.applyUpdatedModerationProfile?.(combined, {
				...accompanist,
				role: "Accompanist",
				approval_status: "rejected",
			}) ?? [];
		expect(
			updatedList.map((p) => `${p.role}:${p.id}:${p.approval_status}`),
		).toEqual(["Accompanist:shared-1:rejected", "Teacher:shared-1:approved"]);
	});
});

describe("UI wiring contracts for teacher and accompanist directory opt-in and admin moderation", () => {
	it("renders pre-selected directory opt-in after step 2 with resumed entitlementClass fallback", async () => {
		const membershipPage = await readSource("../src/pages/MembershipPage.tsx");
		expect(membershipPage).toContain("teacherDirectoryHelpers");
		expect(membershipPage).toContain("writePendingTeacherDirectoryOptIn");
		expect(membershipPage).toContain("resumed.selection.entitlementClass");
		expect(membershipPage).toContain("props.ctrl.state().entitlementClass");
		const agreeIdx = membershipPage.indexOf("2. Agree to sharing data");
		const dirIdx = membershipPage.indexOf("Public Teacher Directory");
		expect(agreeIdx).toBeGreaterThan(-1);
		expect(dirIdx).toBeGreaterThan(agreeIdx);
	});

	it("mounts CustomerTeacherDirectoryCard for active teacher and accompanist members with role-specific headings and upserts", async () => {
		const accountPage = await readSource(
			"../src/pages/CustomerAccountMembershipsPage.tsx",
		);
		const cardSource = await readSource(
			"../src/pages/CustomerTeacherDirectoryCard.tsx",
		);
		expect(accountPage).toContain("CustomerTeacherDirectoryCard");
		expect(accountPage).toContain("hasActiveTeacherMembership");
		expect(accountPage).toContain("hasActiveAccompanistMembership");
		expect(accountPage).toContain('role="accompanist"');
		expect(cardSource).toContain("Public Teacher Directory");
		expect(cardSource).toContain("Public Accompanist Directory");
		expect(cardSource).toContain("getCustomerTeacherProfile");
		expect(cardSource).toContain("upsertCustomerTeacherProfile");
		expect(cardSource).toContain("getCustomerAccompanistProfile");
		expect(cardSource).toContain("upsertCustomerAccompanistProfile");
		expect(cardSource).toContain("getAccompanistMembershipForm");
		expect(cardSource).toContain("clearPendingTeacherDirectoryOptIn");
	});

	it("mounts AdminTeacherDirectoryPanel with Teacher + Accompanist list, approval moderation, and Teacher-only division reassignment", async () => {
		const adminPage = await readSource(
			"../src/pages/AdminMembershipProductsPage.tsx",
		);
		const panelSource = await readSource(
			"../src/pages/AdminTeacherDirectoryPanel.tsx",
		);
		const editorSource = await readOptionalSource(
			"../src/pages/AdminTeacherDivisionEditor.tsx",
		);
		const combinedPanelSource = `${panelSource}\n${editorSource}`;
		expect(adminPage).toContain("AdminTeacherDirectoryPanel");
		expect(panelSource).toContain("listAdminTeacherProfiles");
		expect(panelSource).toContain("listAdminAccompanistProfiles");
		expect(panelSource).toContain("updateAdminTeacherProfileApproval");
		expect(panelSource).toContain("updateAdminAccompanistProfileApproval");
		expect(panelSource).toContain("nextAdminTeacherApprovalStatus");
		expect(panelSource).toContain("toAdminDirectoryModerationProfiles");
		expect(panelSource).toContain("applyUpdatedModerationProfile");
		expect(combinedPanelSource).toContain("updateAdminTeacherProfileDivisions");
		expect(combinedPanelSource).toContain("<select");
		expect(combinedPanelSource).toMatch(/role\s*===\s*"Teacher"/);
	});
});
