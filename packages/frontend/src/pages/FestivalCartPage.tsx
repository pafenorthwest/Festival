import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { CascadingRemovalModal } from "../components/CascadingRemovalModal.js";
import { FestivalCartItemRow } from "../components/FestivalCartItemRow.js";
import { getPublicFestival, startClassCheckout } from "../lib/api.js";
import { buildFestivalRegistrationPath } from "../lib/routes.js";
import { findDependentCartItems } from "./cascadingRemoval.js";
import { createPayloadCachedIdempotency } from "./checkoutIdempotency.js";
import {
	cartItemsToLineItemInputs,
	formatPriceCents,
	type RegistrationCartItem,
} from "./registrationCartState.js";
import { useCartEligibility } from "./useCartEligibility.js";

export interface FestivalCartPageProps {
	app: FestivalAppController;
	slug: string;
	festivalSlug: string;
}

export function FestivalCartPage(props: FestivalCartPageProps) {
	const cart = props.app.cart;
	const [festival] = createResource(
		() => [props.slug, props.festivalSlug] as const,
		([s, f]) => getPublicFestival(s, f),
	);
	const festivalName = () => festival()?.festival.name ?? "Festival";
	const getCsrf = () =>
		props.app.customerSession().authenticated
			? props.app.customerSession().csrfToken
			: "";

	const eligibility = useCartEligibility({
		slug: () => props.slug,
		festivalSlug: () => props.festivalSlug,
		csrfToken: getCsrf,
		cart,
	});

	const [isSubmitting, setIsSubmitting] = createSignal(false);
	const [checkoutError, setCheckoutError] = createSignal<string | null>(null);
	const idempotencyManager = createPayloadCachedIdempotency();
	const [cascadingTarget, setCascadingTarget] =
		createSignal<RegistrationCartItem | null>(null);
	const [cascadingDependents, setCascadingDependents] = createSignal<
		RegistrationCartItem[]
	>([]);
	const [isCascadingModalOpen, setIsCascadingModalOpen] = createSignal(false);

	const performerGroups = createMemo(() => {
		const groups: {
			childId: string;
			childName: string;
			items: RegistrationCartItem[];
			subtotalCents: number;
		}[] = [];
		const map = new Map<string, (typeof groups)[number]>();
		for (const item of cart.items()) {
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
	});

	const warningMsg = createMemo(() => {
		for (const item of cart.items()) {
			const res = eligibility.getResult(item.childId, item.classId);
			if (res && !res.isEligible) {
				const req =
					res.missingPrerequisite?.requiredSubtypeName ||
					res.dependencyDescriptor?.requiredSubtypeName;
				return req
					? `${item.childName}’s ${item.className} is missing a required prerequisite (${req}). Restore a qualifying registration or remove the class to continue.`
					: `${item.childName}’s ${item.className} is missing a prerequisite.`;
			}
		}
		return "One or more registrations are missing prerequisites. Restore qualifying registrations or remove them to continue.";
	});

	function handleRemoveClick(item: RegistrationCartItem) {
		const deps = findDependentCartItems(
			item.lineId,
			cart.items(),
			eligibility.getResult,
		);
		if (deps.length > 0) {
			setCascadingTarget(item);
			setCascadingDependents(deps);
			setIsCascadingModalOpen(true);
		} else {
			cart.removeItem(item.lineId);
		}
	}

	function handleConfirmRemoveAll() {
		const target = cascadingTarget();
		if (target) {
			const ids = [
				target.lineId,
				...cascadingDependents().map((d) => d.lineId),
			];
			if (typeof cart.removeItems === "function") cart.removeItems(ids);
			else {
				for (const id of ids) cart.removeItem(id);
			}
		}
		setIsCascadingModalOpen(false);
		setCascadingTarget(null);
		setCascadingDependents([]);
	}

	const isCheckoutDisabled = () =>
		isSubmitting() ||
		cart.itemCount() === 0 ||
		eligibility.isEvaluating() ||
		eligibility.hasIneligibleItems() ||
		Boolean(eligibility.error());

	async function handleCheckout() {
		const items = cart.items();
		if (isCheckoutDisabled()) return;
		setIsSubmitting(true);
		setCheckoutError(null);
		try {
			const lineItems = cartItemsToLineItemInputs(items);
			const idempotencyKey = idempotencyManager.getOrGenerateKey(lineItems);
			const res = await startClassCheckout(props.slug, props.festivalSlug, {
				lineItems,
				csrfToken: getCsrf(),
				idempotencyKey,
			});
			if (res?.checkoutUrl) {
				idempotencyManager.clear();
				cart.clearCart();
				if (typeof window !== "undefined" && window.location?.assign)
					window.location.assign(res.checkoutUrl);
				return;
			}
			setCheckoutError("Checkout failed to initialize. Please try again.");
		} catch (err) {
			setCheckoutError(
				err instanceof Error
					? err.message
					: "Checkout failed. Please try again.",
			);
		} finally {
			setIsSubmitting(false);
		}
	}

	const continueUrl = () =>
		buildFestivalRegistrationPath(props.slug, props.festivalSlug);

	return (
		<main id="main" class="main">
			<div class="page-heading">
				<p class="eyebrow">{festivalName().toUpperCase()}</p>
				<h1>Your cart</h1>
				<p class="muted">Review your family’s registrations before checkout.</p>
			</div>

			<div
				class="warning"
				id="cart-warning"
				role="status"
				hidden={!eligibility.hasIneligibleItems()}
			>
				<strong>A prerequisite is missing.</strong>
				<p>{warningMsg()}</p>
			</div>

			<Show when={checkoutError()}>
				<div
					class="panel flow-panel cart-checkout-error-banner"
					role="alert"
					style="margin-bottom: 1.5rem; background: #fff5f5; border: 1px solid #fed7d7; color: #c53030; padding: 0.75rem; border-radius: 6px;"
				>
					<p class="field-error" role="alert" style="margin: 0;">
						{checkoutError()}
					</p>
				</div>
			</Show>

			<Show
				when={cart.itemCount() > 0}
				fallback={
					<section
						class="panel flow-panel"
						style="padding: 2rem; text-align: center;"
					>
						<p class="muted" style="margin-bottom: 1rem;">
							Your registration cart is empty.
						</p>
						<a class="text-link continue-link" href={continueUrl()}>
							← Continue registration
						</a>
					</section>
				}
			>
				<div class="content-grid">
					<section class="panel cart-items" aria-label="Cart registrations">
						<For each={performerGroups()}>
							{(group) => (
								<For each={group.items}>
									{(item) => (
										<FestivalCartItemRow
											item={item}
											childName={group.childName}
											isSubmitting={isSubmitting()}
											eligibility={eligibility}
											onRemove={handleRemoveClick}
										/>
									)}
								</For>
							)}
						</For>
					</section>

					<aside class="side-summary">
						<section class="panel">
							<p class="eyebrow">ORDER SUMMARY</p>
							<h2>
								<span data-cart-item-count>{cart.itemCount()}</span>{" "}
								{cart.itemCount() === 1 ? "registration" : "registrations"}
							</h2>
							<dl class="summary-grid">
								<For each={performerGroups()}>
									{(group) => (
										<>
											<dt>{group.childName}</dt>
											<dd>{formatPriceCents(group.subtotalCents)}</dd>
										</>
									)}
								</For>
							</dl>
							<div class="total-row">
								<span>Total</span>
								<strong data-cart-total>{cart.totalPriceFormatted()}</strong>
							</div>
							<button
								class="button full-width"
								id="checkout-button"
								type="button"
								disabled={isCheckoutDisabled()}
								onClick={handleCheckout}
							>
								{isSubmitting()
									? "Starting checkout…"
									: eligibility.isEvaluating()
										? "Evaluating eligibility…"
										: eligibility.hasIneligibleItems()
											? "Resolve Ineligible Items"
											: "Proceed to Checkout"}
							</button>
							<p class="muted small-copy">
								You’ll complete payment securely with Shopify. Availability is
								checked again before checkout.
							</p>
						</section>
						<a class="text-link continue-link" href={continueUrl()}>
							← Continue registration
						</a>
					</aside>
				</div>
			</Show>
			<p class="page-footnote">
				Need to change a class, teacher, or repertoire before payment? Remove
				that registration and add it again.
			</p>

			<CascadingRemovalModal
				isOpen={isCascadingModalOpen()}
				targetItem={cascadingTarget()}
				dependentItems={cascadingDependents()}
				isSubmitting={isSubmitting()}
				onConfirmRemoveAll={handleConfirmRemoveAll}
				onCancel={() => {
					setIsCascadingModalOpen(false);
					setCascadingTarget(null);
					setCascadingDependents([]);
				}}
			/>
		</main>
	);
}
