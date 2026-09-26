import type { RepertoirePiece } from "@festival/common";
import { For, Show } from "solid-js";
import { formatTotalDuration } from "../pages/festivalRegistrationHelpers.js";
import { Button } from "./Button.js";

interface FestivalRegistrationCartCardProps {
	childName: string | null;
	divisionName: string | null;
	teacherName: string | null;
	className: string | null;
	classPrice: string | null;
	pieces: RepertoirePiece[];
	accompanistName: string | null;
	isValid: boolean;
	isSubmitting: boolean;
	error: string | null;
	onOpenRepertoireModal: () => void;
	onSubmitCheckout: () => void;
}

export function FestivalRegistrationCartCard(
	props: FestivalRegistrationCartCardProps,
) {
	return (
		<section
			class="panel flow-panel registration-cart-panel"
			aria-labelledby="cart-heading"
		>
			<header class="admin-page-header">
				<div>
					<h3 id="cart-heading">Registration Summary</h3>
					<p class="muted">Review registration details before checkout.</p>
				</div>
			</header>

			<div
				class="panel flow-panel"
				style="background: rgba(255, 255, 255, 0.65);"
			>
				<div class="division-row-heading">
					<span>Performer:</span>
					<strong>{props.childName ?? "Not selected"}</strong>
				</div>
				<div class="division-row-heading">
					<span>Division:</span>
					<strong>{props.divisionName ?? "Not selected"}</strong>
				</div>
				<div class="division-row-heading">
					<span>Teacher:</span>
					<strong>{props.teacherName ?? "Not selected"}</strong>
				</div>
				<div class="division-row-heading">
					<span>Class:</span>
					<strong>
						{props.className
							? `${props.className} ($${props.classPrice})`
							: "Not selected"}
					</strong>
				</div>
				<div class="division-row-heading">
					<span>Accompanist:</span>
					<strong>{props.accompanistName ?? "None"}</strong>
				</div>

				<div style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--bullet-panel-border);">
					<div class="division-row-heading">
						<span>
							Repertoire ({props.pieces.length}{" "}
							{props.pieces.length === 1 ? "piece" : "pieces"}):
						</span>
						<Button
							type="button"
							variant="secondary"
							onClick={props.onOpenRepertoireModal}
						>
							{props.pieces.length > 0 ? "Edit repertoire" : "Add repertoire"}
						</Button>
					</div>

					<Show
						when={props.pieces.length > 0}
						fallback={
							<p class="field-error" style="margin: 0.5rem 0;">
								Repertoire pieces must be entered.
							</p>
						}
					>
						<ul style="margin: 0.5rem 0; padding-left: 1.2rem;">
							<For each={props.pieces}>
								{(piece) => (
									<li>
										<em>{piece.title}</em> by <strong>{piece.composer}</strong>
										{piece.movement ? ` (${piece.movement})` : ""} ·{" "}
										{Math.floor(piece.durationSeconds / 60)}m{" "}
										{piece.durationSeconds % 60}s
									</li>
								)}
							</For>
						</ul>
						<p class="muted" style="margin: 0; font-size: 0.85rem;">
							Total duration: {formatTotalDuration(props.pieces)}
						</p>
					</Show>
				</div>
			</div>

			<Show when={props.error}>
				<p class="field-error" role="alert">
					{props.error}
				</p>
			</Show>

			<div
				class="division-actions"
				style="justify-content: flex-end; margin-top: 1rem;"
			>
				<Button
					type="button"
					disabled={!props.isValid || props.isSubmitting}
					onClick={props.onSubmitCheckout}
				>
					{props.isSubmitting
						? "Starting checkout…"
						: `Proceed to Checkout ($${props.classPrice ?? "0.00"})`}
				</Button>
			</div>
		</section>
	);
}
