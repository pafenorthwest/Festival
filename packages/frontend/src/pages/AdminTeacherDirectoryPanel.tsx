import type {
	OrganizationDivision,
	TeacherProfileRecord,
} from "@festival/common";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { Button } from "../components/Button.js";
import {
	ApiError,
	getAdminDivisions,
	listAdminAccompanistProfiles,
	listAdminTeacherProfiles,
	updateAdminAccompanistProfileApproval,
	updateAdminTeacherProfileApproval,
} from "../lib/api.js";
import {
	type AdminTeacherDivisionAuthContext,
	AdminTeacherDivisionEditor,
} from "./AdminTeacherDivisionEditor.js";
import {
	type AdminDirectoryModerationProfile,
	applyUpdatedModerationProfile,
	buildDivisionNameMap,
	formatTeacherApprovalBadge,
	formatTeacherModerationActionLabel,
	nextAdminTeacherApprovalStatus,
	resolveTeacherDivisionNames,
	toAdminDirectoryModerationProfiles,
} from "./adminTeacherDirectoryHelpers.js";

function ProfileHeaderAndSummary(props: {
	profile: AdminDirectoryModerationProfile;
	divisionsById: ReadonlyMap<string, string>;
}) {
	const badge = () => formatTeacherApprovalBadge(props.profile.approval_status);
	const divisionNames = () =>
		resolveTeacherDivisionNames(
			props.profile.division_ids,
			props.divisionsById,
		);
	const teacherColor = () =>
		props.profile.role === "Teacher" ? props.profile.teacher_color : undefined;
	return (
		<>
			<div class="directory-profile-header">
				<Show when={teacherColor()}>
					{(color) => (
						<span
							class="directory-profile-color-indicator"
							style={{ "background-color": color() }}
							aria-hidden="true"
						/>
					)}
				</Show>
				<strong>{props.profile.display_name}</strong>
				<span class="directory-division-tag">{props.profile.role}</span>
				<span class={`directory-status-tag ${badge().badgeClass}`}>
					{badge().label}
				</span>
			</div>
			<p class="muted">
				{props.profile.public_directory_opt_in
					? `${props.profile.role} opted in`
					: `${props.profile.role} opted out`}
				{" · "}
				{divisionNames().length > 0
					? divisionNames().join(", ")
					: "No divisions selected"}
			</p>
		</>
	);
}

function AdminDirectoryProfileItem(props: {
	profile: AdminDirectoryModerationProfile;
	activeDivisions: readonly OrganizationDivision[];
	divisionsById: ReadonlyMap<string, string>;
	updating: boolean;
	acquireAuth: () => Promise<AdminTeacherDivisionAuthContext | null>;
	onToggleApproval: (profile: AdminDirectoryModerationProfile) => void;
	onTeacherUpdated: (updated: TeacherProfileRecord) => void;
	onDivisionBusyChange: (busy: boolean) => void;
	onError: (message: string) => void;
}) {
	return (
		<article class="admin-membership-item">
			<div>
				<ProfileHeaderAndSummary
					profile={props.profile}
					divisionsById={props.divisionsById}
				/>
				<Show when={props.profile.role === "Teacher" ? props.profile : null}>
					{(teacher) => (
						<AdminTeacherDivisionEditor
							profile={teacher()}
							activeDivisions={props.activeDivisions}
							disabled={props.updating}
							acquireAuth={props.acquireAuth}
							onSaved={props.onTeacherUpdated}
							onBusyChange={props.onDivisionBusyChange}
							onError={props.onError}
						/>
					)}
				</Show>
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
		profiles: [] as AdminDirectoryModerationProfile[],
		activeDivisions: [] as OrganizationDivision[],
		divisionsById: new Map<string, string>(),
		loading: false,
		error: "",
		updatingKey: null as string | null,
	});
	const patch = (next: Partial<ReturnType<typeof state>>) =>
		setState((cur) => ({ ...cur, ...next }));
	return { app, state, patch, disposed: false };
}

type ModerationStore = ReturnType<typeof createModerationStore>;

async function resolveModerationAuth(
	store: ModerationStore,
): Promise<AdminTeacherDivisionAuthContext | null> {
	const route = store.app.route();
	const user = store.app.firebaseUser();
	if (route.kind !== "org-admin-memberships" || !user) return null;
	return { token: await user.getIdToken(), slug: route.slug };
}

