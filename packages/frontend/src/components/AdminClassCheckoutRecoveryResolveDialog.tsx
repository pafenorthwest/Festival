import type {
	AdminClassCheckoutRecoveryAction,
	AdminClassCheckoutRecoveryDto,
	AdminResolveClassCheckoutRecoveryInput,
} from "@festival/common";
import { createSignal, For, Show } from "solid-js";
import {
	availableResolveActions,
	buildResolveInput,
	cartEvidenceEvents,
	formatRecoveryCheckpoint,
	formatRecoveryReason,
	formatRecoveryTime,
	RECOVERY_REASON_MAX_LENGTH,
	requiresAbandonAcknowledgement,
	shortRecoveryReference,
} from "../pages/adminClassCheckoutRecoveryHelpers.js";
import { Button } from "./Button.js";
import { ModalBackdrop } from "./ModalBackdrop.js";

interface ResolveDialogProps {
	recovery: AdminClassCheckoutRecoveryDto;
	isSaving: boolean;
	error: string | null;
	onSubmit: (input: AdminResolveClassCheckoutRecoveryInput) => void;
	onCancel: () => void;
}

export function AdminClassCheckoutRecoveryResolveDialog(
	props: ResolveDialogProps,
) {
	const [action, setAction] = createSignal<
		AdminClassCheckoutRecoveryAction | ""
	>("");
	const [reason, setReason] = createSignal("");
	const [cartId, setCartId] = createSignal("");
	const [evidenceEventId, setEvidenceEventId] = createSignal("");
	const [acknowledged, setAcknowledged] = createSignal(false);
	const [validationError, setValidationError] = createSignal<string | null>(
		null,
	);

	const options = () => availableResolveActions(props.recovery);
	const evidenceEvents = () => cartEvidenceEvents(props.recovery);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		const result = buildResolveInput(props.recovery, {
			action: action(),
			reason: reason(),
			shopifyCartId: cartId(),
			evidenceEventId: evidenceEventId(),
			acknowledged: acknowledged(),
		});
		if (!result.ok) {
			setValidationError(result.error);
			return;
		}
		setValidationError(null);
		props.onSubmit(result.input);
	}

	return (
		<ModalBackdrop>
			<section
				class="modal-card panel flow-panel class-modal-card"
				role="dialog"
				aria-modal="true"
				aria-labelledby="resolve-recovery-title"
			>
				<header class="class-modal-header">
					<h3 id="resolve-recovery-title">Resolve checkout</h3>
					<p class="muted">
						{formatRecoveryReason(props.recovery.reasonCode)}.{" "}
						{formatRecoveryCheckpoint(props.recovery.checkpoint)}. Last updated{" "}
						{formatRecoveryTime(props.recovery.updatedAtIso)}. Reference{" "}
						<code title={props.recovery.recoveryReference}>
							{shortRecoveryReference(props.recovery.recoveryReference)}
						</code>
						.
					</p>
				</header>
				<form class="flow-panel" onSubmit={submit}>
					<fieldset class="field" disabled={props.isSaving}>
						<legend>What should happen?</legend>
						<For each={options()}>
							{(option) => (
								<label class="field-radio">
									<input
										type="radio"
										name="resolve-action"
										value={option.action}
										checked={action() === option.action}
										onChange={() => setAction(option.action)}
									/>
									<span>
										<strong>{option.label}</strong>
										<br />
										<span class="muted">{option.description}</span>
									</span>
								</label>
							)}
						</For>
					</fieldset>

					<Show when={action() === "adopt_cart"}>
						<Show when={evidenceEvents().length > 0}>
							<label class="field">
								<span>Cart recorded by an event</span>
								<select
									value={evidenceEventId()}
									disabled={props.isSaving || cartId().trim() !== ""}
									onChange={(e) => setEvidenceEventId(e.currentTarget.value)}
								>
									<option value="">Choose an event</option>
									<For each={evidenceEvents()}>
										{(event) => (
											<option value={event.id}>
												{event.eventType} (
												{formatRecoveryTime(event.createdAtIso)})
											</option>
										)}
									</For>
								</select>
							</label>
						</Show>
						<label class="field">
							<span>
								Shopify cart id{" "}
								<span class="muted">
									{props.recovery.checkpoint === "remote_cart_known"
										? "(optional, the known cart is used if empty)"
										: "(if you have it)"}
								</span>
							</span>
							<input
								type="text"
								value={cartId()}
								disabled={props.isSaving}
								onInput={(e) => setCartId(e.currentTarget.value)}
							/>
						</label>
					</Show>

					<label class="field">
						<span>Reason (kept in the audit trail)</span>
						<textarea
							rows="3"
							maxLength={RECOVERY_REASON_MAX_LENGTH}
							value={reason()}
							disabled={props.isSaving}
							onInput={(e) => setReason(e.currentTarget.value)}
						/>
						<span class="muted">
							{reason().length} of {RECOVERY_REASON_MAX_LENGTH} characters
						</span>
					</label>

					<Show
						when={
							action() === "abandon_unknown" &&
							requiresAbandonAcknowledgement(props.recovery)
						}
					>
						<label class="field-checkbox">
							<input
								type="checkbox"
								checked={acknowledged()}
								disabled={props.isSaving}
								onChange={(e) => setAcknowledged(e.currentTarget.checked)}
							/>
							<span>
								I understand the customer may already have paid or still hold a
								Shopify cart.
							</span>
						</label>
					</Show>

					<Show when={validationError() ?? props.error}>
						{(message) => (
							<p class="field-error" role="alert">
								{message()}
							</p>
						)}
					</Show>

					<div class="class-modal-actions">
						<Button type="submit" disabled={props.isSaving}>
							{props.isSaving ? "Resolving…" : "Resolve checkout"}
						</Button>
						<Button
							type="button"
							variant="secondary"
							disabled={props.isSaving}
							onClick={props.onCancel}
						>
							Cancel
						</Button>
					</div>
				</form>
			</section>
		</ModalBackdrop>
	);
}
