import {
	type CustomerMembershipStatusEntry,
	type MembershipDivisionSelectionPolicy,
	type PublicOrganizationDivision,
	validateMembershipDivisionSelection,
} from "@festival/common";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Button } from "../components/Button.js";
import { CHECKBOX_HELP_TEXT, HelpTooltip } from "../components/HelpTooltip.js";
import {
	ApiError,
	getAccompanistMembershipForm,
	getCustomerAccompanistProfile,
	getCustomerProfile,
	getCustomerTeacherProfile,
	getPublicDivisions,
	upsertCustomerAccompanistProfile,
	upsertCustomerTeacherProfile,
} from "../lib/api.js";
import {
	buildTeacherDirectoryDraft,
	clearPendingTeacherDirectoryOptIn,
	formatAccompanistDivisionPolicyHint,
	formatTeacherVisibilityBadge,
	isAccompanistDivisionCheckboxDisabled,
	readPendingTeacherDirectoryOptIn,
	resolveActiveAccompanistGrantDivisionIds,
	resolveActiveTeacherGrantDivisionIds,
	type TeacherDirectoryDraftState,
	toggleAccompanistDivisionSelection,
} from "./teacherDirectoryHelpers.js";

export type DirectoryCardRole = "teacher" | "accompanist";

export interface CustomerTeacherDirectoryCardProps {
	slug: string;
	csrfToken: string;
	memberships: readonly CustomerMembershipStatusEntry[];
	role?: DirectoryCardRole;
	onSaved?: () => void;
}

const ROLE_CONFIG = {
	teacher: {
		headingId: "teacher-directory-card-heading",
		heading: "Public Teacher Directory",
		subtitle: "Manage your public directory display name and listing status.",
		optInLabel: "Show my profile in the Public Teacher Directory",
		loadingText: "Loading teacher directory profile…",
		loadErrorText: "Teacher directory settings could not be loaded.",
		saveErrorText: "Teacher directory profile could not be saved.",
	},
	accompanist: {
		headingId: "accompanist-directory-card-heading",
		heading: "Public Accompanist Directory",
		subtitle: "Manage your public directory name and divisions.",
		optInLabel: "Show my profile in the Public Accompanist Directory",
		loadingText: "Loading accompanist directory profile…",
		loadErrorText: "Accompanist directory settings could not be loaded.",
		saveErrorText: "Accompanist directory profile could not be saved.",
	},
} as const;

async function fetchAccompanistDirectoryBundle(
	slug: string,
	memberships: readonly CustomerMembershipStatusEntry[],
) {
	const [profile, customerResp, form] = await Promise.all([
		getCustomerAccompanistProfile(slug),
		getCustomerProfile(slug).catch(() => null),
		getAccompanistMembershipForm(slug),
	]);
	const divisions: PublicOrganizationDivision[] = form.divisions
		.filter((div) => div.isActive)
		.map(({ id, displayName, displayOrder }) => ({
			id,
			displayName,
			displayOrder,
		}));
	const draft = buildTeacherDirectoryDraft({
		profile,
		customerName: customerResp?.profile.name ?? null,
		activeDivisionIds: resolveActiveAccompanistGrantDivisionIds(
			memberships,
			divisions,
		),
		pendingOptIn: null,
	});
	return {
		divisions,
		policy: form.policy.policy,
		draft,
		shouldAutoSave: false,
	};
}

async function fetchInitialDirectoryBundle(
	slug: string,
	memberships: readonly CustomerMembershipStatusEntry[],
	role: DirectoryCardRole,
) {
	if (role === "accompanist") {
		return fetchAccompanistDirectoryBundle(slug, memberships);
	}
	const [profile, customerResp, divisionResp] = await Promise.all([
		getCustomerTeacherProfile(slug),
		getCustomerProfile(slug).catch(() => null),
		getPublicDivisions(slug),
	]);
	const divisions = divisionResp.divisions;
	const pendingOptIn = readPendingTeacherDirectoryOptIn(slug);
	const draft = buildTeacherDirectoryDraft({
		profile,
		customerName: customerResp?.profile.name ?? null,
		activeDivisionIds: resolveActiveTeacherGrantDivisionIds(
			memberships,
			divisions,
		),
		pendingOptIn,
	});
	return {
		divisions,
		policy: "exactly_one" as MembershipDivisionSelectionPolicy,
		draft,
		shouldAutoSave:
			profile === null && pendingOptIn !== null && Boolean(draft.displayName),
	};
}

interface CardUiState {
	loading: boolean;
	saving: boolean;
	error: string;
	savedMessage: string;
}

interface SaveDraftContext {
	props: CustomerTeacherDirectoryCardProps;
	role: () => DirectoryCardRole;
	policy: () => MembershipDivisionSelectionPolicy;
	divisions: () => readonly PublicOrganizationDivision[];
	state: { disposed: boolean };
	setDraft: (next: TeacherDirectoryDraftState) => void;
	patchUi: (next: Partial<CardUiState>) => void;
}

