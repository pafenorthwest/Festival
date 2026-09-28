import {
	BILLING_ADJUSTMENT_TYPES,
	type BillingAdjustment,
	type BillingAdjustmentType,
} from "@festival/common";
import { createEffect, createSignal, For, Show } from "solid-js";
import { Button } from "../components/Button.js";
import { createBillingAdjustment } from "../lib/api.js";
import { formatAdjustmentType } from "./billingReconciliationHelpers.js";

export interface BillingAdjustmentModalProps {
	isOpen: boolean;
	slug: string;
	initialCustomerId?: string;
	initialAmountDollars?: string;
	initialAdjustmentType?: BillingAdjustmentType;
	initialReason?: string;
	initialReferenceId?: string;
	initialReferenceType?: string;
	onClose: () => void;
	onCreated: (adjustment: BillingAdjustment) => void;
}

export function BillingAdjustmentModal(props: BillingAdjustmentModalProps) {
	const [customerId, setCustomerId] = createSignal("");
	const [adjustmentType, setAdjustmentType] =
		createSignal<BillingAdjustmentType>("credit_issue");
	const [amountDollars, setAmountDollars] = createSignal("");
	const [currencyCode, setCurrencyCode] = createSignal("USD");
	const [reason, setReason] = createSignal("");
	const [referenceId, setReferenceId] = createSignal("");
	const [referenceType, setReferenceType] = createSignal("");
	const [approvedDecisionId, setApprovedDecisionId] = createSignal("");
	const [notes, setNotes] = createSignal("");
	const [isSubmitting, setIsSubmitting] = createSignal(false);
	const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

	createEffect(() => {
		if (props.isOpen) {
			setCustomerId(props.initialCustomerId ?? "");
			setAdjustmentType(props.initialAdjustmentType ?? "credit_issue");
			setAmountDollars(props.initialAmountDollars ?? "");
			setCurrencyCode("USD");
			setReason(props.initialReason ?? "");
			setReferenceId(props.initialReferenceId ?? "");
			setReferenceType(props.initialReferenceType ?? "");
			setApprovedDecisionId("");
			setNotes("");
			setErrorMessage(null);
			setIsSubmitting(false);
		}
	});

	async function handleSubmit(event: Event) {
		event.preventDefault();
		setErrorMessage(null);

		const trimmedCustomer = customerId().trim();
		if (!trimmedCustomer) {
			setErrorMessage("Customer ID is required.");
			return;
		}

		const parsedAmount = Number.parseFloat(amountDollars());
		if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
			setErrorMessage("Amount must be a positive number.");
			return;
		}

		const trimmedReason = reason().trim();
		if (!trimmedReason) {
			setErrorMessage("Reason is required.");
			return;
		}

		const amountCents = Math.round(parsedAmount * 100);

		setIsSubmitting(true);
		try {
			const result = await createBillingAdjustment(props.slug, {
				customerId: trimmedCustomer,
				adjustmentType: adjustmentType(),
				amountCents,
				currencyCode: currencyCode().trim().toUpperCase() || "USD",
				reason: trimmedReason,
				referenceId: referenceId().trim() || null,
				referenceType: referenceType().trim() || null,
				approvedDecisionId: approvedDecisionId().trim() || null,
				notes: notes().trim() || null,
			});

			props.onCreated(result.adjustment);
			props.onClose();
		} catch (error) {
			setErrorMessage(
				error instanceof Error ? error.message : "Failed to apply adjustment.",
			);
		} finally {
			setIsSubmitting(false);
		}
	}

	return (
		<Show when={props.isOpen}>
			<div class="modal-backdrop" role="presentation">
				<section
					class="modal-card panel flow-panel"
					role="dialog"
					aria-modal="true"
					aria-labelledby="adjustment-modal-title"
				>
					<header class="music-review-modal-header">
						<div>
							<h3 id="adjustment-modal-title">Create Billing Adjustment</h3>
							<p class="muted">Record a financial adjustment for a customer.</p>
						</div>
						<button
							type="button"
							class="close-button"
							aria-label="Close dialog"
							onClick={() => props.onClose()}
						>
							&times;
						</button>
					</header>

					<Show when={errorMessage()}>
						<div class="banner banner-error" role="alert">
							{errorMessage()}
						</div>
					</Show>

					<form onSubmit={handleSubmit} class="billing-adjustment-form">
						<div class="field">
							<label for="adjustment-customer-id">
								<strong>Customer ID</strong>
							</label>
							<input
								id="adjustment-customer-id"
								type="text"
								value={customerId()}
								onInput={(e) => setCustomerId(e.currentTarget.value)}
								placeholder="e.g. cust_123 or GID"
								required
							/>
						</div>

						<div class="field">
							<label for="adjustment-type">
								<strong>Adjustment Type</strong>
							</label>
							<select
								id="adjustment-type"
								value={adjustmentType()}
								onChange={(e) =>
									setAdjustmentType(
										e.currentTarget.value as BillingAdjustmentType,
									)
								}
							>
								<For each={BILLING_ADJUSTMENT_TYPES}>
									{(type) => (
										<option value={type}>{formatAdjustmentType(type)}</option>
									)}
								</For>
							</select>
						</div>

						<div class="field">
							<label for="adjustment-amount">
								<strong>Amount ($)</strong>
							</label>
							<input
								id="adjustment-amount"
								type="number"
								step="0.01"
								min="0.01"
								value={amountDollars()}
								onInput={(e) => setAmountDollars(e.currentTarget.value)}
								placeholder="0.00"
								required
							/>
						</div>

						<div class="field">
							<label for="adjustment-reason">
								<strong>Reason</strong>
							</label>
							<input
								id="adjustment-reason"
								type="text"
								value={reason()}
								onInput={(e) => setReason(e.currentTarget.value)}
								placeholder="e.g. Double payment refund or class credit"
								required
							/>
						</div>

						<div class="field">
							<label for="adjustment-reference-id">
								<strong>Reference ID</strong> (Order GID / Invoice ID)
							</label>
							<input
								id="adjustment-reference-id"
								type="text"
								value={referenceId()}
								onInput={(e) => setReferenceId(e.currentTarget.value)}
								placeholder="Optional reference identifier"
							/>
						</div>

						<div class="field">
							<label for="adjustment-decision-id">
								<strong>Approved Decision ID</strong>
							</label>
							<input
								id="adjustment-decision-id"
								type="text"
								value={approvedDecisionId()}
								onInput={(e) => setApprovedDecisionId(e.currentTarget.value)}
								placeholder="Optional governance / approval decision ID"
							/>
						</div>

						<div class="field">
							<label for="adjustment-notes">
								<strong>Notes</strong>
							</label>
							<textarea
								id="adjustment-notes"
								rows={2}
								value={notes()}
								onInput={(e) => setNotes(e.currentTarget.value)}
								placeholder="Optional internal ledger notes"
							/>
						</div>

						<div class="modal-actions">
							<button
								type="button"
								class="secondary-button"
								onClick={() => props.onClose()}
								disabled={isSubmitting()}
							>
								Cancel
							</button>
							<Button type="submit" disabled={isSubmitting()}>
								{isSubmitting() ? "Applying..." : "Apply Adjustment"}
							</Button>
						</div>
					</form>
				</section>
			</div>
		</Show>
	);
}
