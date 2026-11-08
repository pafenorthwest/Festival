import { For, Show } from "solid-js";
import { Button } from "../components/Button.js";
import { FestivalPieceEditor } from "../components/FestivalPieceEditor.js";
import { FestivalRegistrationCartView } from "../components/FestivalRegistrationCartView.js";
import { FestivalRegistrationContext } from "../components/FestivalRegistrationContext.js";
import { FestivalRegistrationPerformanceOptions } from "../components/FestivalRegistrationPerformanceOptions.js";
import { FestivalWaitlistCard } from "../components/FestivalWaitlistCard.js";
import { customerFestivalRegistrationSignInPath } from "../lib/api.js";
import {
	buildFestivalCartPath,
	buildFestivalRegistrationClassPath,
} from "../lib/routes.js";
import {
	doesClassRequireConcerto,
	findById,
	formatTotalDuration,
	normalizeMaxPieces,
} from "./festivalRegistrationHelpers.js";
import {
	type FestivalClassRegistrationPageProps,
	useFestivalRegistrationPage,
} from "./useFestivalRegistrationPage.js";

export function FestivalClassRegistrationPage(
	props: FestivalClassRegistrationPageProps,
) {
	const state = useFestivalRegistrationPage(props);
	const {
		view,
		registerPath,
		authenticated,
		festival,
		purchased,
		waitlistClassId,
		setWaitlistClassId,
		selectedChildId,
		selectedTeacherId,
		selectedAccompanistId,
		selectedInstrumentId,
		pieces,
		setPieces,
		pieceDirty,
		setPieceDirty,
		isSubmittingCheckout,
		isAdding,
		checkoutError,
		capacityChanged,
		options,
		eligibleClasses,
		accompanists,
		loadChildren,
		selectedChild,
		selectedClass,
		selectedTeacher,
		instruments,
		selectedDivisionName,
		classOptionEligibility,
		eligibility,
		sessionProfile,
		currentWaitlistEntry,
		handleWaitlistEntryChanged,
		catalogSearch,
		selectHandlers,
		getCsrf,
		isPurchased,
		status,
		openWaitlist,
		localSelectionValid,
		handleAddToCart,
		handleCartCheckout,
		cart,
	} = state;
	return (
		<Show
			when={!props.app.isCustomerSessionLoading()}
			fallback={<p role="status">Checking your sign-in status…</p>}
		>
			<Show
				when={authenticated()}
				fallback={
					<section class="parent-panel">
						<h1>Registration</h1>
						<p>Sign in with your parent account to register your performers.</p>
						<Button
							type="button"
							onClick={() =>
								window.location.assign(
									customerFestivalRegistrationSignInPath(
										props.slug,
										props.festivalSlug,
									),
								)
							}
						>
							Sign in to Register
						</Button>
					</section>
				}
			>
				<header class="parent-page-heading">
					<p class="parent-eyebrow">
						{festival()?.festival.name ?? "Festival"}
					</p>
					<h1>
						{view() === "cart"
							? "Your cart"
							: view() === "class"
								? (selectedClass()?.displayName ?? "Class registration")
								: "Registration"}
					</h1>
					<p class="muted">
						{view() === "cart"
							? "Review your family's registrations before checkout."
							: view() === "class"
								? `${selectedChild()?.displayName ?? "Performer"} · ${selectedDivisionName()} · ${selectedTeacher()?.name ?? "Registered teacher"}`
								: "Choose a performer, then find their next class."}
					</p>
				</header>
				<Show when={view() === "cart"}>
					<FestivalRegistrationCartView
						cart={cart}
						eligibility={eligibility}
						isSubmitting={isSubmittingCheckout()}
						error={checkoutError()}
						onSubmitCheckout={handleCartCheckout}
					/>
					<p class="parent-note">
						Need to change a registration before payment? Remove it and register
						again.
					</p>
					<Button
						type="button"
						variant="secondary"
						onClick={() => props.app.navigate(registerPath())}
					>
						Continue registration
					</Button>
				</Show>
				<Show when={view() !== "cart"}>
					<Show when={options.childrenLoading()}>
						<p role="status">Loading performers…</p>
					</Show>
					<Show when={options.childrenError()}>
						<p class="field-error" role="alert">
							{options.childrenError()}
						</p>
						<Button
							type="button"
							variant="secondary"
							onClick={() => void loadChildren()}
						>
							Retry performers
						</Button>
					</Show>
					<Show when={view() === "workspace"}>
						<FestivalRegistrationContext page={props} state={state} />
						<Show when={selectedTeacherId()}>
							<div class="parent-section-heading">
								<h2>
									Classes for {selectedChild()?.displayName ?? "your performer"}
								</h2>
								<p class="muted">
									{selectedDivisionName()} · {eligibleClasses().length} classes
								</p>
							</div>
							<Show when={options.classesLoading()}>
								<p role="status">Loading classes…</p>
							</Show>
							<Show when={classOptionEligibility.error()}>
								<p class="field-error" role="alert">
									{classOptionEligibility.error()}
								</p>
								<Button
									type="button"
									variant="secondary"
									onClick={() => void classOptionEligibility.recheck()}
								>
									Retry eligibility
								</Button>
							</Show>
							<Show when={purchased.error}>
								<p class="muted">
									Purchased registrations could not be loaded. Existing
									eligibility checks will still prevent duplicate registrations.
								</p>
							</Show>
							<section class="parent-panel">
								<For each={eligibleClasses()}>
									{(cls) => (
										<article class="parent-list-row">
											<div class="parent-row-main">
												<div class="parent-row-heading">
													<h3>{cls.displayName}</h3>
													<span
														class={`parent-badge ${status(cls.id) === "Available" ? "parent-status-available" : status(cls.id) === "Waitlist" ? "parent-status-waitlist" : "parent-status-neutral"}`}
													>
														{status(cls.id)}
													</span>
												</div>
												<p>
													Ages {cls.minimumAge}–{cls.maximumAge} · Up to{" "}
													{cls.maximumPerformancePieces}{" "}
													{cls.maximumPerformancePieces === 1
														? "piece"
														: "pieces"}{" "}
													· {cls.performanceMinutes} minutes
												</p>
												<Show
													when={
														!classOptionEligibility.isEligible(cls.id) &&
														status(cls.id) !== "In cart" &&
														status(cls.id) !== "Purchased" &&
														status(cls.id) !== "Waitlist"
													}
												>
													<p class="muted">
														{classOptionEligibility.selectedReason(cls.id)}
													</p>
												</Show>
											</div>
											<div class="parent-row-actions">
												<strong>${cls.price}</strong>
												<Show
													when={status(cls.id) === "In cart"}
													fallback={
														<Show
															when={status(cls.id) === "Purchased"}
															fallback={
																<Show
																	when={classOptionEligibility.isWaitlist(
																		cls.id,
																	)}
																	fallback={
																		<Button
																			type="button"
																			disabled={
																				!classOptionEligibility.isEligible(
																					cls.id,
																				) || options.classesLoading()
																			}
																			onClick={() =>
																				props.app.navigate(
																					buildFestivalRegistrationClassPath(
																						props.slug,
																						props.festivalSlug,
																						cls.id,
																					),
																				)
																			}
																		>
																			Register
																		</Button>
																	}
																>
																	<Button
																		type="button"
																		variant="secondary"
																		onClick={() => openWaitlist(cls.id)}
																	>
																		Join Waitlist
																	</Button>
																</Show>
															}
														>
															<Button
																type="button"
																variant="secondary"
																onClick={() =>
																	props.app.navigate(
																		`/org/${props.slug}/account/classes`,
																	)
																}
															>
																View registration
															</Button>
														</Show>
													}
												>
													<Button
														type="button"
														variant="secondary"
														onClick={() =>
															props.app.navigate(
																buildFestivalCartPath(
																	props.slug,
																	props.festivalSlug,
																),
															)
														}
													>
														View cart
													</Button>
												</Show>
											</div>
										</article>
									)}
								</For>
								<Show
									when={
										!options.classesLoading() &&
										!options.classesError() &&
										eligibleClasses().length === 0
									}
								>
									<p>
										No age-appropriate classes are available for this selection.
									</p>
								</Show>
							</section>
						</Show>
						<p class="parent-note">
							Class availability is checked again at checkout. Adding a class
							does not reserve a place.
						</p>
					</Show>
					<Show when={view() === "class" && !waitlistClassId()}>
						<Button
							type="button"
							variant="secondary"
							onClick={() => props.app.navigate(registerPath())}
						>
							Back to classes
						</Button>
						<Show when={options.classesLoading()}>
							<p role="status">Loading class details…</p>
						</Show>
						<Show when={options.classesError() || options.teachersError()}>
							<p class="field-error" role="alert">
								{options.classesError() || options.teachersError()}
							</p>
							<Button
								type="button"
								variant="secondary"
								onClick={options.retryOptions}
							>
								Retry registration options
							</Button>
						</Show>
						<Show
							when={selectedClass()}
							keyed
							fallback={
								<p class="parent-note">
									Choose a performer, division, teacher, and class in{" "}
									<a
										href={registerPath()}
										onClick={(event) => {
											event.preventDefault();
											props.app.navigate(registerPath());
										}}
									>
										Registration
									</a>{" "}
									to begin.
								</p>
							}
						>
							{(cls) => (
								<div class="parent-content-grid">
									<fieldset
										class="parent-registration-controls"
										disabled={isAdding()}
									>
										<FestivalRegistrationPerformanceOptions
											instruments={instruments()}
											accompanists={accompanists()}
											instrumentId={selectedInstrumentId()}
											accompanistId={selectedAccompanistId()}
											handlers={selectHandlers}
										/>
										<Show when={options.accompanistsError()}>
											<p class="field-error" role="alert">
												{options.accompanistsError()}
											</p>
											<Button
												type="button"
												variant="secondary"
												onClick={() => void options.loadAccompanists()}
											>
												Retry accompanists
											</Button>
										</Show>
										<FestivalPieceEditor
											pieces={pieces()}
											onChange={setPieces}
											maxPieces={normalizeMaxPieces(
												cls.maximumPerformancePieces,
											)}
											performanceMinutes={cls.performanceMinutes}
											requiresConcerto={doesClassRequireConcerto(cls)}
											catalogWorks={catalogSearch.catalogWorks()}
											catalogSearch={catalogSearch}
											onDirtyChange={setPieceDirty}
										/>
									</fieldset>
									<aside class="parent-side-summary parent-panel">
										<p class="parent-eyebrow">Registration summary</p>
										<h2>{selectedChild()?.displayName}</h2>
										<dl class="parent-summary">
											<dt>Class</dt>
											<dd>{cls.displayName}</dd>
											<dt>Division</dt>
											<dd>{selectedDivisionName()}</dd>
											<dt>Teacher</dt>
											<dd>{selectedTeacher()?.name}</dd>
											<dt>Pieces saved</dt>
											<dd>
												{pieces().length} of {cls.maximumPerformancePieces}
											</dd>
											<dt>Total duration</dt>
											<dd>{formatTotalDuration(pieces())}</dd>
											<dt>Class fee</dt>
											<dd>${cls.price}</dd>
										</dl>
										<Show when={pieceDirty()}>
											<p class="parent-note">
												Save or discard the piece changes before adding this
												registration.
											</p>
										</Show>
										<Show when={checkoutError()}>
											<p class="field-error" role="alert">
												{checkoutError()}
											</p>
										</Show>
										<Button
											type="button"
											disabled={
												!localSelectionValid() ||
												pieceDirty() ||
												isAdding() ||
												cart.hasItem(selectedChildId(), cls.id) ||
												isPurchased(cls.id)
											}
											onClick={() => void handleAddToCart()}
										>
											{isAdding() ? "Checking eligibility…" : "Add to Cart"}
										</Button>
										<Show when={capacityChanged()}>
											<Button
												type="button"
												variant="secondary"
												onClick={() => openWaitlist(cls.id)}
											>
												Join waitlist instead
											</Button>
										</Show>
										<p class="muted">
											At least one saved piece is required. An empty next-piece
											form can be skipped.
										</p>
									</aside>
								</div>
							)}
						</Show>
					</Show>
					<Show when={waitlistClassId()}>
						<div class="parent-panel">
							<Button
								type="button"
								variant="secondary"
								onClick={() => setWaitlistClassId("")}
							>
								Close waitlist
							</Button>
							<FestivalWaitlistCard
								orgSlug={props.slug}
								festivalSlug={props.festivalSlug}
								classId={waitlistClassId()}
								className={
									findById(eligibleClasses(), waitlistClassId())?.displayName ??
									"Class"
								}
								childId={selectedChildId()}
								childName={selectedChild()?.displayName ?? "Performer"}
								isAuthenticated={authenticated()}
								csrfToken={getCsrf()}
								initialProfile={{
									name: sessionProfile()?.name ?? "",
									email: sessionProfile()?.email ?? "",
									phone: sessionProfile()?.phone ?? "",
								}}
								onSignInRequest={() =>
									window.location.assign(
										customerFestivalRegistrationSignInPath(
											props.slug,
											props.festivalSlug,
										),
									)
								}
								existingEntry={currentWaitlistEntry()}
								onEntryChanged={handleWaitlistEntryChanged}
							/>
						</div>
					</Show>
				</Show>
			</Show>
		</Show>
	);
}
