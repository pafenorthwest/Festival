import type {
	AdminEntitlementOperationsResponse,
	AdminReconciliationRunSummary,
	AdminUnresolvedValidationDecision,
	AdminValidationDecisionAction,
} from "@festival/common";
import {
	createEffect,
	createSignal,
	For,
	onCleanup,
	Show,
	untrack,
} from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import {
	approveAdminValidationDecision,
	declineAdminValidationDecision,
	getAdminEntitlementOperations,
	triggerAdminEntitlementReconciliation,
} from "../lib/api.js";
import {
	formatReconciliationFailureCategory,
	formatReconciliationRunStatus,
	formatValidationDecisionCustomer,
	formatValidationDecisionReason,
	formatValidationDecisionStatus,
	reconciliationRunBadgeClass,
	validationDecisionBadgeClass,
} from "./adminEntitlementReportHelpers.js";

function ReconciliationRunHistoryTable(props: {
	reconciliationRuns: AdminReconciliationRunSummary[];
}) {
	return (
		<Show when={props.reconciliationRuns.length > 0}>
			<div class="listing-table">
				<div class="listing-table-header">
					<span>Run</span>
					<span>Status</span>
					<span>Orders</span>
					<span>Started / Finished</span>
				</div>
				<For each={props.reconciliationRuns}>
					{(run) => (
						<div class="listing-table-row">
							<span>{run.id}</span>
							<span>
								<span class={reconciliationRunBadgeClass(run.status)}>
									{formatReconciliationRunStatus(run.status)}
								</span>
								{run.failureCategory && (
									<span class="entitlement-report-secondary">
										{formatReconciliationFailureCategory(run.failureCategory)}
									</span>
								)}
							</span>
							<span>{`${run.processedCount} / ${run.discoveredCount}`}</span>
							<span>{`${run.startedAtIso} – ${run.finishedAtIso}`}</span>
						</div>
					)}
				</For>
			</div>
		</Show>
	);
}

function ReconciliationRunPanel(props: {
	isAdmin: boolean;
	latestRun: AdminReconciliationRunSummary | null;
	reconciliationRuns: AdminReconciliationRunSummary[];
	reconciling: boolean;
	reconcileMessage: string;
	reconcileError: string;
	onTriggerReconcile: () => void;
}) {
	return (
		<div class="entitlement-ops-block">
			<div class="shopify-card-header">
				<div>
					<h3>Shopify Order Reconciliation</h3>
					<p class="muted">
						Latest organization-wide reconciliation status and recent run
						history.
					</p>
				</div>
				<Show when={props.isAdmin}>
					<button
						type="button"
						class="secondary-button"
						disabled={props.reconciling}
						onClick={props.onTriggerReconcile}
					>
						{props.reconciling ? "Reconciling…" : "Run reconciliation"}
					</button>
				</Show>
			</div>
			{props.reconcileMessage && (
				<p class="muted" role="status">
					{props.reconcileMessage}
				</p>
			)}
			{props.reconcileError && (
				<p class="shopify-error-text" role="alert">
					{props.reconcileError}
				</p>
			)}
			<Show
				when={props.latestRun}
				fallback={<p class="muted">No reconciliation runs recorded yet.</p>}
			>
				{(run) => (
					<div class="entitlement-latest-run">
						<span class={reconciliationRunBadgeClass(run().status)}>
							{formatReconciliationRunStatus(run().status)}
						</span>
						<span>{`Processed ${run().processedCount} of ${run().discoveredCount} orders`}</span>
						<span class="muted">{`Finished ${run().finishedAtIso}`}</span>
					</div>
				)}
			</Show>
			<ReconciliationRunHistoryTable
				reconciliationRuns={props.reconciliationRuns}
			/>
		</div>
	);
}

