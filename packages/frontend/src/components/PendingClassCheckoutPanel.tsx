import type { PendingClassCheckoutDto } from "@festival/common";
import { For, Show } from "solid-js";
import type { PendingCheckoutState } from "../domains/customer/pending-checkout-state.js";
import { buildFestivalCartPath } from "../lib/routes.js";
import type { RegistrationCartItem } from "../pages/registrationCartState.js";
import { Button } from "./Button.js";

function statusMessage(checkout: PendingClassCheckoutDto | null) {
	if (checkout?.reasonCode === "checkout_registration_review") {
		return "Payment received — your registration needs review";
	}
	if (checkout?.reasonCode === "checkout_buyer_refresh_required") {
		return "Sign-in needs to be refreshed for this checkout. Continue checkout to reconnect it.";
	}
	switch (checkout?.state) {
		case "ready":
			return "You have an unfinished checkout.";
		case "payment_pending":
			return "Payment pending";
		case "partially_paid":
			return "Your checkout is partially paid.";
		case "processing":
			return "Payment received — confirming registration";
		default:
			return "Checkout status needs checking";
	}
}

export function PendingClassCheckoutPanel(props: {
	pending: PendingCheckoutState;
	slug: string;
	festivalSlug: string;
	showDetails: boolean;
	savedSelections: RegistrationCartItem[];
	navigate: (path: string) => void;
	onResume: () => void;
}) {
	const pending = props.pending;
	const checkout = pending.checkout;
	const owningCartPath = () =>
		buildFestivalCartPath(
			props.slug,
			checkout()?.festivalShortName ?? props.festivalSlug,
		);
	const registrations = () =>
		checkout()?.registrations ?? props.savedSelections;
	return (
		<Show when={pending.isBlocked()}>
			<section
				class="parent-panel parent-warning"
				aria-label="Unfinished checkout"
			>
				<h2 role="status">
					{pending.isChecking()
						? "Checking your checkout status…"
						: statusMessage(checkout())}
				</h2>
				<p>
					View your cart to continue or resolve it before adding registrations.
				</p>
				<Show when={checkout()?.state === "processing"}>
					<p>We are waiting for your registrations to be confirmed.</p>
				</Show>
				<Show when={checkout()?.state === "needs_review"}>
					<p>
						Contact the festival office for help resolving this checkout. Give
						them checkout reference {checkout()?.recoveryReference}.
					</p>
				</Show>
				<Show
					when={
						checkout()?.state === "payment_pending" ||
						checkout()?.state === "partially_paid"
					}
				>
					<p>
						Keep using the original order. Contact the festival office if you
						need help completing its payment.
					</p>
				</Show>
				<Show when={checkout()?.payment} keyed>
					{(payment) => (
						<>
							<Show when={pending.phase() !== "ready"}>
								<p class="muted">
									These are the last verified payment amounts.
								</p>
							</Show>
							<dl class="parent-summary">
								<dt>Amount received</dt>
								<dd>{`${payment.currencyCode} ${payment.receivedAmount}`}</dd>
								<dt>Balance remaining</dt>
								<dd>{`${payment.currencyCode} ${payment.outstandingAmount}`}</dd>
							</dl>
						</>
					)}
				</Show>
				<Show when={checkout()?.estimatedTotal} keyed>
					{(total) => (
						<p>
							{pending.phase() === "ready"
								? "Estimated total"
								: "Last verified estimate"}
							: {total.currencyCode} {total.amount}
						</p>
					)}
				</Show>
				<Show when={pending.error()}>
					<p class="field-error" role="alert">
						{pending.error()}
					</p>
				</Show>
				<div class="pending-checkout-actions">
					<Show
						when={
							!props.showDetails ||
							Boolean(
								checkout()?.festivalShortName &&
									checkout()?.festivalShortName !== props.festivalSlug,
							)
						}
					>
						<Button
							type="button"
							variant="secondary"
							onClick={() => props.navigate(owningCartPath())}
						>
							View unfinished checkout
						</Button>
					</Show>
					<Show when={checkout()?.resumeAllowed}>
						<Button
							type="button"
							disabled={pending.phase() !== "ready" || pending.isResuming()}
							onClick={props.onResume}
						>
							{pending.isResuming() ? "Opening checkout…" : "Continue checkout"}
						</Button>
					</Show>
					<Button
						type="button"
						variant="secondary"
						class="pending-checkout-refresh"
						aria-label="Check checkout status"
						title="Check checkout status"
						disabled={pending.isChecking() || pending.isResuming()}
						onClick={() => void pending.refresh()}
					>
						<svg
							viewBox="0 0 24 24"
							width="20"
							height="20"
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M21 12a9 9 0 1 1-2.39-6.1L21 8" />
							<path d="M21 3v5h-5" />
						</svg>
					</Button>
				</div>
				<Show when={props.showDetails}>
					<Show when={checkout()?.registrationCount != null}>
						<p>
							{checkout()?.registrationCount} registrations in this checkout
						</p>
					</Show>
					<Show when={registrations().length > 0}>
						<h3>
							{checkout()
								? "Saved registration details"
								: "Saved selections in this browser"}
						</h3>
						<For each={registrations()}>
							{(registration) => (
								<article class="parent-list-row">
									<div class="parent-row-main">
										<p class="parent-eyebrow">{registration.childName}</p>
										<h3>{registration.className}</h3>
										<p>
											{registration.divisionName} · {registration.teacherName}
										</p>
										<For each={registration.pieces}>
											{(piece) => (
												<p class="muted">
													{piece.title} · {piece.composer}
												</p>
											)}
										</For>
									</div>
								</article>
							)}
						</For>
					</Show>
				</Show>
			</section>
		</Show>
	);
}
