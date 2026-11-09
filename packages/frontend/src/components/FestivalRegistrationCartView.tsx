import { For, Show } from "solid-js";
import { formatTotalDuration } from "../pages/festivalRegistrationHelpers.js";
import {
	formatPriceCents,
	type RegistrationCartState,
} from "../pages/registrationCartState.js";
import type { CartEligibilityState } from "../pages/useCartEligibility.js";
import { Button } from "./Button.js";

export interface FestivalRegistrationCartViewProps {
	cart: RegistrationCartState;
	eligibility?: CartEligibilityState;
	isSubmitting: boolean;
	error: string | null;
	onSubmitCheckout: () => void;
	onRefreshCheckout?: () => void;
	onRestartCheckout?: () => void;
	canRestoreCheckout?: boolean;
	onRestoreCheckout?: () => void;
}

export function FestivalRegistrationCartView(
	props: FestivalRegistrationCartViewProps,
) {
	const groups = () => {
		const map = new Map<string, { childName: string; subtotal: number }>();
		for (const item of props.cart.items()) {
			const group = map.get(item.childId) ?? {
				childName: item.childName,
				subtotal: 0,
			};
			group.subtotal += item.priceCents;
			map.set(item.childId, group);
		}
		return [...map.values()];
	};
	const disabled = () =>
		props.isSubmitting ||
		props.cart.itemCount() === 0 ||
		Boolean(
			props.cart.checkoutRecovery() &&
				!props.cart.checkoutRecovery()?.retryAllowed,
		) ||
		(!props.cart.checkoutSubmission() && !props.eligibility?.isCartEligible());
	return (
		<section aria-label="Registration cart">
			<Show when={props.cart.checkoutRecovery()}>
				{(recovery) => (
					<div class="parent-note parent-warning" role="status">
						<p>
							Your registrations are saved while we check the existing checkout.
							Please keep this reference when contacting the festival office:{" "}
							{recovery().recoveryReference}.
						</p>
						<Button
							type="button"
							variant="secondary"
							disabled={props.isSubmitting}
							onClick={props.onRefreshCheckout}
						>
							Check checkout status
						</Button>
						<Show
							when={
								!props.canRestoreCheckout &&
								recovery().status === "resolved" &&
								["abandoned_unknown", "checkout_abandoned"].includes(
									recovery().reasonCode,
								)
							}
						>
							<p>
								The festival office has closed the previous attempt. Your
								registrations remain here so you can start a new checkout.
							</p>
							<Button
								type="button"
								variant="secondary"
								disabled={props.isSubmitting}
								onClick={props.onRestartCheckout}
							>
								Start a new checkout
							</Button>
						</Show>
					</div>
				)}
			</Show>
			<Show when={props.canRestoreCheckout}>
				<div class="parent-note parent-warning">
					<p>Restore your saved registrations to review before checking out.</p>
					<Button
						type="button"
						variant="secondary"
						disabled={props.isSubmitting}
						onClick={props.onRestoreCheckout}
					>
						{props.cart.checkoutRecovery()?.restartAllowed
							? "Start a new checkout"
							: "Restore saved registrations"}
					</Button>
				</div>
			</Show>
			<Show when={props.eligibility?.hasIneligibleItems()}>
				<div
					class="parent-note parent-warning cart-ineligible-banner"
					role="alert"
				>
					Some registrations cannot be checked out. They remain in your cart
					while you restore a prerequisite or remove the affected item.
				</div>
			</Show>
			<Show when={props.eligibility?.error()}>
				<div
					class="parent-note parent-warning cart-eligibility-error"
					role="alert"
				>
					{props.eligibility?.error()}{" "}
					<Button
						type="button"
						variant="secondary"
						onClick={() => void props.eligibility?.recheck()}
					>
						Retry eligibility
					</Button>
				</div>
			</Show>
			<Show when={props.error}>
				<p class="field-error cart-checkout-error-banner" role="alert">
					{props.error}
				</p>
			</Show>
			<Show
				when={props.cart.itemCount() > 0}
				fallback={
					<div class="parent-panel">
						<h2>Your cart is empty</h2>
						<p>Choose a class in Registration to get started.</p>
					</div>
				}
			>
				<div class="parent-content-grid">
					<div class="parent-panel">
						<For each={props.cart.items()}>
							{(item) => {
								const result = () =>
									props.eligibility?.getResult(item.childId, item.classId);
								return (
									<article class="parent-list-row">
										<div class="parent-row-main">
											<p class="parent-eyebrow">{item.childName}</p>
											<h2>{item.className}</h2>
											<p>
												{item.divisionName} · {item.teacherName}
												{item.instrumentName ? ` · ${item.instrumentName}` : ""}
											</p>
											<For each={item.pieces}>
												{(piece) => (
													<p class="muted">
														{piece.title} · {piece.composer}
														{piece.movement ? ` · ${piece.movement}` : ""} ·{" "}
														{formatTotalDuration([piece])}
													</p>
												)}
											</For>
											<Show when={item.accompanistName}>
												<p class="muted">Accompanist: {item.accompanistName}</p>
											</Show>
											<Show when={result() && !result()?.isEligible}>
												<p
													class="field-error cart-item-ineligible-alert"
													role="alert"
												>
													{result()?.message ||
														"This registration is no longer eligible."}
												</p>
											</Show>
											<Show when={result()?.isEligible}>
												<span class="parent-badge parent-status-available">
													Ready for checkout
												</span>
											</Show>
										</div>
										<div class="parent-row-actions">
											<strong>{formatPriceCents(item.priceCents)}</strong>
											<Button
												type="button"
												variant="secondary"
												disabled={
													props.isSubmitting ||
													Boolean(props.cart.checkoutSubmission())
												}
												onClick={() => props.cart.removeItem(item.lineId)}
											>
												Remove
											</Button>
										</div>
									</article>
								);
							}}
						</For>
					</div>
					<aside class="parent-side-summary parent-panel">
						<p class="parent-eyebrow">Order summary</p>
						<h2>{props.cart.itemCount()} registrations</h2>
						<dl class="parent-summary">
							<For each={groups()}>
								{(group) => (
									<>
										<dt>{group.childName}</dt>
										<dd>{formatPriceCents(group.subtotal)}</dd>
									</>
								)}
							</For>
							<dt>
								<strong>Total</strong>
							</dt>
							<dd>
								<strong>{props.cart.totalPriceFormatted()}</strong>
							</dd>
						</dl>
						<Button
							type="button"
							disabled={disabled()}
							onClick={props.onSubmitCheckout}
						>
							{props.isSubmitting
								? "Starting checkout…"
								: props.eligibility?.isEvaluating()
									? "Evaluating eligibility…"
									: "Continue to Checkout"}
						</Button>
						<p class="muted">
							Payment is completed securely with Shopify. Availability is
							checked again before checkout.
						</p>
					</aside>
				</div>
			</Show>
		</section>
	);
}
