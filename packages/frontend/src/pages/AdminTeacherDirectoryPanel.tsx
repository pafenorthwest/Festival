import type { TeacherProfileRecord } from "@festival/common";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { Button } from "../components/Button.js";
import {
	ApiError,
	getAdminDivisions,
	listAdminTeacherProfiles,
	updateAdminTeacherProfileApproval,
} from "../lib/api.js";
import {
	applyUpdatedTeacherProfile,
	buildDivisionNameMap,
	formatTeacherApprovalBadge,
	formatTeacherModerationActionLabel,
	nextAdminTeacherApprovalStatus,
	resolveTeacherDivisionNames,
	sortTeacherProfilesByName,
} from "./adminTeacherDirectoryHelpers.js";

function AdminTeacherProfileItem(props: {
	profile: TeacherProfileRecord;
	divisionsById: ReadonlyMap<string, string>;
	updating: boolean;
	onToggleApproval: (profile: TeacherProfileRecord) => void;
}) {
	const badge = () => formatTeacherApprovalBadge(props.profile.approval_status);
	const divisionNames = () =>
		resolveTeacherDivisionNames(
			props.profile.division_ids,
			props.divisionsById,
		);

	return (
		<article class="admin-membership-item">
			<div>
				<div class="directory-profile-header">
					<span
						class="directory-profile-color-indicator"
						style={{ "background-color": props.profile.teacher_color }}
						aria-hidden="true"
					/>
					<strong>{props.profile.display_name}</strong>
					<span class={`directory-status-tag ${badge().badgeClass}`}>
						{badge().label}
					</span>
				</div>
				<p class="muted">
					{props.profile.public_directory_opt_in
						? "Teacher opted in"
						: "Teacher opted out"}
					{" · "}
					{divisionNames().length > 0
						? divisionNames().join(", ")
						: "No divisions selected"}
				</p>
			</div>
			<div class="admin-membership-meta">
				<Button
					type="button"
					variant="secondary"
					disabled={props.updating}
					onClick={() => props.onToggleApproval(props.profile)}
				>
					{formatTeacherModerationActionLabel(
						props.profile.approval_status,
						props.updating,
					)}
				</Button>
			</div>
		</article>
	);
}

function createModerationStore(app: FestivalAppController) {
	const [state, setState] = createSignal({
		profiles: [] as TeacherProfileRecord[],
		divisionsById: new Map<string, string>(),
		loading: false,
		error: "",
		updatingId: null as string | null,
	});
	const patch = (next: Partial<ReturnType<typeof state>>) =>
		setState((cur) => ({ ...cur, ...next }));
	return { app, state, patch, disposed: false };
}

type ModerationStore = ReturnType<typeof createModerationStore>;

async function loadModerationProfiles(store: ModerationStore) {
	const route = store.app.route();
	const user = store.app.firebaseUser();
	if (route.kind !== "org-admin-memberships" || !user) return;
	store.patch({ loading: true, error: "" });
	try {
		const token = await user.getIdToken();
		const [listed, divResp] = await Promise.all([
			listAdminTeacherProfiles(token, route.slug),
			getAdminDivisions(token, route.slug).catch(() => ({ divisions: [] })),
		]);
		if (!store.disposed) {
			store.patch({
				profiles: sortTeacherProfilesByName(listed),
				divisionsById: buildDivisionNameMap(divResp.divisions),
			});
		}
	} catch (err) {
		if (!store.disposed)
			store.patch({
				error:
					err instanceof ApiError
						? err.message
						: "Teacher directory profiles could not be loaded.",
			});
	} finally {
		if (!store.disposed) store.patch({ loading: false });
	}
}

async function toggleTeacherModeration(
	store: ModerationStore,
	target: TeacherProfileRecord,
) {
	const route = store.app.route();
	const user = store.app.firebaseUser();
	if (
		route.kind !== "org-admin-memberships" ||
		!user ||
		store.state().updatingId
	)
		return;
	store.patch({ updatingId: target.id, error: "" });
	try {
		const updated = await updateAdminTeacherProfileApproval(
			await user.getIdToken(),
			route.slug,
			{
				profileId: target.id,
				approvalStatus: nextAdminTeacherApprovalStatus(target.approval_status),
			},
		);
		if (!store.disposed)
			store.patch({
				profiles: applyUpdatedTeacherProfile(store.state().profiles, updated),
			});
	} catch (err) {
		if (!store.disposed)
			store.patch({
				error:
					err instanceof ApiError
						? err.message
						: "Teacher approval status could not be updated.",
			});
	} finally {
		if (!store.disposed) store.patch({ updatingId: null });
	}
}

function ModerationPanelHeader(props: {
	count: number;
	loading: boolean;
	onRefresh: () => void;
}) {
	return (
		<div class="shopify-card-header">
			<div>
				<h2 id="admin-teacher-directory-title">
					Public Teacher Directory Moderation
				</h2>
				<p>Review teacher listings and hide or reinstate in one click.</p>
			</div>
			<div class="admin-membership-header-actions">
				<Button
					type="button"
					variant="secondary"
					disabled={props.loading}
					onClick={props.onRefresh}
				>
					{props.loading ? "Refreshing…" : "Refresh"}
				</Button>
				<span class="shopify-status shopify-status-ok">{props.count}</span>
			</div>
		</div>
	);
}
export function AdminTeacherDirectoryPanel(props: {
	app: FestivalAppController;
}) {
	const store = createModerationStore(props.app);
	onMount(() => void loadModerationProfiles(store));
	onCleanup(() => {
		store.disposed = true;
	});
	const s = () => store.state();
	return (
		<section
			class="panel flow-panel"
			aria-labelledby="admin-teacher-directory-title"
		>
			<ModerationPanelHeader
				count={s().profiles.length}
				loading={s().loading}
				onRefresh={() => void loadModerationProfiles(store)}
			/>
			<Show when={s().loading}>
				<p class="muted" role="status">
					Loading teacher directory profiles…
				</p>
			</Show>
			<Show when={s().error}>
				<p class="shopify-error-text" role="alert">
					{s().error}
				</p>
			</Show>
			<Show when={!s().loading}>
				<Show
					when={s().profiles.length > 0}
					fallback={<p class="muted">No teacher directory profiles yet.</p>}
				>
					<div class="admin-membership-list">
						<For each={s().profiles}>
							{(profile) => (
								<AdminTeacherProfileItem
									profile={profile}
									divisionsById={s().divisionsById}
									updating={s().updatingId === profile.id}
									onToggleApproval={(t) =>
										void toggleTeacherModeration(store, t)
									}
								/>
							)}
						</For>
					</div>
				</Show>
			</Show>
		</section>
	);
}
