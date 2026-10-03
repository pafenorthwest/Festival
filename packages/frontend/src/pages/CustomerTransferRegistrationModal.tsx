import { createMemo, createSignal, For, Show } from "solid-js";
import { Button } from "../components/Button.js";

export interface ClassOption {
	id: string;
	displayName: string;
}

export interface CustomerTransferRegistrationModalProps {
	isOpen: boolean;
	registrationTitle: string;
	performerName?: string;
	currentFestivalClassId?: string;
	availableClasses: ClassOption[];
	isLoadingClasses?: boolean;
	isSubmitting?: boolean;
	error?: string | null;
	onConfirm: (targetFestivalClassId: string, reason: string) => void;
	onClose: () => void;
}

export function CustomerTransferRegistrationModal(
	props: CustomerTransferRegistrationModalProps,
) {
	const [targetClassId, setTargetClassId] = createSignal("");
	const [reason, setReason] = createSignal("");
	const [localError, setLocalError] = createSignal<string | null>(null);

	const eligibleClasses = createMemo(() =>
		props.availableClasses.filter((c) => c.id !== props.currentFestivalClassId),
	);

	function handleSubmit(event: Event) {
		event.preventDefault();
		setLocalError(null);
		const target = targetClassId().trim();
		if (!target) {
			setLocalError("Please select a target festival class.");
			return;
		}
		props.onConfirm(target, reason().trim());
	}

	return (
		<Show when={props.isOpen}>
			<div
				class="modal-backdrop"
				role="dialog"
				aria-modal="true"
				aria-labelledby="transfer-modal-title"
			>
				<div class="panel modal-card">
					<header class="admin-page-header">
						<div>
							<h3 id="transfer-modal-title">Transfer Registration</h3>
							<p class="muted">
								{`Transfer registration from ${props.registrationTitle} to a new class.`}
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
							<span>Select new festival class</span>
							<Show
								when={!props.isLoadingClasses}
								fallback={<p class="muted">Loading available classes...</p>}
							>
								<select
									value={targetClassId()}
									onChange={(e) => setTargetClassId(e.currentTarget.value)}
									required
								>
									<option value="">-- Choose a target class --</option>
									<For each={eligibleClasses()}>
										{(cls) => <option value={cls.id}>{cls.displayName}</option>}
									</For>
								</select>
							</Show>
						</label>

						<label class="field">
							<span>Reason for transfer (optional)</span>
							<textarea
								rows={3}
								value={reason()}
								onInput={(e) => setReason(e.currentTarget.value)}
								placeholder="Optional reason for transferring to another class..."
							/>
						</label>

						<Show when={localError() || props.error}>
							<p class="field-error" role="alert">
								{localError() ?? props.error}
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
								disabled={props.isSubmitting || props.isLoadingClasses}
							>
								{props.isSubmitting ? "Transferring..." : "Confirm Transfer"}
							</Button>
						</div>
					</form>
				</div>
			</div>
		</Show>
	);
}
