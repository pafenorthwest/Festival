import { For, Show } from "solid-js";
import { divisionNameValidationError } from "../app/adminDivisions.js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import { Button } from "../components/Button.js";
import { useAdminOrg } from "../domains/admin-org/AdminOrgContext.js";

interface AdminDivisionsPageProps {
	app: FestivalAppController;
}

export function AdminDivisionsPage(props: AdminDivisionsPageProps) {
	const adminOrg = useAdminOrg();
	return (
		<Show
			when={props.app.isAdminMember()}
			fallback={
				<AccessDeniedPanel message="Only Admin members can manage divisions." />
			}
		>
			<section class="panel flow-panel admin-page-header division-admin-header">
				<div>
					<h2>Divisions</h2>
					<p>Configure division choices.</p>
				</div>
			</section>

			<Show when={adminOrg.isLoadingDivisionConfiguration()}>
				<section class="panel flow-panel" aria-live="polite">
					Loading division configuration…
				</section>
			</Show>

			<Show when={adminOrg.divisionConfigurationLoadError()}>
				<section class="panel flow-panel division-load-error" role="alert">
					<p>{adminOrg.divisionConfigurationLoadError()}</p>
					<Button
						type="button"
						onClick={adminOrg.handleReloadDivisionConfiguration}
					>
						Try again
					</Button>
				</section>
			</Show>

			<Show
				when={
					!adminOrg.isLoadingDivisionConfiguration() &&
					!adminOrg.divisionConfigurationLoadError()
				}
			>
				<Show when={adminOrg.isDivisionMutationPending()}>
					<section class="panel flow-panel" aria-live="polite" aria-busy="true">
						Saving division configuration…
					</section>
				</Show>
				<section class="panel flow-panel division-history-note">
					<strong>Historical purchases are preserved.</strong>
					<p>
						Inactive divisions remain on historical purchases but cannot be
						selected for new purchases.
					</p>
				</section>

				<section class="panel flow-panel">
					<h3>Create a division</h3>
					<label class="field">
						<span>Division name</span>
						<input
							value={adminOrg.divisionNameDraft()}
							onInput={(event) =>
								adminOrg.setDivisionNameDraft(event.currentTarget.value)
							}
							aria-invalid={
								adminOrg.createDivisionAttempted() &&
								Boolean(
									divisionNameValidationError(adminOrg.divisionNameDraft()),
								)
							}
							maxlength={100}
						/>
					</label>
					<Show
						when={
							adminOrg.createDivisionAttempted() &&
							divisionNameValidationError(adminOrg.divisionNameDraft())
						}
					>
						<p class="field-error" role="alert">
							{divisionNameValidationError(adminOrg.divisionNameDraft())}
						</p>
					</Show>
					<Button
						type="button"
						disabled={adminOrg.isDivisionMutationPending()}
						onClick={adminOrg.handleCreateDivision}
					>
						Create division
					</Button>
				</section>

				<section class="panel flow-panel division-list-panel">
					<h3>Configured divisions</h3>
					<Show when={adminOrg.divisions().length === 0}>
						<p class="muted">No divisions configured yet.</p>
					</Show>
					<ol class="division-list">
						<For each={adminOrg.divisions()}>
							{(division, index) => (
								<li class="division-row">
									<div class="division-row-heading">
										<strong>{division.displayName}</strong>
										<span
											class={`division-status ${division.isActive ? "division-status-active" : "division-status-inactive"}`}
										>
											{division.isActive ? "Active" : "Inactive"}
										</span>
									</div>
									<label class="field">
										<span>Rename division</span>
										<input
											value={
												adminOrg.divisionRenameDrafts()[division.id] ??
												division.displayName
											}
											onInput={(event) =>
												adminOrg.setDivisionRenameDrafts((current) => ({
													...current,
													[division.id]: event.currentTarget.value,
												}))
											}
											maxlength={100}
										/>
									</label>
									<div class="division-actions">
										<Button
											type="button"
											disabled={adminOrg.isDivisionMutationPending()}
											onClick={() => adminOrg.handleRenameDivision(division.id)}
										>
											Save name
										</Button>
										<Button
											type="button"
											variant="secondary"
											disabled={
												adminOrg.isDivisionMutationPending() || index() === 0
											}
											onClick={() =>
												adminOrg.handleMoveDivision(division.id, -1)
											}
											aria-label={`Move ${division.displayName} up`}
										>
											Move up
										</Button>
										<Button
											type="button"
											variant="secondary"
											disabled={
												adminOrg.isDivisionMutationPending() ||
												index() === adminOrg.divisions().length - 1
											}
											onClick={() =>
												adminOrg.handleMoveDivision(division.id, 1)
											}
											aria-label={`Move ${division.displayName} down`}
										>
											Move down
										</Button>
										<Button
											type="button"
											variant="secondary"
											disabled={adminOrg.isDivisionMutationPending()}
											onClick={() =>
												adminOrg.handleSetDivisionActive(
													division.id,
													!division.isActive,
												)
											}
										>
											{division.isActive ? "Deactivate" : "Activate"}
										</Button>
									</div>
								</li>
							)}
						</For>
					</ol>
				</section>
			</Show>
		</Show>
	);
}
