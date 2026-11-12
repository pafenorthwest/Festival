import type {
	CustomerMembershipStatusEntry,
	PublicOrganizationDivision,
} from "@festival/common";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Button } from "../components/Button.js";
import {
	ApiError,
	getCustomerProfile,
	getCustomerTeacherProfile,
	getPublicDivisions,
	upsertCustomerTeacherProfile,
} from "../lib/api.js";
import {
	buildTeacherDirectoryDraft,
	clearPendingTeacherDirectoryOptIn,
	formatTeacherVisibilityBadge,
	readPendingTeacherDirectoryOptIn,
	resolveActiveTeacherGrantDivisionIds,
	type TeacherDirectoryDraftState,
	toggleDivisionSelection,
} from "./teacherDirectoryHelpers.js";

export interface CustomerTeacherDirectoryCardProps {
	slug: string;
	csrfToken: string;
	memberships: readonly CustomerMembershipStatusEntry[];
}

async function fetchInitialTeacherDirectoryBundle(
	slug: string,
	memberships: readonly CustomerMembershipStatusEntry[],
) {
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
		draft,
		shouldAutoSave:
			profile === null && pendingOptIn !== null && Boolean(draft.displayName),
	};
}

function createTeacherCardController(props: CustomerTeacherDirectoryCardProps) {
	const [ui, setUi] = createSignal({
		loading: true,
		saving: false,
		error: "",
		savedMessage: "",
	});
	const patchUi = (next: Partial<ReturnType<typeof ui>>) =>
		setUi((cur) => ({ ...cur, ...next }));
	const [divisions, setDivisions] = createSignal<PublicOrganizationDivision[]>(
		[],
	);
	const [draft, setDraft] = createSignal(
		buildTeacherDirectoryDraft({ profile: null }),
	);
	const patchDraft = (next: Partial<TeacherDirectoryDraftState>) =>
		setDraft((cur) => ({ ...cur, ...next }));
	const state = { disposed: false };
	const save = async (target: TeacherDirectoryDraftState, msg: string) => {
		const displayName = target.displayName.trim();
		if (!displayName) return patchUi({ error: "Display name is required." });
		patchUi({ saving: true, error: "", savedMessage: "" });
		try {
			const saved = await upsertCustomerTeacherProfile(
				props.slug,
				props.csrfToken,
				{
					displayName,
					publicDirectoryOptIn: target.publicDirectoryOptIn,
					divisionIds: target.divisionIds,
				},
			);
			if (state.disposed) return;
			clearPendingTeacherDirectoryOptIn(props.slug);
			setDraft(buildTeacherDirectoryDraft({ profile: saved }));
			patchUi({ savedMessage: msg });
		} catch (e) {
			const error =
				e instanceof ApiError
					? e.message
					: "Teacher directory profile could not be saved.";
			if (!state.disposed) patchUi({ error });
		} finally {
			if (!state.disposed) patchUi({ saving: false });
		}
	};
	return {
		ui,
		patchUi,
		divisions,
		setDivisions,
		draft,
		setDraft,
		patchDraft,
		save,
		state,
	};
}
type TeacherCardCtrl = ReturnType<typeof createTeacherCardController>;
function DivisionCheckboxes(props: { ctrl: TeacherCardCtrl }) {
	const ids = () => props.ctrl.draft().divisionIds;
	return (
		<Show when={props.ctrl.divisions().length > 0}>
			<fieldset class="field">
				<legend>Approved divisions</legend>
				<For each={props.ctrl.divisions()}>
					{(div) => (
						<label class="membership-consent">
							<input
								type="checkbox"
								checked={ids().includes(div.id)}
								disabled={props.ctrl.ui().saving}
								onChange={(e) =>
									props.ctrl.patchDraft({
										divisionIds: toggleDivisionSelection(
											ids(),
											div.id,
											e.currentTarget.checked,
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
			<DivisionCheckboxes ctrl={c} />
			<label class="membership-consent">
				<input
					type="checkbox"
					checked={c.draft().publicDirectoryOptIn}
					disabled={c.ui().saving}
					onChange={(e) =>
						c.patchDraft({ publicDirectoryOptIn: e.currentTarget.checked })
					}
				/>
				<span>Show my profile in the Public Teacher Directory</span>
			</label>
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
	void fetchInitialTeacherDirectoryBundle(props.slug, props.memberships)
		.then(async ({ divisions, draft, shouldAutoSave }) => {
			if (ctrl.state.disposed) return;
			ctrl.setDivisions(divisions);
			ctrl.setDraft(draft);
			if (shouldAutoSave)
				await ctrl.save(draft, "Directory listing preference saved.");
		})
		.catch(() => {
			const error = "Teacher directory settings could not be loaded.";
			if (!ctrl.state.disposed) ctrl.patchUi({ error });
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
			aria-labelledby="teacher-directory-card-heading"
		>
			<header class="customer-membership-section-header">
				<div>
					<h2 id="teacher-directory-card-heading">Public Teacher Directory</h2>
					<p class="muted">Manage your public directory name and divisions.</p>
				</div>
				<span class={`directory-status-tag ${badge().badgeClass}`}>
					{badge().label}
				</span>
			</header>
			<Show when={ctrl.ui().loading}>
				<p role="status">Loading teacher directory profile…</p>
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