async function upsertRoleDirectoryProfile(
	props: CustomerTeacherDirectoryCardProps,
	role: DirectoryCardRole,
	payload: {
		displayName: string;
		publicDirectoryOptIn: boolean;
		divisionIds: string[];
	},
) {
	if (role === "accompanist") {
		return upsertCustomerAccompanistProfile(
			props.slug,
			props.csrfToken,
			payload,
		);
	}
	return upsertCustomerTeacherProfile(props.slug, props.csrfToken, {
		displayName: payload.displayName,
		publicDirectoryOptIn: payload.publicDirectoryOptIn,
	});
}

function validateDraftBeforeSave(
	ctx: SaveDraftContext,
	target: TeacherDirectoryDraftState,
): string | null {
	if (!target.displayName.trim()) {
		return "Display name is required.";
	}
	if (ctx.role() !== "accompanist") return null;
	try {
		validateMembershipDivisionSelection(
			ctx.policy(),
			target.divisionIds,
			ctx.divisions().length,
		);
		return null;
	} catch (err) {
		return err instanceof Error
			? err.message
			: "Selected divisions do not satisfy the membership policy.";
	}
}

async function saveCardDraft(
	ctx: SaveDraftContext,
	target: TeacherDirectoryDraftState,
	savedMessage: string,
): Promise<void> {
	const validationError = validateDraftBeforeSave(ctx, target);
	if (validationError) {
		ctx.patchUi({ error: validationError, savedMessage: "" });
		return;
	}
	const displayName = target.displayName.trim();
	ctx.patchUi({ saving: true, error: "", savedMessage: "" });
	const currentRole = ctx.role();
	try {
		const saved = await upsertRoleDirectoryProfile(ctx.props, currentRole, {
			displayName,
			publicDirectoryOptIn: target.publicDirectoryOptIn,
			divisionIds: target.divisionIds,
		});
		if (ctx.state.disposed) return;
		if (currentRole === "teacher") {
			clearPendingTeacherDirectoryOptIn(ctx.props.slug);
		}
		ctx.setDraft(buildTeacherDirectoryDraft({ profile: saved }));
		ctx.patchUi({ savedMessage });
		ctx.props.onSaved?.();
	} catch (e) {
		const error =
			e instanceof ApiError
				? e.message
				: ROLE_CONFIG[currentRole].saveErrorText;
		if (!ctx.state.disposed) ctx.patchUi({ error });
	} finally {
		if (!ctx.state.disposed) ctx.patchUi({ saving: false });
	}
}

function createTeacherCardController(props: CustomerTeacherDirectoryCardProps) {
	const role = () => props.role ?? "teacher";
	const cfg = () => ROLE_CONFIG[role()];
	const memberships = () => props.memberships;
	const [ui, setUi] = createSignal<CardUiState>({
		loading: true,
		saving: false,
		error: "",
		savedMessage: "",
	});
	const patchUi = (next: Partial<CardUiState>) =>
		setUi((cur) => ({ ...cur, ...next }));
	const [divisions, setDivisions] = createSignal<PublicOrganizationDivision[]>(
		[],
	);
	const [policy, setPolicy] =
		createSignal<MembershipDivisionSelectionPolicy>("one_to_all");
	const [draft, setDraft] = createSignal(
		buildTeacherDirectoryDraft({ profile: null }),
	);
	const patchDraft = (next: Partial<TeacherDirectoryDraftState>) =>
		setDraft((cur) => ({ ...cur, ...next }));
	const state = { disposed: false };
	const save = (target: TeacherDirectoryDraftState, msg: string) =>
		saveCardDraft(
			{ props, role, policy, divisions, state, setDraft, patchUi },
			target,
			msg,
		);
	return {
		role,
		cfg,
		memberships,
		ui,
		patchUi,
		divisions,
		setDivisions,
		policy,
		setPolicy,
		draft,
		setDraft,
		patchDraft,
		save,
		state,
	};
}
type TeacherCardCtrl = ReturnType<typeof createTeacherCardController>;

function resolveReadOnlyTeacherDivisionNames(
	divisionIds: readonly string[],
	divisions: readonly PublicOrganizationDivision[],
	memberships: readonly CustomerMembershipStatusEntry[],
): string[] {
	const byId = new Map(divisions.map((div) => [div.id, div.displayName]));
	const mapped = divisionIds
		.map((id) => byId.get(id))
		.filter((name): name is string => Boolean(name));
	if (mapped.length > 0) return mapped;
	return memberships
		.filter(
			(entry) =>
				entry.entitlementClass === "teacher_membership" &&
				entry.status === "active" &&
				Boolean(entry.divisionName?.trim()),
		)
		.map((entry) => entry.divisionName?.trim() ?? "");
}

function TeacherAssignedDivisions(props: { ctrl: TeacherCardCtrl }) {
	const names = () =>
		resolveReadOnlyTeacherDivisionNames(
			props.ctrl.draft().divisionIds,
			props.ctrl.divisions(),
			props.ctrl.memberships(),
		);
	return (
		<div class="field">
			<span>Assigned division</span>
			<Show
				when={names().length > 0}
				fallback={<p class="muted">Assigned by organization administrator.</p>}
			>
				<div class="directory-profile-divisions">
					<For each={names()}>
						{(name) => <span class="directory-division-tag">{name}</span>}
					</For>
				</div>
			</Show>
		</div>
	);
}

