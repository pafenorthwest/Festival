import type {
	AdminClassCheckoutRecoveryDto,
	AdminResolveClassCheckoutRecoveryInput,
} from "@festival/common";
import { createEffect, createSignal, For, on, Show } from "solid-js";
import {
	listAdminClassCheckoutRecoveries,
	resolveAdminClassCheckoutRecovery,
	sweepAdminClassCheckoutRecoveries,
} from "../lib/api/class-checkout-recovery.js";
import { ApiError } from "../lib/api/client.js";
import {
	canResolveRecovery,
	formatRecoveryCheckpoint,
	formatRecoveryReason,
	formatRecoveryStatus,
	formatRecoveryTime,
	recoveryErrorMessage,
	recoveryStatusBadgeClass,
	shortRecoveryReference,
} from "../pages/adminClassCheckoutRecoveryHelpers.js";
import { AdminClassCheckoutRecoveryResolveDialog } from "./AdminClassCheckoutRecoveryResolveDialog.js";
import { Button } from "./Button.js";

interface AdminClassCheckoutRecoveriesProps {
	slug: string;
	/** The customer chosen in the search above, if any. */
	customer?: {
		customerId: string;
		name: string | null;
		email: string | null;
	} | null;
}

export function AdminClassCheckoutRecoveries(
	props: AdminClassCheckoutRecoveriesProps,
) {
	const [recoveries, setRecoveries] = createSignal<
		AdminClassCheckoutRecoveryDto[]
	>([]);
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal<string | null>(null);
	const [feedback, setFeedback] = createSignal<string | null>(null);
	/** A problem with an action. Unlike a load error, it keeps the list visible. */
	const [notice, setNotice] = createSignal<string | null>(null);
	const [onlySelected, setOnlySelected] = createSignal(false);
	const [sweeping, setSweeping] = createSignal(false);
	const [resolving, setResolving] =
		createSignal<AdminClassCheckoutRecoveryDto | null>(null);
	const [saving, setSaving] = createSignal(false);
	const [resolveError, setResolveError] = createSignal<string | null>(null);

	let latestRequest = 0;
	const customerFilter = () =>
		onlySelected() && props.customer ? props.customer.customerId : undefined;

	async function load() {
		if (!props.slug) return;
		const request = ++latestRequest;
		setLoading(true);
		setError(null);
		try {
			const response = await listAdminClassCheckoutRecoveries(props.slug, {
				customerId: customerFilter(),
			});
			if (request !== latestRequest) return;
			setRecoveries(response.recoveries);
		} catch (reason) {
			if (request !== latestRequest) return;
			setRecoveries([]);
			setError(
				reason instanceof Error && reason.message
					? reason.message
					: "Class checkout recoveries could not be loaded.",
			);
		} finally {
			if (request === latestRequest) setLoading(false);
		}
	}

	createEffect(on([() => props.slug, customerFilter], () => void load()));

	createEffect(() => {
		if (!props.customer) setOnlySelected(false);
	});

	async function sweep() {
		setSweeping(true);
		setFeedback(null);
		setNotice(null);
		try {
			const { recoveredCount } = await sweepAdminClassCheckoutRecoveries(
				props.slug,
			);
			setFeedback(
				recoveredCount === 0
					? "No expired checkouts were found."
					: `${recoveredCount} expired checkout${recoveredCount === 1 ? "" : "s"} moved to recovery.`,
			);
			await load();
		} catch (reason) {
			setNotice(recoveryErrorMessage(reason));
		} finally {
			setSweeping(false);
		}
	}

	async function resolve(input: AdminResolveClassCheckoutRecoveryInput) {
		const target = resolving();
		if (!target) return;
		setSaving(true);
		setResolveError(null);
		try {
			const { recovery } = await resolveAdminClassCheckoutRecovery(
				props.slug,
				target.recoveryReference,
				input,
			);
			setResolving(null);
			setFeedback(
				`Checkout resolved. It is now marked ${formatRecoveryStatus(recovery.status).toLowerCase()}.`,
			);
			await load();
		} catch (reason) {
			if (
				reason instanceof ApiError &&
				reason.code === "checkout_recovery_conflict"
			) {
				// The attempt changed under us, so the dialog's version number is stale.
				// Close it, refresh, and tell the operator to look at the new state.
				setResolving(null);
				await load();
				setNotice(recoveryErrorMessage(reason));
			} else {
				setResolveError(recoveryErrorMessage(reason));
			}
		} finally {
			setSaving(false);
		}
	}

	const needsRecovery = () => recoveries().filter(canResolveRecovery).length;

	return (
		<section
			class="class-checkout-recoveries"
			aria-labelledby="class-recoveries-title"
		>
			<header class="admin-page-header">
				<div>
					<h3 id="class-recoveries-title">Class checkout recoveries</h3>
					<p class="muted">
						Class checkouts that stopped part-way. Check Shopify, and the
						customer if needed, before resolving one.
					</p>
				</div>
			</header>

			<div class="class-recovery-toolbar">
				<Button
					type="button"
					variant="secondary"
					disabled={loading()}
					onClick={() => {
						setNotice(null);
						setFeedback(null);
						void load();
					}}
				>
					Refresh
				</Button>
				<Button
					type="button"
					variant="secondary"
					disabled={sweeping()}
					onClick={() => void sweep()}
				>
					{sweeping() ? "Checking…" : "Check for expired checkouts"}
				</Button>
				<Show when={props.customer}>
					{(customer) => (
						<label class="field-checkbox">
							<input
								type="checkbox"
								checked={onlySelected()}
								onChange={(e) => setOnlySelected(e.currentTarget.checked)}
							/>
							<span>
								Only{" "}
								{customer().name ?? customer().email ?? "the selected customer"}
							</span>
						</label>
					)}
				</Show>
			</div>

			<Show when={error()}>
				{(message) => (
					<div class="alert alert-error" role="alert">
						<p>{message()}</p>
					</div>
				)}
			</Show>
			<Show when={notice()}>
				{(message) => (
					<div class="alert alert-error" role="alert">
						<p>{message()}</p>
					</div>
				)}
			</Show>
			<Show when={feedback()}>
				{(message) => (
					<div class="alert alert-success" role="status">
						<p>{message()}</p>
					</div>
				)}
			</Show>

			<Show when={loading()}>
				<p class="muted" role="status">
					Loading class checkout recoveries…
				</p>
			</Show>

			<Show when={!loading() && !error()}>
				<Show
					when={recoveries().length > 0}
					fallback={
						<p class="muted">
							{customerFilter()
								? "No class checkout recoveries for this customer."
								: "No class checkouts need attention."}
						</p>
					}
				>
					<p class="muted" role="status">
						{needsRecovery() === recoveries().length
							? `${needsRecovery()} checkout${needsRecovery() === 1 ? "" : "s"} ${needsRecovery() === 1 ? "needs" : "need"} recovery.`
							: `${recoveries().length} checkouts listed, ${needsRecovery()} needing recovery.`}
					</p>
					<div class="table-container">
						<table class="admin-table">
							<thead>
								<tr>
									<th>Status</th>
									<th>What happened</th>
									<th>Updated</th>
									<th>Action</th>
								</tr>
							</thead>
							<tbody>
								<For each={recoveries()}>
									{(recovery) => (
										<tr>
											<td>
												<span class={recoveryStatusBadgeClass(recovery.status)}>
													{formatRecoveryStatus(recovery.status)}
												</span>
												<span class="class-recovery-secondary">
													{recovery.festivalShortName ?? "Unknown festival"}
												</span>
											</td>
											<td>
												<strong>
													{formatRecoveryReason(recovery.reasonCode)}
												</strong>
												<span class="class-recovery-secondary">
													{formatRecoveryCheckpoint(recovery.checkpoint)}
												</span>
											</td>
											<td>
												{formatRecoveryTime(recovery.updatedAtIso)}
												<span class="class-recovery-secondary">
													Reference{" "}
													<code title={recovery.recoveryReference}>
														{shortRecoveryReference(recovery.recoveryReference)}
													</code>
												</span>
											</td>
											<td>
												<Show
													when={canResolveRecovery(recovery)}
													fallback={<span class="muted">None needed</span>}
												>
													<Button
														type="button"
														variant="secondary"
														onClick={() => {
															setNotice(null);
															setResolveError(null);
															setResolving(recovery);
														}}
													>
														Resolve
													</Button>
												</Show>
											</td>
										</tr>
									)}
								</For>
							</tbody>
						</table>
					</div>
				</Show>
			</Show>

			<Show when={resolving()}>
				{(target) => (
					<AdminClassCheckoutRecoveryResolveDialog
						recovery={target()}
						isSaving={saving()}
						error={resolveError()}
						onSubmit={(input) => void resolve(input)}
						onCancel={() => setResolving(null)}
					/>
				)}
			</Show>
		</section>
	);
}