export function ActionConfirmBox(props: {
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
		<div class="entitlement-ops-block">
			<h3>Unresolved Validation Decisions</h3>
			<Show
				when={props.unresolvedDecisions.length > 0}
				fallback={
					<p class="muted">No unresolved order validation decisions.</p>
				}
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
							const c = formatValidationDecisionCustomer(d);
							return (
								<div class="listing-table-row">
									<span>
										<strong>{c.primary}</strong>
										{c.secondary && (
											<span class="entitlement-report-secondary">
												{c.secondary}
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
		</div>
	);
}

function useEntitlementOperationsData(props: {
	app: FestivalAppController;
	refreshVersion: number;
	onMutated: () => void;
}) {
	const [ops, setOps] = createSignal<AdminEntitlementOperationsResponse | null>(
		null,
	);
	const [reconciling, setReconciling] = createSignal(false);
	const [reconcileMessage, setReconcileMessage] = createSignal("");
	const [reconcileError, setReconcileError] = createSignal("");
	let opsController: AbortController | undefined;

	const getAuthSlug = async () => {
		const route = props.app.route();
		const user = props.app.firebaseUser();
		if (route.kind !== "org-admin-memberships" || !user) return null;
		return { slug: route.slug, token: await user.getIdToken() };
	};

	const loadOperations = async () => {
		opsController?.abort();
		const auth = await getAuthSlug();
		if (!auth) return setOps(null);
		const current = new AbortController();
		opsController = current;
		try {
			const snapshot = await getAdminEntitlementOperations(
				auth.token,
				auth.slug,
				{ signal: current.signal },
			);
			if (!current.signal.aborted) setOps(snapshot);
		} catch {
			if (!current.signal.aborted) setOps(null);
		}
	};

	const triggerReconcile = async () => {
		const auth = await getAuthSlug();
		if (!auth) return;
		setReconciling(true);
		setReconcileMessage("");
		setReconcileError("");
		try {
			const res = await triggerAdminEntitlementReconciliation(
				auth.token,
				auth.slug,
			);
			setReconcileMessage(
				`Reconciled ${res.processedCount} of ${res.discoveredCount} orders.`,
			);
			await loadOperations();
			props.onMutated();
		} catch (err) {
			setReconcileError(
				err instanceof Error && err.message
					? err.message
					: "Reconciliation failed.",
			);
			await loadOperations();
		} finally {
			setReconciling(false);
		}
	};

	const resolveDecision = async (
		decisionId: string,
		action: AdminValidationDecisionAction,
		note: string,
	) => {
		const auth = await getAuthSlug();
		if (!auth) return;
		const fn =
			action === "approve"
				? approveAdminValidationDecision
				: declineAdminValidationDecision;
		await fn(auth.token, auth.slug, decisionId, { confirmed: true, note });
		await loadOperations();
		props.onMutated();
	};

	createEffect(() => {
		const route = props.app.route();
		const user = props.app.firebaseUser();
		const _version = props.refreshVersion;
		if (route.kind !== "org-admin-memberships" || !user) {
			opsController?.abort();
			setOps(null);
			return;
		}
		untrack(() => void loadOperations());
	});

	onCleanup(() => opsController?.abort());

	return {
		ops,
		reconciling,
		reconcileMessage,
		reconcileError,
		triggerReconcile,
		resolveDecision,
	};
}

export function AdminEntitlementOperationsSection(props: {
	app: FestivalAppController;
	refreshVersion: number;
	onMutated: () => void;
}) {
	const state = useEntitlementOperationsData(props);

	return (
		<div class="entitlement-operations-section">
			<ReconciliationRunPanel
				isAdmin={props.app.isAdminMember()}
				latestRun={state.ops()?.latestReconciliationRun ?? null}
				reconciliationRuns={state.ops()?.reconciliationRuns ?? []}
				reconciling={state.reconciling()}
				reconcileMessage={state.reconcileMessage()}
				reconcileError={state.reconcileError()}
				onTriggerReconcile={() => void state.triggerReconcile()}
			/>
			<UnresolvedDecisionsSection
				isAdmin={props.app.isAdminMember()}
				unresolvedDecisions={state.ops()?.unresolvedDecisions ?? []}
				onResolve={state.resolveDecision}
			/>
		</div>
	);
}
