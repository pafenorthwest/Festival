import type { BillingLedgerEntry, CreditBalance } from "@festival/common";
import { createEffect, createSignal, For, Show } from "solid-js";
import { Button } from "../components/Button.js";
import {
	formatCents,
	formatDateTime,
	formatLedgerDirection,
	formatLedgerEntryType,
	ledgerDirectionBadgeClass,
} from "./billingReconciliationHelpers.js";

export interface BillingCustomerSectionProps {
	selectedCustomerId: string;
	creditBalance: CreditBalance | null;
	ledgerEntries: BillingLedgerEntry[];
	isLoadingCustomer: boolean;
	customerError: string | null;
	onLookup: (customerId: string) => void;
	onOpenModalForCustomer: (customerId: string) => void;
}

export function BillingCustomerSection(props: BillingCustomerSectionProps) {
	const [customerIdInput, setCustomerIdInput] = createSignal(
		props.selectedCustomerId,
	);

	createEffect(() => {
		if (props.selectedCustomerId) {
			setCustomerIdInput(props.selectedCustomerId);
		}
	});

	function handleCustomerLookupSubmit(e: Event) {
		e.preventDefault();
		const query = customerIdInput().trim();
		if (query) {
			props.onLookup(query);
		}
	}

	return (
		<section class="billing-customer-section">
			<form
				onSubmit={handleCustomerLookupSubmit}
				class="music-review-filter-options"
			>
				<div class="queue-search-field">
					<input
						type="search"
						placeholder="Enter Customer ID..."
						value={customerIdInput()}
						onInput={(e) => setCustomerIdInput(e.currentTarget.value)}
						aria-label="Lookup customer credit balance and ledger"
					/>
				</div>
				<Button type="submit" disabled={props.isLoadingCustomer}>
					{props.isLoadingCustomer ? "Looking up..." : "Lookup"}
				</Button>
			</form>

			<Show when={props.customerError}>
				<div class="banner banner-error" role="alert">
					{props.customerError}
				</div>
			</Show>

			<Show when={props.creditBalance}>
				<div class="metric-card" style={{ "margin-top": "1rem" }}>
					<span class="metric-label">
						Real-time Credit Balance for {props.selectedCustomerId}
					</span>
					<strong class="metric-value">
						{formatCents(
							props.creditBalance?.balanceCents,
							props.creditBalance?.currencyCode ?? "USD",
						)}
					</strong>
					<div class="metric-footer" style={{ "margin-top": "0.5rem" }}>
						<span class="muted">
							Updated:{" "}
							{formatDateTime(
								props.creditBalance?.updatedAtIso ??
									props.creditBalance?.updatedAt,
							)}
						</span>
						<button
							type="button"
							class="button secondary"
							style={{ "margin-left": "1rem" }}
							onClick={() =>
								props.onOpenModalForCustomer(props.selectedCustomerId)
							}
						>
							Adjust Balance
						</button>
					</div>
				</div>

				<h3 style={{ "margin-top": "1.5rem" }}>Immutable Ledger Entries</h3>
				<div class="listing-table">
					<div class="listing-table-header">
						<span>Date</span>
						<span>Type</span>
						<span>Direction</span>
						<span>Amount</span>
						<span>Balance After</span>
						<span>Notes / Ref</span>
					</div>

					<Show when={props.ledgerEntries.length === 0}>
						<div class="listing-table-empty">
							No ledger entries found for this customer.
						</div>
					</Show>

					<For each={props.ledgerEntries}>
						{(entry) => (
							<div class="listing-table-row">
								<span>
									{formatDateTime(entry.createdAtIso ?? entry.createdAt)}
								</span>
								<span>{formatLedgerEntryType(entry.entryType)}</span>
								<span>
									<span class={ledgerDirectionBadgeClass(entry.direction)}>
										{formatLedgerDirection(entry.direction)}
									</span>
								</span>
								<span>
									{formatCents(entry.amountCents, entry.currencyCode)}
								</span>
								<span>
									{formatCents(entry.balanceAfterCents, entry.currencyCode)}
								</span>
								<span>{entry.notes ?? entry.adjustmentId ?? "—"}</span>
							</div>
						)}
					</For>
				</div>
			</Show>
		</section>
	);
}
