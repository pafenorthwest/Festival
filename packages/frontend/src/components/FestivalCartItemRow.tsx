import { Show } from "solid-js";
import { formatTotalDuration } from "../pages/festivalRegistrationHelpers.js";
import {
	formatPriceCents,
	type RegistrationCartItem,
} from "../pages/registrationCartState.js";
import type { useCartEligibility } from "../pages/useCartEligibility.js";

export interface FestivalCartItemRowProps {
	item: RegistrationCartItem;
	childName: string;
	isSubmitting: boolean;
	eligibility: ReturnType<typeof useCartEligibility>;
	onRemove: (item: RegistrationCartItem) => void;
}

export function FestivalCartItemRow(props: FestivalCartItemRowProps) {
	const res = () =>
		props.eligibility.getResult(props.item.childId, props.item.classId);
	const isEligible = () =>
		!props.eligibility.isEvaluating() && res()?.isEligible;
	const isPrereqSatisfied = () =>
		res()?.satisfiedPrerequisites?.some(
			(p) => p.satisfiedBy === "proposed_item",
		);
	const subtitle = [
		props.item.divisionName,
		props.item.minimumAge !== undefined && props.item.maximumAge !== undefined
			? `Ages ${props.item.minimumAge}–${props.item.maximumAge}`
			: null,
		props.item.teacherName,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<article
			class="list-row"
			data-cart-item={props.item.lineId}
			data-price={props.item.priceCents / 100}
		>
			<div class="row-main">
				<p class="eyebrow">{props.childName.toUpperCase()}</p>
				<h2>{props.item.className}</h2>
				<p>{subtitle}</p>
				<Show when={props.item.pieces.length > 0}>
					<p class="muted">
						{props.item.pieces
							.map((p) => `${p.title}${p.composer ? ` · ${p.composer}` : ""}`)
							.join(", ")}{" "}
						· {formatTotalDuration(props.item.pieces)}
					</p>
				</Show>
				<Show when={props.eligibility.isEvaluating()}>
					<span class="badge status-neutral">Evaluating…</span>
				</Show>
				<Show when={isEligible()}>
					<span class="badge status-available">
						{isPrereqSatisfied()
							? "Prerequisite satisfied by registration in cart"
							: "Ready for checkout"}
					</span>
				</Show>
				<Show
					when={
						!props.eligibility.isEvaluating() && res() && !res()?.isEligible
					}
				>
					<span class="badge status-warning">
						{res()?.missingPrerequisite?.requiredSubtypeName
							? `Prerequisite missing: ${res()?.missingPrerequisite?.requiredSubtypeName}`
							: res()?.message || "Ineligible"}
					</span>
				</Show>
			</div>
			<div class="row-actions">
				<strong>{formatPriceCents(props.item.priceCents)}</strong>
				<button
					class="text-link"
					type="button"
					disabled={props.isSubmitting}
					onClick={() => props.onRemove(props.item)}
				>
					Remove
				</button>
			</div>
		</article>
	);
}
