import type {
	AdminUnresolvedValidationDecision,
	AdminValidationDecisionAction,
} from "@festival/common";
import { createSignal, For, Show } from "solid-js";
import {
	approveAdminValidationDecision,
	declineAdminValidationDecision,
} from "../lib/api.js";
import type { AdminEntitlementOperations } from "./adminEntitlementOperationsData.js";
import {
	formatValidationDecisionCustomer,
	formatValidationDecisionReason,
	formatValidationDecisionStatus,
	validationDecisionBadgeClass,
} from "./adminEntitlementReportHelpers.js";

function ActionConfirmBox(props: {
	placeholder: string;
	confirmLabel: string;
	busyLabel: string;
	onSubmit: (text: string) => Promise<void>;
	onCancel: () => void;
}) {
	const [text, setText] = createSignal("");
	const [confirmed, setConfirmed] = createSignal(false);
	const [submitting, setSubmitting] = createSignal(false);
	const [error, setError] = createSignal("");

	const submit = async () => {
		const trimmed = text().trim();
		if (!confirmed() || !trimmed) {
			setError("Confirmation and a non-empty reason/note are required.");
			return;
		}
		setSubmitting(true);
		setError("");
		try {
			await props.onSubmit(trimmed);
		} catch (reason) {
			setError(
				reason instanceof Error && reason.message
					? reason.message
					: "Action could not be completed.",
			);
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div class="entitlement-confirm-box">
			<input
				type="text"
				placeholder={props.placeholder}
				value={text()}
				disabled={submitting()}
				onInput={(e) => setText(e.currentTarget.value)}
			/>
			<label>
				<input
					type="checkbox"
					checked={confirmed()}
					disabled={submitting()}
					onChange={(e) => setConfirmed(e.currentTarget.checked)}
				/>
				<span>{props.confirmLabel}</span>
			</label>
			<div class="button-row">
				<button
					type="button"
					class="secondary-button"
					disabled={submitting()}
					onClick={() => void submit()}
				>
					{submitting() ? props.busyLabel : props.confirmLabel}
				</button>
				<button
					type="button"
					class="secondary-button"
					disabled={submitting()}
					onClick={props.onCancel}
				>
					Cancel
				</button>
			</div>
			{error() && (
				<p class="shopify-error-text" role="alert">
					{error()}
				</p>
			)}
		</div>
	);
}

function DecisionRowAction(props: {
	decision: AdminUnresolvedValidationDecision;
	isAdmin: boolean;
	onResolve: (
		decisionId: string,
		action: AdminValidationDecisionAction,
		note: string,
	) => Promise<void>;
}) {
	const [pending, setPending] =
		createSignal<AdminValidationDecisionAction | null>(null);

	return (
		<Show when={props.isAdmin}>
			<div class="entitlement-decision-actions">
				<Show
					when={pending()}
					fallback={
						<div class="button-row">
							{props.decision.availableActions.map((act) => (
								<button
									type="button"
									class="secondary-button"
									onClick={() => setPending(act)}
								>
									{act === "approve" ? "Approve" : "Decline"}
								</button>
							))}
						</div>
					}
				>
					{(action) => (
						<ActionConfirmBox
							placeholder="Required admin note"
							confirmLabel={`Confirm ${action()}`}
							busyLabel="Saving…"
							onSubmit={async (note) => {
								await props.onResolve(props.decision.id, action(), note);
								setPending(null);
							}}
							onCancel={() => setPending(null)}
						/>
					)}
				</Show>
			</div>
		</Show>
	);
}

function UnresolvedDecisionsSection(props: {
	isAdmin: boolean;
	unresolvedDecisions: AdminUnresolvedValidationDecision[];
	onResolve: (
		decisionId: string,
		action: AdminValidationDecisionAction,
		note: string,
	) => Promise<void>;
}) {
	return (
		<Show
			when={props.unresolvedDecisions.length > 0}
			fallback={<p class="muted">No unresolved order validation decisions.</p>}
		>
			<div class="listing-table">
				<div class="listing-table-header">
					<span>Customer / Order</span>
					<span>Offering / Division</span>
					<span>Status / Reason</span>
					<span>Updated</span>
					<span>Actions</span>
				</div>
				<For each={props.unresolvedDecisions}>
					{(d) => {
						const customer = () => formatValidationDecisionCustomer(d);
						return (
							<div class="listing-table-row">
								<span>
									<strong>{customer().primary}</strong>
									{customer().secondary && (
										<span class="entitlement-report-secondary">
											{customer().secondary}
										</span>
									)}
									<span class="entitlement-report-secondary">
										{d.shopifyOrderGid}
									</span>
								</span>
								<span>
									<strong>{d.offeringName || "—"}</strong>
									{d.divisionName && (
										<span class="entitlement-report-secondary">
											{d.divisionName}
										</span>
									)}
								</span>
								<span>
									<span class={validationDecisionBadgeClass(d.status)}>
										{formatValidationDecisionStatus(d.status)}
									</span>
									<span class="entitlement-report-secondary">
										{formatValidationDecisionReason(d.reasonCode)}
									</span>
								</span>
								<span>{d.updatedAtIso}</span>
								<span>
									<DecisionRowAction
										decision={d}
										isAdmin={props.isAdmin}
										onResolve={props.onResolve}
									/>
								</span>
							</div>
						);
					}}
				</For>
			</div>
		</Show>
	);
}

export function AdminEntitlementOperationsSection(props: {
	operations: AdminEntitlementOperations;
}) {
	const state = props.operations;

	const resolveDecision = async (
		decisionId: string,
		action: AdminValidationDecisionAction,
		note: string,
	) => {
		const session = state.getSession();
		if (!session) throw new Error("Sign in as an Admin to resolve a decision.");
		const token = await session.getToken();
		if (!session.isCurrent())
			throw new Error("The Admin session changed. Try again.");
		const resolve =
			action === "approve"
				? approveAdminValidationDecision
				: declineAdminValidationDecision;
		await resolve(token, session.slug, decisionId, { confirmed: true, note });
		if (!session.isCurrent()) return;
		await state.loadOperations();
	};

	return (
		<section
			class="panel flow-panel shopify-validation-decisions-panel"
			aria-labelledby="shopify-validation-decisions-title"
		>
			<h2 id="shopify-validation-decisions-title">
				Unresolved Validation Decisions
			</h2>
			<Show when={state.loadError()}>
				<p class="shopify-error-text" role="alert">
					Validation decisions could not be loaded.
				</p>
			</Show>
			<Show
				when={state.snapshot()}
				fallback={
					<Show when={!state.loadError()}>
						<p class="muted" role="status">
							Loading validation decisions…
						</p>
					</Show>
				}
			>
				{(snapshot) => (
					<UnresolvedDecisionsSection
						isAdmin={Boolean(state.scope()) && !state.loadError()}
						unresolvedDecisions={snapshot().unresolvedDecisions}
						onResolve={resolveDecision}
					/>
				)}
			</Show>
		</section>
	);
}
