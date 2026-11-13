import { For, Show } from "solid-js";
import { Button } from "../../components/Button.js";
import { FestivalPieceEditor } from "../../components/FestivalPieceEditor.js";
import { FestivalRegistrationCartView } from "../../components/FestivalRegistrationCartView.js";
import { FestivalRegistrationContext } from "../../components/FestivalRegistrationContext.js";
import { FestivalRegistrationPerformanceOptions } from "../../components/FestivalRegistrationPerformanceOptions.js";
import { FestivalWaitlistCard } from "../../components/FestivalWaitlistCard.js";
import { customerFestivalRegistrationSignInPath } from "../../lib/api.js";
import {
	buildFestivalCartPath,
	buildFestivalRegistrationClassPath,
} from "../../lib/routes.js";
import {
	doesClassRequireConcerto,
	formatTotalDuration,
	normalizeMaxPieces,
} from "../../pages/festivalRegistrationHelpers.js";
import type {
	FestivalClassRegistrationPageProps,
	FestivalRegistrationPageState,
} from "./useFestivalRegistrationPage.js";

export interface RegistrationViewProps {
	page: FestivalClassRegistrationPageProps;
	state: FestivalRegistrationPageState;
}

export function FestivalRegistrationCartSection(props: RegistrationViewProps) {
	const { page, state } = props;
	return (
		<>
			<FestivalRegistrationCartView
				cart={state.cart}
				eligibility={state.eligibility}
				isSubmitting={state.isSubmittingCheckout()}
				error={state.checkoutError()}
				onSubmitCheckout={state.handleCartCheckout}
				canJoinWaitlist={state.canJoinCartWaitlist}
				onJoinWaitlist={state.openCartWaitlist}
				onRefreshCheckout={state.handleRefreshCheckout}
				onRestartCheckout={state.handleRestartCheckout}
				canRestoreCheckout={Boolean(state.checkoutRestartReference())}
				onRestoreCheckout={state.handleRestoreCheckout}
			/>
			<p class="parent-note">
				Need to change a registration before payment? Remove it and register
				again.
			</p>
			<Button
				type="button"
				variant="secondary"
				onClick={() => page.app.navigate(state.registerPath())}
			>
				Continue registration
			</Button>
		</>
	);
}

