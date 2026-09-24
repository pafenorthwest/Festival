import {
	createMemo,
	createResource,
	createSignal,
	For,
	onCleanup,
	Show,
} from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import { getVolunteerRoles } from "../lib/api.js";
import { subscribeToAuthChanges } from "../lib/firebase-auth.js";

interface VolunteerRolesPageProps {
	app: FestivalAppController;
	slug: string;
}

export function VolunteerRolesPage(props: VolunteerRolesPageProps) {
	const [idToken, setIdToken] = createSignal<string | null>(null);
	const [selectedFestivalShortName, setSelectedFestivalShortName] =
		createSignal("");
	const selectedFestival = createMemo(() => {
		const festivals = props.app.festivals();
		return (
			festivals.find(
				(festival) => festival.shortName === selectedFestivalShortName(),
			) ??
			festivals.find((festival) => festival.isPrimary) ??
			festivals[0]
		);
	});

	const unsubscribe = subscribeToAuthChanges(async (user) => {
		setIdToken(user ? await user.getIdToken() : null);
	});
	onCleanup(unsubscribe);

	const [roles] = createResource(
		() => {
			const token = idToken();
			const festival = selectedFestival();
			return props.app.hasVolunteerAdminIntent() && token && festival
				? ([token, festival.shortName] as const)
				: null;
		},
		([token, festivalShortName]) =>
			getVolunteerRoles(token, props.slug, festivalShortName),
	);

	return (
		<Show
			when={props.app.hasVolunteerAdminIntent()}
			fallback={
				<AccessDeniedPanel message="Volunteer administration is available to Admin, Division Chair, and Concert Chair members." />
			}
		>
			<section class="panel flow-panel">
				<header class="admin-page-header">
					<div>
						<h2>Volunteer Roles</h2>
						<p>Roles volunteers can sign up for at this festival.</p>
					</div>
				</header>
				<Show
					when={selectedFestival()}
					fallback={<p>No festivals have been created yet.</p>}
				>
					<label class="field">
						<span>Festival</span>
						<select
							value={selectedFestival()?.shortName ?? ""}
							onChange={(event) =>
								setSelectedFestivalShortName(event.currentTarget.value)
							}
						>
							<For each={props.app.festivals()}>
								{(festival) => (
									<option value={festival.shortName}>{festival.name}</option>
								)}
							</For>
						</select>
					</label>
					<Show when={roles.loading}>
						<p>Loading roles…</p>
					</Show>
					<Show when={roles.error}>
						<section class="banner error-banner">
							Could not load volunteer roles: {String(roles.error)}
						</section>
					</Show>
					<Show when={roles() && roles()?.length === 0}>
						<p>No volunteer roles have been created yet.</p>
					</Show>
					<ul class="volunteer-role-list">
						<For each={roles()}>
							{(role) => (
								<li class="volunteer-role-row">
									<strong>{role.slug}</strong>
									<span>{role.description}</span>
									<Show when={role.isRoomProctor}>
										<span class="badge">Room Proctor</span>
									</Show>
								</li>
							)}
						</For>
					</ul>
				</Show>
			</section>
		</Show>
	);
}
