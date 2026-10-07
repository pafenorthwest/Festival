import type { ClassEligibilityResult } from "@festival/common";
import { createSignal, For, Show } from "solid-js";
import { findDependentCartItems } from "../pages/cascadingRemoval.js";
import { formatTotalDuration } from "../pages/festivalRegistrationHelpers.js";
import {
	formatPriceCents,
	type RegistrationCartItem,
	type RegistrationCartState,
} from "../pages/registrationCartState.js";
import type { CartEligibilityState } from "../pages/useCartEligibility.js";
import { Button } from "./Button.js";
import { CascadingRemovalModal } from "./CascadingRemovalModal.js";

export interface FestivalRegistrationCartViewProps {
	cart: RegistrationCartState;
	eligibility?: CartEligibilityState;
	isSubmitting: boolean;
	error: string | null;
	onSubmitCheckout: () => void;
	findDependents?: (
		targetLineId: string,
		cartItems: RegistrationCartItem[],
		getResult?: (
			childId: string,
			classId: string,
		) => ClassEligibilityResult | undefined,
	) => RegistrationCartItem[];
}

export function FestivalRegistrationCartView(
	props: FestivalRegistrationCartViewProps,
) {
	const count = () => props.cart.itemCount();
	const isEvaluating = () => Boolean(props.eligibility?.isEvaluating());
	const hasIneligible = () => Boolean(props.eligibility?.hasIneligibleItems());
	const isCheckoutDisabled = () =>
		props.isSubmitting ||
		count() === 0 ||
		isEvaluating() ||
		hasIneligible() ||
		Boolean(props.eligibility?.error());

	const [cascadingTarget, setCascadingTarget] =
		createSignal<RegistrationCartItem | null>(null);
	const [cascadingDependents, setCascadingDependents] = createSignal<
		RegistrationCartItem[]
	>([]);
	const [isCascadingModalOpen, setIsCascadingModalOpen] = createSignal(false);

	const performerGroups = () => {
		const groups: {
			childId: string;
			childName: string;
			items: RegistrationCartItem[];
			subtotalCents: number;
		}[] = [];
		const map = new Map<string, (typeof groups)[number]>();
		for (const item of props.cart.items()) {
			let group = map.get(item.childId);
			if (!group) {
				group = {
					childId: item.childId,
					childName: item.childName,
					items: [],
					subtotalCents: 0,
				};
				map.set(item.childId, group);
				groups.push(group);
			}
			group.items.push(item);
			group.subtotalCents += item.priceCents;
		}
		return groups;
	};

	function handleRemoveClick(item: RegistrationCartItem) {
		const detector = props.findDependents ?? findDependentCartItems;
		const dependents = detector(
			item.lineId,
			props.cart.items(),
			props.eligibility?.getResult,
		);

		if (dependents.length > 0) {
			setCascadingTarget(item);
			setCascadingDependents(dependents);
			setIsCascadingModalOpen(true);
		} else {
			props.cart.removeItem(item.lineId);
		}
	}

	function handleConfirmRemoveAll() {
		const target = cascadingTarget();
		const dependents = cascadingDependents();
		if (target) {
			const lineIds = [target.lineId, ...dependents.map((d) => d.lineId)];
			if (typeof props.cart.removeItems === "function") {
				props.cart.removeItems(lineIds);
			} else {
				for (const lineId of lineIds) {
					props.cart.removeItem(lineId);
				}
			}
		}
		setIsCascadingModalOpen(false);
		setCascadingTarget(null);
		setCascadingDependents([]);
	}

	function handleCancelCascadingRemoval() {
		setIsCascadingModalOpen(false);
		setCascadingTarget(null);
		setCascadingDependents([]);
	}

	return (
		<section
			class="panel flow-panel registration-cart-panel"
			aria-labelledby="multi-cart-heading"
		>
			<header
				class="admin-page-header"
				style="display: flex; justify-content: space-between; align-items: flex-start;"
			>
				<div>
					<h3 id="multi-cart-heading">
						Registration Cart ({count()} {count() === 1 ? "item" : "items"})
					</h3>
					<p class="muted">
						Review selected classes before proceeding to checkout.
					</p>
				</div>
				<Show when={count() > 0}>
					<Button
						type="button"
						variant="secondary"
						disabled={props.isSubmitting}
						onClick={props.cart.clearCart}
					>
						Clear Cart
					</Button>
				</Show>
			</header>

			<Show when={hasIneligible()}>
				<div
					class="panel flow-panel cart-ineligible-banner"
					role="alert"
					style="background: #fff3cd; border: 1px solid #ffeeba; color: #856404; padding: 0.75rem; margin-bottom: 0.75rem;"
				>
					<strong>Action Required:</strong> One or more items in your cart are
					not eligible for registration. Please review prerequisites and remove
					ineligible items to continue.
				</div>
			</Show>

			<Show when={props.eligibility?.error()}>
				<p
					class="field-error cart-eligibility-error"
					role="alert"
					style="margin-bottom: 0.75rem;"
				>
					Eligibility check failed: {props.eligibility?.error()}
				</p>
			</Show>

			<Show
				when={count() > 0}
				fallback={<p class="muted">Your registration cart is empty.</p>}
			>
				<div style="display: grid; gap: 1rem;">
					<For each={performerGroups()}>
						{(group) => (
							<div
								class="panel flow-panel cart-performer-group"
								style="background: rgba(255, 255, 255, 0.45); border: 1px solid var(--bullet-panel-border); padding: 0.75rem; border-radius: 6px; display: grid; gap: 0.75rem;"
							>
								<div
									class="cart-performer-group-header"
									style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--bullet-panel-border); padding-bottom: 0.5rem;"
								>
									<div>
										<strong>Performer: {group.childName}</strong>
										<span
											class="muted"
											style="margin-left: 0.5rem; font-size: 0.85rem;"
										>
											({group.items.length}{" "}
											{group.items.length === 1 ? "class" : "classes"})
										</span>
									</div>
									<span style="font-weight: 600; font-size: 0.9rem;">
										Performer Subtotal: {formatPriceCents(group.subtotalCents)}
									</span>
								</div>

								<div style="display: grid; gap: 0.75rem;">
									<For each={group.items}>
										{(item) => {
											const itemResult = () =>
												props.eligibility?.getResult(
													item.childId,
													item.classId,
												);
											const missingSubtype = () => {
												const r = itemResult();
												return (
													r?.missingPrerequisite?.requiredSubtypeName ||
													r?.dependencyDescriptor?.requiredSubtypeName
												);
											};

											return (
												<div
													class="panel flow-panel"
													style="background: rgba(255, 255, 255, 0.65); padding: 0.75rem;"
												>
													<div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--bullet-panel-border); padding-bottom: 0.5rem; margin-bottom: 0.5rem;">
														<div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
															<strong>{item.className}</strong>
															<span class="muted">
																{formatPriceCents(item.priceCents)}
															</span>
															<Show when={props.eligibility}>
																<Show when={isEvaluating()}>
																	<span
																		class="badge badge-neutral"
																		style="font-size: 0.75rem; padding: 0.15rem 0.5rem;"
																	>
																		Evaluating…
																	</span>
																</Show>
																<Show
																	when={
																		!isEvaluating() && itemResult()?.isEligible
																	}
																>
																	<span
																		class="badge badge-active"
																		style="font-size: 0.75rem; padding: 0.15rem 0.5rem;"
																	>
																		✓ Eligible
																	</span>
																</Show>
															</Show>
														</div>
														<Button
															type="button"
															variant="secondary"
															disabled={props.isSubmitting}
															onClick={() => handleRemoveClick(item)}
														>
															Remove
														</Button>
													</div>

													<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.25rem; font-size: 0.9rem;">
														<div>
															<span class="muted">Performer: </span>
															<strong>{item.childName}</strong>
														</div>
														<div>
															<span class="muted">Division: </span>
															<strong>{item.divisionName}</strong>
														</div>
														<div>
															<span class="muted">Teacher: </span>
															<strong>{item.teacherName}</strong>
														</div>
														<div>
															<span class="muted">Accompanist: </span>
															<strong>{item.accompanistName ?? "None"}</strong>
														</div>
													</div>

													<Show when={item.pieces.length > 0}>
														<div style="margin-top: 0.5rem; font-size: 0.85rem;">
															<span class="muted">
																Repertoire ({item.pieces.length}{" "}
																{item.pieces.length === 1 ? "piece" : "pieces"}{" "}
																· {formatTotalDuration(item.pieces)}):
															</span>
															<ul style="margin: 0.25rem 0 0 0; padding-left: 1.2rem;">
																<For each={item.pieces}>
																	{(piece) => (
																		<li>
																			<em>{piece.title}</em> by{" "}
																			<strong>{piece.composer}</strong>
																			{piece.movement
																				? ` (${piece.movement})`
																				: ""}{" "}
																			·{" "}
																			{Math.floor(
																				(piece.durationSeconds || 0) / 60,
																			)}
																			m {(piece.durationSeconds || 0) % 60}s
																		</li>
																	)}
																</For>
															</ul>
														</div>
													</Show>

													<Show
														when={
															!isEvaluating() &&
															itemResult() &&
															!itemResult()?.isEligible
														}
													>
														<div
															class="field-error cart-item-ineligible-alert"
															role="alert"
															style="margin-top: 0.5rem; font-size: 0.85rem;"
														>
															<strong>Ineligible: </strong>
															<span>
																{missingSubtype()
																	? `Missing prerequisite subtype "${missingSubtype()}" in the same division and age group.`
																	: itemResult()?.message ||
																		"Performer is not eligible for this class."}
															</span>
														</div>
													</Show>
												</div>
											);
										}}
									</For>
								</div>
							</div>
						)}
					</For>
				</div>

				<div
					class="panel flow-panel cart-fee-breakdown-panel"
					style="margin-top: 1rem; padding: 0.75rem; background: var(--surface-secondary, rgba(0, 0, 0, 0.03)); border: 1px solid var(--bullet-panel-border); border-radius: 6px;"
				>
					<div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.95rem; margin-bottom: 0.5rem;">
						<span>
							{count()} {count() === 1 ? "entry" : "entries"} across{" "}
							{performerGroups().length}{" "}
							{performerGroups().length === 1 ? "performer" : "performers"}
						</span>
						<span>
							Registration Fee Subtotal: {props.cart.totalPriceFormatted()}
						</span>
					</div>
					<div style="display: flex; justify-content: space-between; align-items: center; padding-top: 0.5rem; border-top: 1px solid var(--bullet-panel-border);">
						<span style="font-size: 1.1rem; font-weight: bold;">
							Total: {props.cart.totalPriceFormatted()}
						</span>
						<Button
							type="button"
							disabled={isCheckoutDisabled()}
							onClick={props.onSubmitCheckout}
						>
							{props.isSubmitting
								? "Starting checkout…"
								: isEvaluating()
									? "Evaluating eligibility…"
									: hasIneligible()
										? "Resolve Ineligible Items"
										: `Proceed to Checkout (${props.cart.totalPriceFormatted()})`}
						</Button>
					</div>
				</div>
			</Show>

			<Show when={props.error}>
				<div
					class="panel flow-panel cart-checkout-error-banner"
					role="alert"
					style="margin-top: 0.75rem; padding: 0.75rem; background: #fff5f5; border: 1px solid #fed7d7; color: #c53030; border-radius: 6px;"
				>
					<p
						class="field-error"
						role="alert"
						style="margin: 0; font-weight: 500;"
					>
						{props.error}
					</p>
				</div>
			</Show>

			<CascadingRemovalModal
				isOpen={isCascadingModalOpen()}
				targetItem={cascadingTarget()}
				dependentItems={cascadingDependents()}
				isSubmitting={props.isSubmitting}
				onConfirmRemoveAll={handleConfirmRemoveAll}
				onCancel={handleCancelCascadingRemoval}
			/>
		</section>
	);
}
