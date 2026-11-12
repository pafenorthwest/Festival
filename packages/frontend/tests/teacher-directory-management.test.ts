import { afterEach, describe, expect, it } from "bun:test";
import type {
	CustomerMembershipStatusEntry,
	ProfileApprovalStatus,
	PublicOrganizationDivision,
	TeacherProfileRecord,
} from "@festival/common";
import { ApiError } from "../src/lib/api.js";

interface UpsertTeacherInput {
	displayName: string;
	publicDirectoryOptIn: boolean;
	divisionIds: string[];
}

interface TeacherApiModule {
	getCustomerTeacherProfile?: (
		orgSlug: string,
	) => Promise<TeacherProfileRecord | null>;
	upsertCustomerTeacherProfile?: (
		orgSlug: string,
		csrfToken: string,
		input: UpsertTeacherInput,
	) => Promise<TeacherProfileRecord>;
	listAdminTeacherProfiles?: (
		idToken: string,
		orgSlug: string,
	) => Promise<TeacherProfileRecord[]>;
	updateAdminTeacherProfileApproval?: (
		idToken: string,
		orgSlug: string,
		input: { profileId: string; approvalStatus: ProfileApprovalStatus },
	) => Promise<TeacherProfileRecord>;
}

type TeacherVisibilityStatus = "listed" | "opted_out" | "hidden_by_admin";

interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

interface TeacherDirectoryDraftInput {
	profile: TeacherProfileRecord | null;
	customerName?: string | null;
	activeDivisionIds?: readonly string[];
	pendingOptIn?: boolean | null;
}

interface TeacherDirectoryDraftState {
	displayName: string;
	publicDirectoryOptIn: boolean;
	divisionIds: string[];
	visibilityStatus: TeacherVisibilityStatus;
}

interface TeacherDirectoryHelpersModule {
	DEFAULT_TEACHER_DIRECTORY_OPT_IN: boolean;
	resolveInitialCheckoutDirectoryOptIn: (
		pendingPreference?: boolean | null,
	) => boolean;
	readPendingTeacherDirectoryOptIn: (
		orgSlug: string,
		storage?: Pick<StorageLike, "getItem"> | null,
	) => boolean | null;
	writePendingTeacherDirectoryOptIn: (
		orgSlug: string,
		optIn: boolean,
		storage?: Pick<StorageLike, "setItem"> | null,
	) => void;
	clearPendingTeacherDirectoryOptIn: (
		orgSlug: string,
		storage?: Pick<StorageLike, "removeItem"> | null,
	) => void;
	hasActiveTeacherMembership: (
		memberships: readonly CustomerMembershipStatusEntry[],
	) => boolean;
	resolveActiveTeacherGrantDivisionIds: (
		memberships: readonly CustomerMembershipStatusEntry[],
		divisions: readonly PublicOrganizationDivision[],
	) => string[];
	computeTeacherDirectoryVisibility: (
		profile: Pick<
			TeacherProfileRecord,
			"public_directory_opt_in" | "approval_status"
		> | null,
	) => TeacherVisibilityStatus;
	buildTeacherDirectoryDraft: (
		input: TeacherDirectoryDraftInput,
	) => TeacherDirectoryDraftState;
}

interface AdminTeacherDirectoryHelpersModule {
	nextAdminTeacherApprovalStatus: (
		currentStatus: ProfileApprovalStatus,
	) => ProfileApprovalStatus;
	applyUpdatedTeacherProfile: (
		profiles: readonly TeacherProfileRecord[],
		updated: TeacherProfileRecord,
	) => TeacherProfileRecord[];
}

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

const loadApi = async () =>
	(await import("../src/lib/api.js")) as unknown as TeacherApiModule;

const loadCustomerHelpers = async () => {
	const path = "../src/pages/teacherDirectoryHelpers.js";
	return (await import(path)) as TeacherDirectoryHelpersModule;
};

const loadAdminHelpers = async () => {
	const path = "../src/pages/adminTeacherDirectoryHelpers.js";
	return (await import(path)) as AdminTeacherDirectoryHelpersModule;
};

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
	it("upsertCustomerTeacherProfile sends PUT with credentials, X-CSRF-Token, and JSON body", async () => {
		const api = await loadApi();
		let capturedUrl = "";
		let capturedInit: RequestInit | undefined;
		const payload: UpsertTeacherInput = {
			displayName: "Clara Schumann",
			publicDirectoryOptIn: true,
			divisionIds: ["11111111-1111-4111-8111-111111111111"],
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
		expect(JSON.parse(String(capturedInit?.body))).toEqual(payload);
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
});

describe("UI wiring contracts for teacher directory opt-in and admin moderation", () => {
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

	it("mounts CustomerTeacherDirectoryCard for active teacher members with upsert", async () => {
		const accountPage = await readSource(
			"../src/pages/CustomerAccountMembershipsPage.tsx",
		);
		const cardSource = await readSource(
			"../src/pages/CustomerTeacherDirectoryCard.tsx",
		);
		expect(accountPage).toContain("CustomerTeacherDirectoryCard");
		expect(accountPage).toContain("hasActiveTeacherMembership");
		expect(cardSource).toContain("getCustomerTeacherProfile");
		expect(cardSource).toContain("upsertCustomerTeacherProfile");
		expect(cardSource).toContain("clearPendingTeacherDirectoryOptIn");
	});

	it("mounts AdminTeacherDirectoryPanel in AdminMembershipProductsPage", async () => {
		const adminPage = await readSource(
			"../src/pages/AdminMembershipProductsPage.tsx",
		);
		const panelSource = await readSource(
			"../src/pages/AdminTeacherDirectoryPanel.tsx",
		);
		expect(adminPage).toContain("AdminTeacherDirectoryPanel");
		expect(panelSource).toContain("listAdminTeacherProfiles");
		expect(panelSource).toContain("updateAdminTeacherProfileApproval");
		expect(panelSource).toContain("nextAdminTeacherApprovalStatus");
		expect(panelSource).toContain("applyUpdatedTeacherProfile");
	});
});
