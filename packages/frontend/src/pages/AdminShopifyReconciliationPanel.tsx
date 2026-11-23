import type { AdminReconciliationRunSummary } from "@festival/common";
import { createEffect, createSignal, For, Show } from "solid-js";
import { Button } from "../components/Button.js";
import { triggerAdminEntitlementReconciliation } from "../lib/api.js";
import type { AdminEntitlementOperations } from "./adminEntitlementOperationsData.js";
import {
	formatReconciliationFailureCategory,
	formatReconciliationRunStatus,
	reconciliationRunBadgeClass,
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

export function AdminShopifyReconciliationPanel(props: {
	operations: AdminEntitlementOperations;
}) {
	const state = props.operations;
	const [running, setRunning] = createSignal(false);
	const [result, setResult] = createSignal<AdminReconciliationRunSummary>();
	const [runError, setRunError] = createSignal("");
	let history!: HTMLDetailsElement;
	const latestRun = () => result() ?? state.snapshot()?.latestReconciliationRun;
	const runs = () => {
		const recent = state.snapshot()?.reconciliationRuns ?? [];
		const completed = result();
		return completed && !recent.some((run) => run.id === completed.id)
			? [completed, ...recent]
			: recent;
	};

	createEffect(() => {
		state.scope();
		setRunning(false);
		setResult(undefined);
		setRunError("");
		history.open = false;
	});

	const run = async () => {
		const session = state.getSession();
		if (!session || running()) return;
		setRunning(true);
		setRunError("");
		setResult(undefined);
		history.open = true;
		try {
			const token = await session.getToken();
			if (!session.isCurrent()) return;
			const response = await triggerAdminEntitlementReconciliation(
				token,
				session.slug,
			);
			if (session.isCurrent()) setResult(response.run);
		} catch (error) {
			if (session.isCurrent()) {
				setRunError(
					error instanceof Error && error.message
						? error.message
						: "Reconciliation failed.",
				);
			}
		} finally {
			if (session.isCurrent()) {
				setRunning(false);
				void state.loadOperations();
			}
		}
	};

	return (
		<section
			class="panel flow-panel shopify-reconciliation-panel"
			aria-labelledby="shopify-reconciliation-title"
		>
			<div class="shopify-reconciliation-header">
				<h2 id="shopify-reconciliation-title">Shopify Order Reconciliation</h2>
				<Button
					type="button"
					variant="secondary"
					disabled={running() || !state.scope()}
					onClick={() => void run()}
				>
					{running() ? "Reconciling…" : "Run Reconciliation"}
				</Button>
			</div>
			<details class="shopify-reconciliation-history" ref={history}>
				<summary>Run history</summary>
				<div class="shopify-reconciliation-history-content">
					<Show when={running()}>
						<p class="muted" role="status">
							Reconciliation in progress…
						</p>
					</Show>
					<Show when={runError()}>
						<p class="shopify-error-text" role="alert">
							{runError()}
						</p>
					</Show>
					<Show when={state.loadError()}>
						<p class="shopify-error-text" role="alert">
							{state.loadError()}
						</p>
					</Show>
					<Show when={latestRun()}>
						{(latest) => (
							<div class="entitlement-latest-run" role="status">
								<span class={reconciliationRunBadgeClass(latest().status)}>
									{formatReconciliationRunStatus(latest().status)}
								</span>
								<span>{`Processed ${latest().processedCount} orders · ${latest().discoveredCount} discovered`}</span>
								<span class="muted">{`Finished ${latest().finishedAtIso}`}</span>
							</div>
						)}
					</Show>
					<Show when={state.snapshot() && runs().length === 0}>
						<p class="muted">No reconciliation runs recorded yet.</p>
					</Show>
					<ReconciliationRunHistoryTable reconciliationRuns={runs()} />
				</div>
			</details>
		</section>
	);
}