async function loadModerationProfiles(store: ModerationStore) {
	const route = store.app.route();
	const user = store.app.firebaseUser();
	if (route.kind !== "org-admin-memberships" || !user) return;
	store.patch({ loading: true, error: "" });
	try {
		const token = await user.getIdToken();
		const [teachers, accompanists, divResp] = await Promise.all([
			listAdminTeacherProfiles(token, route.slug),
			listAdminAccompanistProfiles(token, route.slug),
			getAdminDivisions(token, route.slug).catch(() => ({ divisions: [] })),
		]);
		if (!store.disposed) {
			store.patch({
				profiles: toAdminDirectoryModerationProfiles(teachers, accompanists),
				activeDivisions: divResp.divisions.filter((div) => div.isActive),
				divisionsById: buildDivisionNameMap(divResp.divisions),
			});
		}
	} catch (err) {
		if (!store.disposed)
			store.patch({
				error:
					err instanceof ApiError
						? err.message
						: "Directory profiles could not be loaded.",
			});
	} finally {
		if (!store.disposed) store.patch({ loading: false });
	}
}

async function toggleProfileModeration(
	store: ModerationStore,
	target: AdminDirectoryModerationProfile,
) {
	const route = store.app.route();
	const user = store.app.firebaseUser();
	const key = `${target.role}:${target.id}`;
	if (
		route.kind !== "org-admin-memberships" ||
		!user ||
		store.state().updatingKey
	)
		return;
	store.patch({ updatingKey: key, error: "" });
	try {
		const token = await user.getIdToken();
		const payload = {
			profileId: target.id,
			approvalStatus: nextAdminTeacherApprovalStatus(target.approval_status),
		};
		const updated: AdminDirectoryModerationProfile =
			target.role === "Teacher"
				? {
						...(await updateAdminTeacherProfileApproval(
							token,
							route.slug,
							payload,
						)),
						role: "Teacher",
					}
				: {
						...(await updateAdminAccompanistProfileApproval(
							token,
							route.slug,
							payload,
						)),
						role: "Accompanist",
					};
		if (!store.disposed)
			store.patch({
				profiles: applyUpdatedModerationProfile(
					store.state().profiles,
					updated,
				),
			});
	} catch (err) {
		if (!store.disposed)
			store.patch({
				error:
					err instanceof ApiError
						? err.message
						: "Profile approval status could not be updated.",
			});
	} finally {
		if (!store.disposed) store.patch({ updatingKey: null });
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
				<p>
					Review teacher and accompanist listings and hide or reinstate in one
					click.
				</p>
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
function ModerationProfilesList(props: { store: ModerationStore }) {
	const s = () => props.store.state();
	return (
		<div class="admin-membership-list">
			<For each={s().profiles}>
				{(profile) => {
					const rowKey = `${profile.role}:${profile.id}`;
					return (
						<AdminDirectoryProfileItem
							profile={profile}
							activeDivisions={s().activeDivisions}
							divisionsById={s().divisionsById}
							updating={s().updatingKey === rowKey}
							acquireAuth={() => resolveModerationAuth(props.store)}
							onToggleApproval={(t) =>
								void toggleProfileModeration(props.store, t)
							}
							onTeacherUpdated={(updated) =>
								!props.store.disposed &&
								props.store.patch({
									profiles: applyUpdatedModerationProfile(s().profiles, {
										...updated,
										role: "Teacher",
									}),
									updatingKey:
										s().updatingKey === rowKey ? null : s().updatingKey,
								})
							}
							onDivisionBusyChange={(busy) =>
								!props.store.disposed &&
								props.store.patch({
									updatingKey: busy
										? rowKey
										: s().updatingKey === rowKey
											? null
											: s().updatingKey,
								})
							}
							onError={(error) =>
								!props.store.disposed && props.store.patch({ error })
							}
						/>
					);
				}}
			</For>
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
					Loading directory profiles…
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
					fallback={<p class="muted">No directory profiles yet.</p>}
				>
					<ModerationProfilesList store={store} />
				</Show>
			</Show>
		</section>
	);
}
