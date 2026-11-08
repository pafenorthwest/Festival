import type { RegistrationEligibleClass } from "@festival/common";
import { For, Show } from "solid-js";
import type { ClassOptionEligibilityState } from "../pages/useClassOptionEligibility.js";

export interface FestivalClassCardListProps {
	childName?: string | null;
	childAge?: number | null;
	divisionName?: string | null;
	classes: readonly RegistrationEligibleClass[];
	eligibility: ClassOptionEligibilityState;
	viewRegistrationsPath?: string;
	onSelectClass: (classId: string) => void;
}

function formatPrice(price: string): string {
	const parsed = parseFloat(price);
	if (Number.isNaN(parsed)) return price.startsWith("$") ? price : `$${price}`;
	return `$${parsed.toFixed(0)}`;
}

function getPiecesDescription(cls: RegistrationEligibleClass): string {
	const count = cls.maximumPerformancePieces ?? 1;
	const pieceText =
		count === 1
			? "One piece"
			: count === 2
				? "One or two pieces"
				: `Up to ${count} pieces`;
	if (cls.performanceMinutes) {
		return `${pieceText} · Up to ${cls.performanceMinutes} minutes`;
	}
	return pieceText;
}

function getAgeRangeText(cls: RegistrationEligibleClass): string {
	if (cls.minimumAge != null && cls.maximumAge != null) {
		return `Ages ${cls.minimumAge}–${cls.maximumAge}`;
	}
	return "";
}

export function FestivalClassCardList(props: FestivalClassCardListProps) {
	const headingTitle = () =>
		props.childName ? `Classes for ${props.childName}` : "Available Classes";

	const headingSubtitle = () => {
		const parts: string[] = [];
		if (props.divisionName) parts.push(props.divisionName);
		if (props.childAge != null) parts.push(`Ages ${props.childAge}`);
		return parts.join(" · ");
	};

	const countText = () => {
		const count = props.classes.length;
		return `${count} ${count === 1 ? "class" : "classes"}`;
	};

	return (
		<div>
			<div class="section-heading">
				<div>
					<h2>{headingTitle()}</h2>
					<Show when={headingSubtitle()}>
						<p class="muted">{headingSubtitle()}</p>
					</Show>
				</div>
				<span class="muted">{countText()}</span>
			</div>
			<section class="panel class-list" aria-label="Age-appropriate classes">
				<Show
					when={props.classes.length > 0}
					fallback={
						<p class="muted">
							No eligible classes found for the current selection.
						</p>
					}
				>
					<For each={props.classes}>
						{(c) => {
							const opt = () => props.eligibility.getOption(c.id);
							const isWaitlist = () => props.eligibility.isWaitlist(c.id);
							const isEligible = () => props.eligibility.isEligible(c.id);
							const isPurchased = () =>
								opt()?.reasonCode === "ALREADY_REGISTERED";
							const isPrereqUnmet = () =>
								!isEligible() && !isWaitlist() && !isPurchased();

							const statusBadge = () => {
								if (isPurchased()) {
									return <span class="badge status-neutral">Purchased</span>;
								}
								if (isWaitlist()) {
									return <span class="badge status-waitlist">Waitlist</span>;
								}
								if (isPrereqUnmet()) {
									const text =
										opt()?.reasonCode === "MISSING_PREREQUISITE"
											? "Prerequisite unmet"
											: opt()?.badgeText || "Prerequisite unmet";
									return <span class="badge status-warning">{text}</span>;
								}
								return (
									<span
										class="badge status-available"
										data-solo-status={
											c.classSubtypeId === "subtype-solo" ? true : undefined
										}
									>
										Available
									</span>
								);
							};

							const description = () => {
								if (isPurchased()) {
									return (
										opt()?.reasonText || "Already registered for this festival"
									);
								}
								if (isWaitlist()) {
									return "This class has reached its registration limit.";
								}
								if (isPrereqUnmet()) {
									return (
										opt()?.reasonText || "Add qualifying prerequisites first."
									);
								}
								return getPiecesDescription(c);
							};

							const meta = () => {
								const ageText = getAgeRangeText(c);
								const subtype = c.classSubtypeName ?? "";
								return [ageText, subtype].filter(Boolean).join(" · ");
							};

							return (
								<article
									class="list-row"
									classList={{ "muted-row": isPrereqUnmet() }}
									data-class={c.id}
								>
									<div class="row-main">
										<div class="inline">
											<h3>{c.displayName}</h3>
											{statusBadge()}
										</div>
										<p>{description()}</p>
										<Show when={meta()}>
											<span class="muted">{meta()}</span>
										</Show>
									</div>
									<div class="row-actions">
										<span class="price">{formatPrice(c.price)}</span>
										<Show
											when={isPurchased()}
											fallback={
												<Show
													when={isWaitlist()}
													fallback={
														<Show
															when={isPrereqUnmet()}
															fallback={
																<button
																	class="button small"
																	type="button"
																	data-solo-action={
																		c.classSubtypeId === "subtype-solo"
																			? true
																			: undefined
																	}
																	onClick={() => props.onSelectClass(c.id)}
																>
																	Register
																</button>
															}
														>
															<button
																class="button secondary small"
																type="button"
																disabled
																title={opt()?.reasonText ?? undefined}
															>
																Register
															</button>
														</Show>
													}
												>
													<button
														class="button secondary small"
														type="button"
														data-preview-action="waitlist"
														onClick={() => props.onSelectClass(c.id)}
													>
														Join Waitlist
													</button>
												</Show>
											}
										>
											<a
												class="text-link"
												href={
													props.viewRegistrationsPath ?? "my-registrations.html"
												}
											>
												View registration →
											</a>
										</Show>
									</div>
								</article>
							);
						}}
					</For>
				</Show>
			</section>
		</div>
	);
}
