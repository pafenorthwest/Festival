import type {
	BillingAdjustment,
	BillingLedgerEntry,
	BillingMismatchRecord,
	CreditBalance,
} from "@festival/common";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onMount,
	Show,
} from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import { Button } from "../components/Button.js";
import {
	getCustomerBillingLedger,
	getCustomerCreditBalance,
	listBillingAdjustments,
	listBillingMismatches,
} from "../lib/api.js";
import { BillingAdjustmentModal } from "./BillingAdjustmentModal.js";
import { BillingCustomerSection } from "./BillingCustomerSection.js";
import {
	formatAdjustmentType,
	formatCents,
	formatDateTime,
	formatMismatchType,
	mismatchBadgeClass,
} from "./billingReconciliationHelpers.js";

export type BillingTab = "mismatches" | "customer" | "adjustments";

export interface BillingReconciliationPageProps {
	app: FestivalAppController;
	slug?: string;
}

export function BillingReconciliationPage(
	props: BillingReconciliationPageProps,
) {
	const orgSlug = () =>
		props.slug ||
		props.app.organization()?.slug ||
		(props.app.route() as { slug?: string }).slug ||
		"";

	const [activeTab, setActiveTab] = createSignal<BillingTab>("mismatches");

	// Mismatches state
	const [mismatches, setMismatches] = createSignal<BillingMismatchRecord[]>([]);
	const [isLoadingMismatches, setIsLoadingMismatches] = createSignal(false);
	const [mismatchError, setMismatchError] = createSignal<string | null>(null);

	// Customer balance & ledger state
	const [selectedCustomerId, setSelectedCustomerId] = createSignal("");
	const [creditBalance, setCreditBalance] = createSignal<CreditBalance | null>(
		null,
	);
	const [ledgerEntries, setLedgerEntries] = createSignal<BillingLedgerEntry[]>(
		[],
	);
	const [isLoadingCustomer, setIsLoadingCustomer] = createSignal(false);
	const [customerError, setCustomerError] = createSignal<string | null>(null);

	// Adjustments state
	const [adjustments, setAdjustments] = createSignal<BillingAdjustment[]>([]);
	const [adjustmentsFilterCustomer, setAdjustmentsFilterCustomer] =
		createSignal("");
	const [isLoadingAdjustments, setIsLoadingAdjustments] = createSignal(false);
	const [adjustmentsError, setAdjustmentsError] = createSignal<string | null>(
		null,
	);

	// Adjustment modal state
	const [isModalOpen, setIsModalOpen] = createSignal(false);
	const [modalCustomerId, setModalCustomerId] = createSignal("");
	const [modalAmountDollars, setModalAmountDollars] = createSignal("");
	const [modalReason, setModalReason] = createSignal("");
	const [modalReferenceId, setModalReferenceId] = createSignal("");

	async function loadMismatches() {
		const slug = orgSlug();
		if (!slug) return;
		setIsLoadingMismatches(true);
		setMismatchError(null);
		try {
			const res = await listBillingMismatches(slug);
			setMismatches(res.mismatches);
		} catch (err) {
			setMismatchError(
				err instanceof Error ? err.message : "Failed to load mismatches.",
			);
		} finally {
			setIsLoadingMismatches(false);
		}
	}

	async function loadCustomerData(targetCustomerId: string) {
		const slug = orgSlug();
		const trimmed = targetCustomerId.trim();
		if (!slug || !trimmed) return;
		setSelectedCustomerId(trimmed);
		setIsLoadingCustomer(true);
		setCustomerError(null);
		try {
			const [balanceRes, ledgerRes] = await Promise.all([
				getCustomerCreditBalance(slug, trimmed),
				getCustomerBillingLedger(slug, trimmed),
			]);
			setCreditBalance(balanceRes.creditBalance);
			setLedgerEntries(ledgerRes.ledger ?? ledgerRes.ledgerEntries ?? []);
		} catch (err) {
			setCustomerError(
				err instanceof Error ? err.message : "Failed to load customer data.",
			);
		} finally {
			setIsLoadingCustomer(false);
		}
	}

	async function loadAdjustments(custFilter?: string) {
		const slug = orgSlug();
		if (!slug) return;
		setIsLoadingAdjustments(true);
		setAdjustmentsError(null);
		try {
			const res = await listBillingAdjustments(slug, custFilter || undefined);
			setAdjustments(res.adjustments);
		} catch (err) {
			setAdjustmentsError(
				err instanceof Error ? err.message : "Failed to load adjustments.",
			);
		} finally {
			setIsLoadingAdjustments(false);
		}
	}

	onMount(() => {
		void loadMismatches();
	});

	createEffect(() => {
		const slug = orgSlug();
		if (slug) {
			void loadMismatches();
		}
	});

	function openModalForMismatch(record: BillingMismatchRecord) {
		setModalCustomerId(record.customerId);
		setModalReferenceId(
			record.shopifyOrderId ?? record.registrationId ?? record.id,
		);
		setModalAmountDollars(
			record.amountCents ? (Math.abs(record.amountCents) / 100).toFixed(2) : "",
		);
		setModalReason(record.description ?? `Resolve ${record.mismatchType}`);
		setIsModalOpen(true);
	}

	function openModalForCustomer(custId: string) {
		setModalCustomerId(custId);
		setModalReferenceId("");
		setModalAmountDollars("");
		setModalReason("");
		setIsModalOpen(true);
	}

	function navigateToCustomerLookup(custId: string) {
		setSelectedCustomerId(custId);
		setActiveTab("customer");
		void loadCustomerData(custId);
	}

	function handleAdjustmentCreated() {
		void loadMismatches();
		void loadAdjustments(adjustmentsFilterCustomer().trim());
		if (selectedCustomerId()) {
			void loadCustomerData(selectedCustomerId());
		}
	}

	const unresolvedCount = createMemo(
		() => mismatches().filter((m) => !m.resolved).length,
	);

	return (
		<Show
			when={props.app.isAdminMember()}
			fallback={
				<AccessDeniedPanel message="Only Admin members can view billing reconciliation." />
			}
		>
			<div class="panel flow-panel org-shell billing-reconciliation-page">
				<header class="org-header">
					<div>
						<h2 class="org-title">Billing Reconciliation</h2>
						<p class="muted">
							Investigate order-registration mismatches, view customer ledgers,
							and issue adjustments.
						</p>
					</div>
					<Button
						type="button"
						onClick={() => {
							setModalCustomerId("");
							setModalReferenceId("");
							setModalAmountDollars("");
							setModalReason("");
							setIsModalOpen(true);
						}}
					>
						New Adjustment
					</Button>
				</header>

				{/* Tabs Navigation */}
				<nav class="music-review-filter-bar" aria-label="Billing sections">
					<div class="music-review-status-tabs">
						<button
							type="button"
							class={`button ${activeTab() === "mismatches" ? "primary" : "secondary"}`}
							aria-pressed={activeTab() === "mismatches"}
							onClick={() => {
								setActiveTab("mismatches");
								void loadMismatches();
							}}
						>
							Mismatches ({unresolvedCount()})
						</button>
						<button
							type="button"
							class={`button ${activeTab() === "customer" ? "primary" : "secondary"}`}
							aria-pressed={activeTab() === "customer"}
							onClick={() => setActiveTab("customer")}
						>
							Customer Balance & Ledger
						</button>
						<button
							type="button"
							class={`button ${activeTab() === "adjustments" ? "primary" : "secondary"}`}
							aria-pressed={activeTab() === "adjustments"}
							onClick={() => {
								setActiveTab("adjustments");
								void loadAdjustments(adjustmentsFilterCustomer().trim());
							}}
						>
							Adjustments History
						</button>
					</div>
				</nav>

				{/* TAB 1: Mismatches */}
				<Show when={activeTab() === "mismatches"}>
					<section class="billing-mismatches-section">
						<Show when={mismatchError()}>
							<div class="banner banner-error" role="alert">
								{mismatchError()}
							</div>
						</Show>

						<div class="listing-table">
							<div class="listing-table-header">
								<span>Mismatch Type</span>
								<span>Customer</span>
								<span>Order GID / Ref</span>
								<span>Difference</span>
								<span>Status</span>
								<span>Actions</span>
							</div>

							<Show when={isLoadingMismatches() && mismatches().length === 0}>
								<div class="listing-table-empty">Loading mismatches...</div>
							</Show>

							<Show when={!isLoadingMismatches() && mismatches().length === 0}>
								<div class="listing-table-empty">
									No billing mismatches found.
								</div>
							</Show>

							<For each={mismatches()}>
								{(item) => (
									<div class="listing-table-row">
										<span>
											<span class={mismatchBadgeClass(item.mismatchType)}>
												{formatMismatchType(item.mismatchType)}
											</span>
										</span>
										<span>{item.customerId}</span>
										<span>
											{item.shopifyOrderId ?? item.registrationId ?? "—"}
										</span>
										<span>
											{formatCents(
												item.amountCents,
												item.currencyCode ?? "USD",
											)}
										</span>
										<span>
											<span
												class={
													item.resolved
														? "badge badge-active"
														: "badge badge-review"
												}
											>
												{item.resolved ? "Resolved" : "Unresolved"}
											</span>
										</span>
										<span class="listing-table-actions">
											<button
												type="button"
												class="button secondary"
												onClick={() => openModalForMismatch(item)}
											>
												Adjust
											</button>
											<button
												type="button"
												class="button secondary"
												onClick={() =>
													navigateToCustomerLookup(item.customerId)
												}
											>
												Ledger
											</button>
										</span>
									</div>
								)}
							</For>
						</div>
					</section>
				</Show>

				{/* TAB 2: Customer Credit Balance & Ledger */}
				<Show when={activeTab() === "customer"}>
					<BillingCustomerSection
						selectedCustomerId={selectedCustomerId()}
						creditBalance={creditBalance()}
						ledgerEntries={ledgerEntries()}
						isLoadingCustomer={isLoadingCustomer()}
						customerError={customerError()}
						onLookup={(custId) => void loadCustomerData(custId)}
						onOpenModalForCustomer={openModalForCustomer}
					/>
				</Show>

				{/* TAB 3: Adjustments History */}
				<Show when={activeTab() === "adjustments"}>
					<section class="billing-adjustments-section">
						<div class="music-review-filter-bar">
							<div class="music-review-filter-options">
								<input
									type="search"
									placeholder="Filter by Customer ID..."
									value={adjustmentsFilterCustomer()}
									onInput={(e) => {
										const val = e.currentTarget.value;
										setAdjustmentsFilterCustomer(val);
										void loadAdjustments(val.trim());
									}}
									aria-label="Filter adjustments by Customer ID"
								/>
							</div>
							<Button
								type="button"
								class="secondary-button"
								onClick={() =>
									void loadAdjustments(adjustmentsFilterCustomer().trim())
								}
								disabled={isLoadingAdjustments()}
							>
								{isLoadingAdjustments() ? "Refreshing..." : "Refresh"}
							</Button>
						</div>

						<Show when={adjustmentsError()}>
							<div class="banner banner-error" role="alert">
								{adjustmentsError()}
							</div>
						</Show>

						<div class="listing-table">
							<div class="listing-table-header">
								<span>Date</span>
								<span>Customer</span>
								<span>Type</span>
								<span>Amount</span>
								<span>Reason</span>
								<span>Reference ID</span>
								<span>Approved Decision ID</span>
							</div>

							<Show when={isLoadingAdjustments() && adjustments().length === 0}>
								<div class="listing-table-empty">Loading adjustments...</div>
							</Show>

							<Show
								when={!isLoadingAdjustments() && adjustments().length === 0}
							>
								<div class="listing-table-empty">No adjustments found.</div>
							</Show>

							<For each={adjustments()}>
								{(adj) => (
									<div class="listing-table-row">
										<span>
											{formatDateTime(adj.createdAtIso ?? adj.createdAt)}
										</span>
										<span>{adj.customerId}</span>
										<span>
											<span class="badge badge-neutral">
												{formatAdjustmentType(adj.adjustmentType)}
											</span>
										</span>
										<span>
											{formatCents(adj.amountCents, adj.currencyCode)}
										</span>
										<span>{adj.reason}</span>
										<span>{adj.referenceId ?? "—"}</span>
										<span>{adj.approvedDecisionId ?? "—"}</span>
									</div>
								)}
							</For>
						</div>
					</section>
				</Show>

				{/* Adjustment Modal */}
				<BillingAdjustmentModal
					isOpen={isModalOpen()}
					slug={orgSlug()}
					initialCustomerId={modalCustomerId()}
					initialAmountDollars={modalAmountDollars()}
					initialReason={modalReason()}
					initialReferenceId={modalReferenceId()}
					onClose={() => setIsModalOpen(false)}
					onCreated={handleAdjustmentCreated}
				/>
			</div>
		</Show>
	);
}
