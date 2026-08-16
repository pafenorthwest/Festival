import { Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import {
	buildOrgAdminFestivalsPath,
	buildOrgAdminDivisionsPath,
	buildOrgAdminIntegrationsPath,
	buildOrgAdminMembershipsPath,
	buildOrgAdminUsersPath,
} from "../lib/routes.js";

interface AdminHomePageProps {
	app: FestivalAppController;
}

export function AdminHomePage(props: AdminHomePageProps) {
	return (
		<section class="panel org-shell">
			<header class="org-header">
				<h2 class="org-title">
					{props.app.organization()?.name ??
						props.app.sessionMembership()?.organizationName}{" "}
					admin
				</h2>
			</header>

			<Show when={props.app.sessionMembership()?.showWelcome}>
				<div class="welcome-box">
					<div>
						<strong>Welcome to the organization.</strong>
						<p>
							This is your first landing after invite acceptance. Future
							getting-started instructions can live here.
						</p>
					</div>
					<button type="button" onClick={props.app.handleDismissWelcome}>
						Dismiss
					</button>
				</div>
			</Show>

			<div class="admin-card-grid">
				<button
					type="button"
					class="admin-workflow-card"
					disabled={!props.app.isAdminMember()}
					onClick={() => {
						const membership = props.app.sessionMembership();
						if (!membership || !props.app.isAdminMember()) return;
						props.app.navigate(
							buildOrgAdminDivisionsPath(membership.organizationSlug),
						);
					}}
				>
					<strong>Divisions</strong>
					<span>Manage divisions and the entitlement timezone.</span>
				</button>
				<button
					type="button"
					class="admin-workflow-card"
					disabled={!props.app.isAdminMember()}
					onClick={() => {
						const membership = props.app.sessionMembership();
						if (!membership || !props.app.isAdminMember()) {
							return;
						}

						props.app.navigate(
							buildOrgAdminUsersPath(membership.organizationSlug),
						);
					}}
				>
					<strong>Users</strong>
					<span>Manage members and pending invites.</span>
				</button>
				<button
					type="button"
					class="admin-workflow-card"
					disabled={!props.app.isAdminMember()}
					onClick={() => {
						const membership = props.app.sessionMembership();
						if (!membership || !props.app.isAdminMember()) {
							return;
						}

						props.app.navigate(
							buildOrgAdminFestivalsPath(membership.organizationSlug),
						);
					}}
				>
					<strong>Festivals</strong>
					<span>Create and review festival dates.</span>
				</button>
				<button
					type="button"
					class="admin-workflow-card shopify-integration-card"
					disabled={!props.app.isAdminMember()}
					onClick={() => {
						const membership = props.app.sessionMembership();
						if (!membership || !props.app.isAdminMember()) {
							return;
						}

						props.app.navigate(
							buildOrgAdminIntegrationsPath(membership.organizationSlug),
						);
					}}
				>
					<strong>Shopify Integration</strong>
					<span>Store credentials and verify Admin API access.</span>
				</button>
				<button
					type="button"
					class="admin-workflow-card"
					disabled={!props.app.isAdminMember()}
					onClick={() => {
						const membership = props.app.sessionMembership();
						if (!membership || !props.app.isAdminMember()) {
							return;
						}

						props.app.navigate(
							buildOrgAdminMembershipsPath(membership.organizationSlug),
						);
					}}
				>
					<strong>Memberships</strong>
					<span>Create and review Shopify-backed memberships.</span>
				</button>
			</div>
		</section>
	);
}
