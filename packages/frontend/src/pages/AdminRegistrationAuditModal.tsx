import type { RegistrationChangeLog } from "@festival/common";
import { createEffect, createSignal, For, Show } from "solid-js";
import { Button } from "../components/Button.js";
import {
	dropAdminRegistration,
	getRegistrationChangeLog,
	promoteAdminRegistration,
} from "../lib/api.js";
import {
	formatStateChanges,
	formatTimestamp,
} from "./registrationAuditHelpers.js";

export { formatStateChanges, formatTimestamp };

export interface AdminRegistrationAuditModalProps {
	isOpen: boolean;
	slug: string;
	festivalShortName: string;
	registrationId: string;
	idToken?: string;
	onClose: () => void;
	onActionComplete?: () => void;
}

export function AdminRegistrationAuditModal(
	props: AdminRegistrationAuditModalProps,
) {
	const [logs, setLogs] = createSignal<RegistrationChangeLog[]>([]);
	const [isLoading, setIsLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);
	const [actionMessage, setActionMessage] = createSignal<string | null>(null);
	const [isSubmitting, setIsSubmitting] = createSignal(false);

	const [dropReason, setDropReason] = createSignal("");
	const [issueRefund, setIssueRefund] = createSignal(false);
	const [promoteReason, setPromoteReason] = createSignal("");

	async function loadLogs() {
		if (!props.isOpen || !props.registrationId) return;
		setIsLoading(true);
		setError(null);
		try {
			const res = await getRegistrationChangeLog(
				props.slug,
				props.festivalShortName,
				props.registrationId,
				props.idToken,
			);
			setLogs(res.changeLogs || []);
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setIsLoading(false);
		}
	}

	createEffect(() => {
		if (props.isOpen && props.registrationId) {
			setActionMessage(null);
			void loadLogs();
		}
	});

	async function handlePromote(e: Event) {
		e.preventDefault();
		setIsSubmitting(true);
		setError(null);
		setActionMessage(null);
		try {
			const result = await promoteAdminRegistration(
				props.slug,
				props.festivalShortName,
				props.registrationId,
				{ reason: promoteReason().trim() || undefined },
				props.idToken,
			);
			setActionMessage(
				result.message || "Registration promoted successfully from waitlist.",
			);
			setPromoteReason("");
			await loadLogs();
			props.onActionComplete?.();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setIsSubmitting(false);
		}
	}

	async function handleDrop(e: Event) {
		e.preventDefault();
		setIsSubmitting(true);
		setError(null);
		setActionMessage(null);
		try {
			const result = await dropAdminRegistration(
				props.slug,
				props.festivalShortName,
				props.registrationId,
				{
					reason: dropReason().trim() || undefined,
					requestRefund: issueRefund(),
					issueRefund: issueRefund(),
				},
				props.idToken,
			);
			setActionMessage(result.message || "Registration dropped successfully.");
			setDropReason("");
			setIssueRefund(false);
			await loadLogs();
			props.onActionComplete?.();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setIsSubmitting(false);
		}
	}

	return (
		<Show when={props.isOpen}>
			<div
				class="modal-backdrop"
				role="dialog"
				aria-modal="true"
				aria-labelledby="audit-modal-title"
			>
				<div
					class="panel modal-card"
					style="max-width: 900px; width: 95vw; max-height: 90vh; overflow-y: auto;"
				>
					<header class="admin-page-header">
						<div>
							<h3 id="audit-modal-title">Registration Audit & Actions</h3>
							<p class="muted">
								Registration ID: <code>{props.registrationId}</code>
							</p>
						</div>
						<Button type="button" variant="secondary" onClick={props.onClose}>
							Close
						</Button>
					</header>

					<Show when={actionMessage()}>
						<p
							class="panel"
							style="background: #e6ffed; border: 1px solid #acf2bd; color: #155724; padding: 0.75rem;"
							role="status"
						>
							{actionMessage()}
						</p>
					</Show>

					<Show when={error()}>
						<p class="field-error" role="alert">
							{error()}
						</p>
					</Show>

					<section aria-labelledby="admin-actions-heading" class="flow-panel">
						<h4 id="admin-actions-heading">Admin Registration Actions</h4>
						<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem;">
							<form
								class="panel flow-panel"
								onSubmit={handlePromote}
								style="padding: 1rem;"
							>
								<strong>Promote Waitlist Entitlement</strong>
								<label class="field">
									<span>Promotion reason (optional)</span>
									<input
										type="text"
										value={promoteReason()}
										onInput={(e) => setPromoteReason(e.currentTarget.value)}
										placeholder="e.g. Space opened up"
									/>
								</label>
								<Button
									type="submit"
									variant="primary"
									disabled={isSubmitting()}
								>
									{isSubmitting() ? "Promoting..." : "Promote to Confirmed"}
								</Button>
							</form>

							<form
								class="panel flow-panel"
								onSubmit={handleDrop}
								style="padding: 1rem;"
							>
								<strong>Admin Drop Registration</strong>
								<label class="field">
									<span>Drop reason (optional)</span>
									<input
										type="text"
										value={dropReason()}
										onInput={(e) => setDropReason(e.currentTarget.value)}
										placeholder="e.g. Requested by customer or scheduling conflict"
									/>
								</label>
								<label
									class="field"
									style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;"
								>
									<input
										type="checkbox"
										checked={issueRefund()}
										onChange={(e) => setIssueRefund(e.currentTarget.checked)}
									/>
									<span>Issue / request refund</span>
								</label>
								<Button
									type="submit"
									variant="secondary"
									disabled={isSubmitting()}
								>
									{isSubmitting() ? "Dropping..." : "Drop Registration"}
								</Button>
							</form>
						</div>
					</section>

					<section aria-labelledby="audit-history-heading" class="flow-panel">
						<div class="division-row-heading">
							<h4 id="audit-history-heading">Change Log History</h4>
							<Button
								type="button"
								variant="secondary"
								disabled={isLoading()}
								onClick={() => void loadLogs()}
							>
								{isLoading() ? "Refreshing..." : "Refresh Logs"}
							</Button>
						</div>

						<Show
							when={!isLoading()}
							fallback={<p class="muted">Loading audit history...</p>}
						>
							<Show
								when={logs().length > 0}
								fallback={<p class="muted">No audit change logs found.</p>}
							>
								<div style="overflow-x: auto;">
									<table
										class="admin-table"
										style="width: 100%; border-collapse: collapse;"
									>
										<thead>
											<tr style="text-align: left; border-bottom: 2px solid #ccc;">
												<th style="padding: 0.5rem;">Timestamp</th>
												<th style="padding: 0.5rem;">Action</th>
												<th style="padding: 0.5rem;">Actor Role</th>
												<th style="padding: 0.5rem;">Reason</th>
												<th style="padding: 0.5rem;">State Changes</th>
											</tr>
										</thead>
										<tbody>
											<For each={logs()}>
												{(entry) => (
													<tr style="border-bottom: 1px solid #eee;">
														<td style="padding: 0.5rem; white-space: nowrap;">
															{formatTimestamp(entry.createdAt)}
														</td>
														<td style="padding: 0.5rem;">
															<span
																class="badge"
																style="text-transform: uppercase; font-size: 0.8rem;"
															>
																{entry.action}
															</span>
														</td>
														<td style="padding: 0.5rem;">{entry.actorRole}</td>
														<td style="padding: 0.5rem;">
															{entry.reason || <em class="muted">No reason</em>}
														</td>
														<td style="padding: 0.5rem; font-size: 0.9rem;">
															<code>
																{formatStateChanges(
																	entry.previousState,
																	entry.newState,
																)}
															</code>
														</td>
													</tr>
												)}
											</For>
										</tbody>
									</table>
								</div>
							</Show>
						</Show>
					</section>
				</div>
			</div>
		</Show>
	);
}