function AccompanistDivisionCheckboxes(props: { ctrl: TeacherCardCtrl }) {
	const c = props.ctrl;
	const ids = () => c.draft().divisionIds;
	return (
		<Show when={c.divisions().length > 0}>
			<fieldset class="field">
				<legend>Approved divisions</legend>
				<p class="muted">{formatAccompanistDivisionPolicyHint(c.policy())}</p>
				<For each={c.divisions()}>
					{(div) => (
						<label class="membership-consent">
							<input
								type="checkbox"
								checked={ids().includes(div.id)}
								disabled={
									c.ui().saving ||
									isAccompanistDivisionCheckboxDisabled(
										c.policy(),
										ids(),
										div.id,
									)
								}
								onChange={() =>
									c.patchDraft({
										divisionIds: toggleAccompanistDivisionSelection(
											c.policy(),
											ids(),
											div.id,
										),
									})
								}
							/>
							<span>{div.displayName}</span>
						</label>
					)}
				</For>
			</fieldset>
		</Show>
	);
}

function TeacherDirectoryForm(props: { ctrl: TeacherCardCtrl }) {
	const c = props.ctrl;
	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				void c.save(c.draft(), "Directory profile saved.");
			}}
		>
			<label class="field">
				<span>Display name</span>
				<input
					type="text"
					maxLength={100}
					value={c.draft().displayName}
					disabled={c.ui().saving}
					onInput={(e) => c.patchDraft({ displayName: e.currentTarget.value })}
				/>
			</label>
			<Show
				when={c.role() === "accompanist"}
				fallback={<TeacherAssignedDivisions ctrl={c} />}
			>
				<AccompanistDivisionCheckboxes ctrl={c} />
			</Show>
			<div class="checkbox-help-row">
				<label class="membership-consent">
					<input
						type="checkbox"
						checked={c.draft().publicDirectoryOptIn}
						disabled={c.ui().saving}
						onChange={(e) =>
							c.patchDraft({ publicDirectoryOptIn: e.currentTarget.checked })
						}
					/>
					<span>{c.cfg().optInLabel}</span>
				</label>
				<HelpTooltip
					id={`${c.role()}-directory-opt-in-help`}
					label={`About ${c.cfg().heading} publishing`}
					text={CHECKBOX_HELP_TEXT.publicDirectoryPublishing}
				/>
			</div>
			<div class="membership-checkout-actions">
				<Button type="submit" disabled={c.ui().saving}>
					{c.ui().saving ? "Saving…" : "Save directory profile"}
				</Button>
			</div>
		</form>
	);
}
function loadBundle(
	props: CustomerTeacherDirectoryCardProps,
	ctrl: TeacherCardCtrl,
) {
	void fetchInitialDirectoryBundle(props.slug, props.memberships, ctrl.role())
		.then(async ({ divisions, policy, draft, shouldAutoSave }) => {
			if (ctrl.state.disposed) return;
			ctrl.setDivisions(divisions);
			ctrl.setPolicy(policy);
			ctrl.setDraft(draft);
			if (shouldAutoSave)
				await ctrl.save(draft, "Directory listing preference saved.");
		})
		.catch(() => {
			if (!ctrl.state.disposed)
				ctrl.patchUi({ error: ctrl.cfg().loadErrorText });
		})
		.finally(() => !ctrl.state.disposed && ctrl.patchUi({ loading: false }));
}
export function CustomerTeacherDirectoryCard(
	props: CustomerTeacherDirectoryCardProps,
) {
	const ctrl = createTeacherCardController(props);
	onMount(() => loadBundle(props, ctrl));
	onCleanup(() => {
		ctrl.state.disposed = true;
	});
	const badge = () =>
		formatTeacherVisibilityBadge(ctrl.draft().visibilityStatus);
	return (
		<section
			class="customer-membership-section teacher-directory-card"
			aria-labelledby={ctrl.cfg().headingId}
		>
			<header class="customer-membership-section-header">
				<div>
					<h2 id={ctrl.cfg().headingId}>{ctrl.cfg().heading}</h2>
					<p class="muted">{ctrl.cfg().subtitle}</p>
				</div>
				<span class={`directory-status-tag ${badge().badgeClass}`}>
					{badge().label}
				</span>
			</header>
			<Show when={ctrl.ui().loading}>
				<p role="status">{ctrl.cfg().loadingText}</p>
			</Show>
			<Show when={ctrl.ui().error}>
				{(err) => (
					<p class="error-text" role="alert">
						{err()}
					</p>
				)}
			</Show>
			<Show when={ctrl.ui().savedMessage}>
				{(msg) => <p role="status">{msg()}</p>}
			</Show>
			<Show when={ctrl.draft().visibilityStatus === "hidden_by_admin"}>
				<p class="muted" role="status">
					An organization administrator has hidden this profile.
				</p>
			</Show>
			<Show when={!ctrl.ui().loading}>
				<TeacherDirectoryForm ctrl={ctrl} />
			</Show>
		</section>
	);
}