function ClassRowActionButton(props: {
	page: FestivalClassRegistrationPageProps;
	state: FestivalRegistrationPageState;
	classId: string;
}) {
	const { page, state } = props;
	const rowStatus = () => state.status(props.classId);
	return (
		<Show
			when={rowStatus() === "In cart"}
			fallback={
				<Show
					when={rowStatus() === "Purchased"}
					fallback={
						<Show
							when={state.classOptionEligibility.isWaitlist(props.classId)}
							fallback={
								<Button
									type="button"
									disabled={
										!state.classOptionEligibility.isEligible(props.classId) ||
										state.options.classesLoading()
									}
									onClick={() =>
										page.app.navigate(
											buildFestivalRegistrationClassPath(
												page.slug,
												page.festivalSlug,
												props.classId,
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
								onClick={() => state.openWaitlist(props.classId)}
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
							page.app.navigate(`/org/${page.slug}/account/classes`)
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
					page.app.navigate(buildFestivalCartPath(page.slug, page.festivalSlug))
				}
			>
				View cart
			</Button>
		</Show>
	);
}

function WorkspaceClassRow(props: {
	page: FestivalClassRegistrationPageProps;
	state: FestivalRegistrationPageState;
	cls: FestivalRegistrationPageState["eligibleClasses"] extends () => (infer T)[]
		? T
		: never;
}) {
	const { state, cls } = props;
	const rowStatus = () => state.status(cls.id);
	return (
		<article class="parent-list-row">
			<div class="parent-row-main">
				<div class="parent-row-heading">
					<h3>{cls.displayName}</h3>
					<span
						class={`parent-badge ${rowStatus() === "Available" ? "parent-status-available" : rowStatus() === "Waitlist" ? "parent-status-waitlist" : "parent-status-neutral"}`}
					>
						{rowStatus()}
					</span>
				</div>
				<p>
					Ages {cls.minimumAge}–{cls.maximumAge} · Up to{" "}
					{cls.maximumPerformancePieces}{" "}
					{cls.maximumPerformancePieces === 1 ? "piece" : "pieces"} ·{" "}
					{cls.performanceMinutes} minutes
				</p>
				<Show
					when={
						!state.classOptionEligibility.isEligible(cls.id) &&
						rowStatus() !== "In cart" &&
						rowStatus() !== "Purchased" &&
						rowStatus() !== "Waitlist"
					}
				>
					<p class="muted">
						{state.classOptionEligibility.selectedReason(cls.id)}
					</p>
				</Show>
			</div>
			<div class="parent-row-actions">
				<strong>${cls.price}</strong>
				<ClassRowActionButton
					page={props.page}
					state={state}
					classId={cls.id}
				/>
			</div>
		</article>
	);
}

export function FestivalRegistrationWorkspaceView(
	props: RegistrationViewProps,
) {
	const { page, state } = props;
	return (
		<>
			<FestivalRegistrationContext page={page} state={state} />
			<Show when={state.selectedTeacherId()}>
				<div class="parent-section-heading">
					<h2>
						Classes for {state.selectedChild()?.displayName ?? "your performer"}
					</h2>
					<p class="muted">
						{state.selectedDivisionName()} · {state.eligibleClasses().length}{" "}
						classes
					</p>
				</div>
				<Show when={state.options.classesLoading()}>
					<p role="status">Loading classes…</p>
				</Show>
				<Show when={state.classOptionEligibility.error()}>
					<p class="field-error" role="alert">
						{state.classOptionEligibility.error()}
					</p>
					<Button
						type="button"
						variant="secondary"
						onClick={() => void state.classOptionEligibility.recheck()}
					>
						Retry eligibility
					</Button>
				</Show>
				<section class="parent-panel">
					<For each={state.eligibleClasses()}>
						{(cls) => <WorkspaceClassRow page={page} state={state} cls={cls} />}
					</For>
					<Show
						when={
							!state.options.classesLoading() &&
							!state.options.classesError() &&
							state.eligibleClasses().length === 0
						}
					>
						<p>No age-appropriate classes are available for this selection.</p>
					</Show>
				</section>
			</Show>
			<p class="parent-note">
				Class availability is checked again at checkout. Adding a class does not
				reserve a place.
			</p>
		</>
	);
}

function ClassRegistrationSummarySidebar(props: {
	state: FestivalRegistrationPageState;
	cls: NonNullable<ReturnType<FestivalRegistrationPageState["selectedClass"]>>;
}) {
	const { state, cls } = props;
	return (
		<aside class="parent-side-summary parent-panel">
			<p class="parent-eyebrow">Registration summary</p>
			<h2>{state.selectedChild()?.displayName}</h2>
			<dl class="parent-summary">
				<dt>Class</dt>
				<dd>{cls.displayName}</dd>
				<dt>Division</dt>
				<dd>{state.selectedDivisionName()}</dd>
				<dt>Teacher</dt>
				<dd>{state.selectedTeacher()?.name}</dd>
				<dt>Pieces saved</dt>
				<dd>
					{state.pieces().length} of {cls.maximumPerformancePieces}
				</dd>
				<dt>Total duration</dt>
				<dd>{formatTotalDuration(state.pieces())}</dd>
				<dt>Class fee</dt>
				<dd>${cls.price}</dd>
			</dl>
			<Show when={state.pieceDirty()}>
				<p class="parent-note">
					Save or discard the piece changes before adding this registration.
				</p>
			</Show>
			<Show when={state.checkoutError()}>
				<p class="field-error" role="alert">
					{state.checkoutError()}
				</p>
			</Show>
			<Button
				type="button"
				disabled={
					!state.localSelectionValid() ||
					state.pieceDirty() ||
					state.isAdding() ||
					Boolean(state.cart.checkoutSubmission()) ||
					state.cart.hasItem(state.selectedChildId(), cls.id) ||
					state.isPurchased(cls.id)
				}
				onClick={() => void state.handleAddToCart()}
			>
				{state.isAdding() ? "Checking eligibility…" : "Add to Cart"}
			</Button>
			<Show when={state.capacityChanged()}>
				<Button
					type="button"
					variant="secondary"
					onClick={() => state.openWaitlist(cls.id)}
				>
					Join waitlist instead
				</Button>
			</Show>
			<p class="muted">
				At least one saved piece is required. An empty next-piece form can be
				skipped.
			</p>
		</aside>
	);
}

export function FestivalRegistrationClassView(props: RegistrationViewProps) {
	const { page, state } = props;
	return (
		<>
			<Button
				type="button"
				variant="secondary"
				onClick={() => page.app.navigate(state.registerPath())}
			>
				Back to classes
			</Button>
			<Show when={state.options.classesLoading()}>
				<p role="status">Loading class details…</p>
			</Show>
			<Show
				when={state.options.classesError() || state.options.teachersError()}
			>
				<p class="field-error" role="alert">
					{state.options.classesError() || state.options.teachersError()}
				</p>
				<Button
					type="button"
					variant="secondary"
					onClick={state.options.retryOptions}
				>
					Retry registration options
				</Button>
			</Show>
			<Show
				when={state.selectedClass()}
				keyed
				fallback={
					<p class="parent-note">
						Choose a performer, division, teacher, and class in{" "}
						<a
							href={state.registerPath()}
							onClick={(event) => {
								event.preventDefault();
								page.app.navigate(state.registerPath());
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
							disabled={state.isAdding()}
						>
							<FestivalRegistrationPerformanceOptions
								instruments={state.instruments()}
								accompanists={state.accompanists()}
								instrumentId={state.selectedInstrumentId()}
								accompanistId={state.selectedAccompanistId()}
								handlers={state.selectHandlers}
							/>
							<Show when={state.options.accompanistsError()}>
								<p class="field-error" role="alert">
									{state.options.accompanistsError()}
								</p>
								<Button
									type="button"
									variant="secondary"
									onClick={() => void state.options.loadAccompanists()}
								>
									Retry accompanists
								</Button>
							</Show>
							<FestivalPieceEditor
								pieces={state.pieces()}
								onChange={state.setPieces}
								maxPieces={normalizeMaxPieces(cls.maximumPerformancePieces)}
								performanceMinutes={cls.performanceMinutes}
								requiresConcerto={doesClassRequireConcerto(cls)}
								catalogWorks={state.catalogSearch.catalogWorks()}
								catalogSearch={state.catalogSearch}
								onDirtyChange={state.setPieceDirty}
							/>
						</fieldset>
						<ClassRegistrationSummarySidebar state={state} cls={cls} />
					</div>
				)}
			</Show>
		</>
	);
}

export function FestivalRegistrationWaitlistPanel(
	props: RegistrationViewProps,
) {
	const { page, state } = props;
	return (
		<Show when={state.waitlistTarget()} keyed>
			{(target) => (
				<div class="parent-panel">
					<Show when={state.view() === "cart"}>
						<p
							class="parent-eyebrow"
							tabIndex={-1}
							ref={(label) => queueMicrotask(() => label.focus())}
						>
							Waitlist for {target.childName}
						</p>
					</Show>
					<Button
						type="button"
						variant="secondary"
						onClick={state.closeWaitlist}
					>
						Close waitlist
					</Button>
					<FestivalWaitlistCard
						orgSlug={page.slug}
						festivalSlug={page.festivalSlug}
						classId={target.classId}
						className={target.className}
						childId={target.childId}
						childName={target.childName}
						isAuthenticated={state.authenticated()}
						csrfToken={state.getCsrf()}
						initialProfile={{
							name: state.sessionProfile()?.name ?? "",
							email: state.sessionProfile()?.email ?? "",
							phone: state.sessionProfile()?.phone ?? "",
						}}
						onSignInRequest={() =>
							window.location.assign(
								customerFestivalRegistrationSignInPath(
									page.slug,
									page.festivalSlug,
								),
							)
						}
						existingEntry={state.currentWaitlistEntry()}
						onEntryChanged={state.handleWaitlistEntryChanged}
					/>
				</div>
			)}
		</Show>
	);
}
