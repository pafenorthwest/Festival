import { For, Show } from "solid-js";
import {
	formatPriceCents,
	type RegistrationCartItem,
} from "../pages/registrationCartState.js";
import { Button } from "./Button.js";

export interface CascadingRemovalModalProps {
	isOpen: boolean;
	targetItem: RegistrationCartItem | null;
	dependentItems: RegistrationCartItem[];
	isSubmitting?: boolean;
	onConfirmRemoveAll: () => void;
	onCancel: () => void;
}

export function CascadingRemovalModal(props: CascadingRemovalModalProps) {
	const count = () => props.dependentItems.length;
	const targetName = () => props.targetItem?.className ?? "Prerequisite class";

	return (
		<Show when={props.isOpen && props.targetItem}>
			<div
				class="modal-backdrop cascading-removal-backdrop"
				role="presentation"
			>
				<section
					class="panel modal-card cascading-removal-modal"
					role="dialog"
					aria-modal="true"
					aria-labelledby="cascading-removal-title"
					aria-describedby="cascading-removal-description"
				>
					<header class="admin-page-header">
						<div>
							<h3 id="cascading-removal-title">Remove Prerequisite Class?</h3>
							<p id="cascading-removal-description" class="muted">
								Removing prerequisite class <strong>{targetName()}</strong> will
								also invalidate and remove dependent classes for{" "}
								<strong>{props.targetItem?.childName}</strong>.
							</p>
						</div>
					</header>

					<div
						class="panel flow-panel cascading-removal-warning"
						role="alert"
						style="background: #fff3cd; border: 1px solid #ffeeba; color: #856404; padding: 0.75rem; margin-bottom: 0.75rem; border-radius: 4px;"
					>
						<strong>Warning: </strong>
						The following{" "}
						{count() === 1 ? "class requires" : `${count()} classes require`}{" "}
						<strong>{targetName()}</strong> as a prerequisite and cannot remain
						in the cart without it:
					</div>

					<ul
						class="cascading-dependents-list"
						style="margin: 0 0 1rem 0; padding-left: 1.25rem; font-size: 0.9rem;"
					>
						<For each={props.dependentItems}>
							{(dep) => (
								<li style="margin-bottom: 0.35rem;">
									<strong>{dep.className}</strong>
									<Show when={dep.divisionName}>
										<span class="muted"> ({dep.divisionName})</span>
									</Show>
									<span class="muted">
										{" "}
										— {formatPriceCents(dep.priceCents)}
									</span>
								</li>
							)}
						</For>
					</ul>

					<div
						class="button-row"
						style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem; border-top: 1px solid var(--bullet-panel-border); padding-top: 0.75rem;"
					>
						<Button
							type="button"
							variant="secondary"
							disabled={props.isSubmitting}
							onClick={props.onCancel}
							data-testid="cancel-cascading-removal"
						>
							Cancel
						</Button>
						<Button
							type="button"
							variant="primary"
							disabled={props.isSubmitting}
							onClick={props.onConfirmRemoveAll}
							data-testid="confirm-cascading-removal"
						>
							{`Remove All (${targetName()} + dependents)`}
						</Button>
					</div>
				</section>
			</div>
		</Show>
	);
}
