import { createSignal, Show } from "solid-js";
import { Button } from "../components/Button.js";

export interface CustomerDropRegistrationModalProps {
	isOpen: boolean;
	registrationTitle: string;
	performerName?: string;
	isWaitlisted?: boolean;
	isSubmitting?: boolean;
	error?: string | null;
	onConfirm: (reason: string, requestRefund: boolean) => void;
	onClose: () => void;
}

export function CustomerDropRegistrationModal(
	props: CustomerDropRegistrationModalProps,
) {
	const [reason, setReason] = createSignal("");
	const [requestRefund, setRequestRefund] = createSignal(false);

	function handleSubmit(event: Event) {
		event.preventDefault();
		props.onConfirm(reason().trim(), requestRefund());
	}

	return (
		<Show when={props.isOpen}>
			<div
				class="modal-backdrop"
				role="dialog"
				aria-modal="true"
				aria-labelledby="drop-modal-title"
			>
				<div class="panel modal-card">
					<header class="admin-page-header">
						<div>
							<h3 id="drop-modal-title">Drop Registration</h3>
							<p class="muted">
								<Show
									when={props.isWaitlisted}
									fallback={`Are you sure you want to drop this registration for ${props.registrationTitle}?`}
								>
									{`You are about to remove this performer from the waitlist for ${props.registrationTitle}.`}
								</Show>
							</p>
						</div>
					</header>

					<Show when={props.performerName}>
						<p>
							Performer: <strong>{props.performerName}</strong>
						</p>
					</Show>

					<form class="flow-panel" onSubmit={handleSubmit}>
						<label class="field">
							<span>Reason for drop (optional)</span>
							<textarea
								rows={3}
								value={reason()}
								onInput={(e) => setReason(e.currentTarget.value)}
								placeholder="Let us know why you are dropping this registration..."
							/>
						</label>

						<Show when={!props.isWaitlisted}>
							<label
								class="field"
								style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;"
							>
								<input
									type="checkbox"
									checked={requestRefund()}
									onChange={(e) => setRequestRefund(e.currentTarget.checked)}
								/>
								<span>Request a refund for registration fee</span>
							</label>
						</Show>

						<Show when={props.error}>
							<p class="field-error" role="alert">
								{props.error}
							</p>
						</Show>

						<div
							class="button-row"
							style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem;"
						>
							<Button
								type="button"
								variant="secondary"
								disabled={props.isSubmitting}
								onClick={props.onClose}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								variant="primary"
								disabled={props.isSubmitting}
							>
								{props.isSubmitting ? "Dropping..." : "Confirm Drop"}
							</Button>
						</div>
					</form>
				</div>
			</div>
		</Show>
	);
}
