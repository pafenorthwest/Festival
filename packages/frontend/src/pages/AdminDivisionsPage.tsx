import { For, Show } from "solid-js";
import {
	divisionNameValidationError,
	listIanaTimezones,
} from "../app/adminDivisions.js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";

interface AdminDivisionsPageProps {
	app: FestivalAppController;
}

export function AdminDivisionsPage(props: AdminDivisionsPageProps) {
	return (
		<Show
			when={props.app.isAdminMember()}
			fallback={
				<AccessDeniedPanel message="Only Admin members can manage divisions and timezone." />
			}
		>
			<section class="division-admin-layout">
				<header class="panel admin-page-header division-admin-header">
					<div>
						<h2>Divisions</h2>
						<p>Configure division choices and entitlement-date timezone.</p>
					</div>
				</header>

				<Show when={props.app.isLoadingDivisionConfiguration()}>
					<section class="panel" aria-live="polite">
						Loading division configuration…
					</section>
				</Show>

				<Show when={props.app.divisionConfigurationLoadError()}>
					<section class="panel division-load-error" role="alert">
						<p>{props.app.divisionConfigurationLoadError()}</p>
						<button
							type="button"
							onClick={props.app.handleReloadDivisionConfiguration}
						>
							Try again
						</button>
					</section>
				</Show>

				<Show
					when={
						!props.app.isLoadingDivisionConfiguration() &&
						!props.app.divisionConfigurationLoadError()
					}
				>
					<Show when={props.app.isDivisionMutationPending()}>
						<section class="panel" aria-live="polite" aria-busy="true">
							Saving division configuration…
						</section>
					</Show>
					<section class="panel division-history-note">
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
								value={props.app.divisionNameDraft()}
								onInput={(event) =>
									props.app.setDivisionNameDraft(event.currentTarget.value)
								}
								aria-invalid={
									props.app.createDivisionAttempted() &&
									Boolean(
										divisionNameValidationError(props.app.divisionNameDraft()),
									)
								}
								maxlength={100}
							/>
						</label>
						<Show
							when={
								props.app.createDivisionAttempted() &&
								divisionNameValidationError(props.app.divisionNameDraft())
							}
						>
							<p class="field-error" role="alert">
								{divisionNameValidationError(props.app.divisionNameDraft())}
							</p>
						</Show>
						<button
							type="button"
							disabled={props.app.isDivisionMutationPending()}
							onClick={props.app.handleCreateDivision}
						>
							Create division
						</button>
					</section>

					<section class="panel division-list-panel">
						<h3>Configured divisions</h3>
						<Show when={props.app.divisions().length === 0}>
							<p class="muted">No divisions configured yet.</p>
						</Show>
						<ol class="division-list">
							<For each={props.app.divisions()}>
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
													props.app.divisionRenameDrafts()[division.id] ??
													division.displayName
												}
												onInput={(event) =>
													props.app.setDivisionRenameDrafts((current) => ({
														...current,
														[division.id]: event.currentTarget.value,
													}))
												}
												maxlength={100}
											/>
										</label>
										<div class="division-actions">
											<button
												type="button"
												disabled={props.app.isDivisionMutationPending()}
												onClick={() =>
													props.app.handleRenameDivision(division.id)
												}
											>
												Save name
											</button>
											<button
												type="button"
												class="secondary-button"
												disabled={
													props.app.isDivisionMutationPending() || index() === 0
												}
												onClick={() =>
													props.app.handleMoveDivision(division.id, -1)
												}
												aria-label={`Move ${division.displayName} up`}
											>
												Move up
											</button>
											<button
												type="button"
												class="secondary-button"
												disabled={
													props.app.isDivisionMutationPending() ||
													index() === props.app.divisions().length - 1
												}
												onClick={() =>
													props.app.handleMoveDivision(division.id, 1)
												}
												aria-label={`Move ${division.displayName} down`}
											>
												Move down
											</button>
											<button
												type="button"
												class="secondary-button"
												disabled={props.app.isDivisionMutationPending()}
												onClick={() =>
													props.app.handleSetDivisionActive(
														division.id,
														!division.isActive,
													)
												}
											>
												{division.isActive ? "Deactivate" : "Activate"}
											</button>
										</div>
									</li>
								)}
							</For>
						</ol>
					</section>

					<section class="panel flow-panel">
						<h3>Organization timezone</h3>
						<p class="muted">
							Current timezone: {props.app.organizationTimezone()}
						</p>
						<label class="field">
							<span>IANA timezone</span>
							<select
								value={props.app.timezoneDraft()}
								onChange={(event) =>
									props.app.setTimezoneDraft(event.currentTarget.value)
								}
							>
								<For each={listIanaTimezones(props.app.organizationTimezone())}>
									{(timezone) => <option value={timezone}>{timezone}</option>}
								</For>
							</select>
						</label>
						<button
							type="button"
							disabled={
								props.app.isDivisionMutationPending() ||
								props.app.timezoneDraft() === props.app.organizationTimezone()
							}
							onClick={props.app.handleSaveOrganizationTimezone}
						>
							Save timezone
						</button>
					</section>
				</Show>
			</section>
		</Show>
	);
}
