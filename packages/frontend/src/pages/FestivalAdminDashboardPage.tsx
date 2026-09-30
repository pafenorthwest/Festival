import { createEffect, createResource, createSignal, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import { Button } from "../components/Button.js";
import { getAdminFestival } from "../lib/api.js";
import {
	buildFestivalAdminClassesPath,
	buildOrgBillingPath,
	buildOrgCommunicationsPath,
	buildOrgMusicReviewPath,
} from "../lib/routes.js";
import { AdminRegistrationAuditModal } from "./AdminRegistrationAuditModal.js";

export function FestivalAdminDashboardPage(props: {
	app: FestivalAppController;
	slug: string;
	festivalSlug: string;
}) {
	const [auditRegistrationId, setAuditRegistrationId] = createSignal("");
	const [activeAuditId, setActiveAuditId] = createSignal<string | null>(null);
	const [userToken, setUserToken] = createSignal<string | undefined>(undefined);

	createEffect(() => {
		const user = props.app.firebaseUser();
		if (user) {
			void user.getIdToken().then((tok) => setUserToken(tok));
		}
	});

	function handleOpenAudit(e: Event) {
		e.preventDefault();
		const regId = auditRegistrationId().trim();
		if (!regId) return;
		setActiveAuditId(regId);
	}

	const [festival] = createResource(
		() => {
			const user = props.app.firebaseUser();
			return props.app.isAdminMember() && user
				? ([props.slug, props.festivalSlug, user] as const)
				: null;
		},
		async (input) => {
			if (!input) throw new Error("Sign in to manage this festival.");
			const [slug, festivalSlug, user] = input;
			return getAdminFestival(await user.getIdToken(), slug, festivalSlug);
		},
	);

	return (
		<Show
			when={props.app.isAdminMember()}
			fallback={
				<AccessDeniedPanel message="Only Admin members can manage festivals." />
			}
		>
			<Show when={festival.loading}>
				<section class="panel">
					<p class="muted">Loading festival.</p>
				</section>
			</Show>
			<Show when={festival.error}>
				<section class="panel">
					<p role="alert">Festival not found.</p>
				</section>
			</Show>
			<Show when={festival()}>
				<section class="panel">
					<h2>{festival()?.festival.name}</h2>
					<p>Festival dashboard</p>
					<div class="admin-card-grid">
						<button
							type="button"
							class="admin-workflow-card"
							onClick={() =>
								props.app.navigate(
									buildFestivalAdminClassesPath(props.slug, props.festivalSlug),
								)
							}
						>
							<strong>Classes</strong>
							<span>Manage this Festival’s class catalog.</span>
						</button>
						<button
							type="button"
							class="admin-workflow-card"
							onClick={() =>
								props.app.navigate(buildOrgMusicReviewPath(props.slug))
							}
						>
							<strong>Music Review</strong>
							<span>Review and normalize submitted repertoire.</span>
						</button>
						<button
							type="button"
							class="admin-workflow-card"
							onClick={() =>
								props.app.navigate(buildOrgBillingPath(props.slug))
							}
						>
							<strong>Billing Reconciliation</strong>
							<span>
								Investigate billing mismatches and manage adjustments.
							</span>
						</button>
						<button
							type="button"
							class="admin-workflow-card"
							onClick={() =>
								props.app.navigate(buildOrgCommunicationsPath(props.slug))
							}
						>
							<strong>Communications</strong>
							<span>Manage message templates and view delivery logs.</span>
						</button>
					</div>

					<Show when={props.app.isDropTransferEnabled()}>
						<section
							aria-labelledby="admin-audit-section-heading"
							class="panel flow-panel"
							style="margin-top: 1.5rem;"
						>
							<h3 id="admin-audit-section-heading">
								Registration Audit & Operations
							</h3>
							<p class="muted">
								Inspect change logs, promote waitlisted performers, or drop
								registrations.
							</p>
							<form
								onSubmit={handleOpenAudit}
								style="display: flex; gap: 0.5rem; align-items: flex-end; flex-wrap: wrap;"
							>
								<label
									class="field"
									style="margin-bottom: 0; flex: 1; min-width: 250px;"
								>
									<span>Registration ID</span>
									<input
										type="text"
										placeholder="Enter registration or entitlement ID..."
										value={auditRegistrationId()}
										onInput={(e) =>
											setAuditRegistrationId(e.currentTarget.value)
										}
										required
									/>
								</label>
								<Button type="submit" variant="secondary">
									Inspect Audit History
								</Button>
							</form>
						</section>
					</Show>

					<Show when={activeAuditId()}>
						{(regId) => (
							<AdminRegistrationAuditModal
								isOpen={Boolean(activeAuditId())}
								slug={props.slug}
								festivalShortName={props.festivalSlug}
								registrationId={regId()}
								idToken={userToken()}
								onClose={() => setActiveAuditId(null)}
							/>
						)}
					</Show>
				</section>
			</Show>
		</Show>
	);
}
