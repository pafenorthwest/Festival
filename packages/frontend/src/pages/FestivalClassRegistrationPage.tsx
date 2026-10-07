import type { RepertoirePiece } from "@festival/common";
import { createResource, createSignal, For, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { Button } from "../components/Button.js";
import { FestivalNoChildrenPanel } from "../components/FestivalNoChildrenPanel.js";
import { FestivalRegistrationCartCard } from "../components/FestivalRegistrationCartCard.js";
import { FestivalRegistrationCartView } from "../components/FestivalRegistrationCartView.js";
import { FestivalRepertoireModal } from "../components/FestivalRepertoireModal.js";
import {
	customerFestivalRegistrationSignInPath,
	getPublicDivisions,
	getPublicFestival,
	refreshCustomerChildAgeSnapshot,
	startClassCheckout,
} from "../lib/api.js";
import {
	createRegistrationSelectHandlers,
	findById,
	isRegistrationSelectionValid,
	normalizeMaxPieces,
} from "./festivalRegistrationHelpers.js";
import { useRegistrationOptions } from "./festivalRegistrationHooks.js";
import {
	buildCartItemInput,
	cartItemsToLineItemInputs,
	createRegistrationCart,
	resetClassFormSelection,
} from "./registrationCartState.js";
import { useCartEligibility } from "./useCartEligibility.js";
import { useClassOptionEligibility } from "./useClassOptionEligibility.js";

interface FestivalClassRegistrationPageProps {
	app: FestivalAppController;
	slug: string;
	festivalSlug: string;
}

export function FestivalClassRegistrationPage(
	props: FestivalClassRegistrationPageProps,
) {
	const [festival] = createResource(
		() => [props.slug, props.festivalSlug] as const,
		([slug, festivalSlug]) => getPublicFestival(slug, festivalSlug),
	);
	const [divisions] = createResource(
		() => props.slug,
		(slug) => getPublicDivisions(slug),
	);
	const cart = createRegistrationCart();
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
	const [selectedChildId, setSelectedChildId] = createSignal("");
	const [selectedDivisionId, setSelectedDivisionId] = createSignal("");
	const [selectedTeacherId, setSelectedTeacherId] = createSignal("");
	const [selectedClassId, setSelectedClassId] = createSignal("");
	const [selectedAccompanistId, setSelectedAccompanistId] = createSignal("");
	const [pieces, setPieces] = createSignal<RepertoirePiece[]>([]);
	const { children, teachers, eligibleClasses, accompanists, loadChildren } =
		useRegistrationOptions({
			slug: props.slug,
			festivalSlug: props.festivalSlug,
			isAuthenticated: () => props.app.customerSession().authenticated,
			childId: selectedChildId,
			divisionId: selectedDivisionId,
			teacherId: selectedTeacherId,
			onAutoSelectChild: setSelectedChildId,
		});
	const classOptionEligibility = useClassOptionEligibility({
		slug: () => props.slug,
		festivalSlug: () => props.festivalSlug,
		csrfToken: getCsrf,
		childId: selectedChildId,
		classes: eligibleClasses,
		cart,
	});
	const [isRepertoireModalOpen, setIsRepertoireModalOpen] = createSignal(false);
	const [isSubmittingCheckout, setIsSubmittingCheckout] = createSignal(false);
	const [checkoutError, setCheckoutError] = createSignal<string | null>(null);
	const [birthdayDraft, setBirthdayDraft] = createSignal("");
	const [isRefreshingSnapshot, setIsRefreshingSnapshot] = createSignal(false);
	const [snapshotError, setSnapshotError] = createSignal<string | null>(null);
	const selectedChild = () => findById(children(), selectedChildId());
	const selectedClass = () => findById(eligibleClasses(), selectedClassId());
	const selectedTeacher = () => findById(teachers(), selectedTeacherId());
	const selectedAccompanist = () =>
		findById(accompanists(), selectedAccompanistId());
	const selectedDivisionName = () =>
		findById(divisions()?.divisions, selectedDivisionId())?.displayName ??
		"Division";
	const isAlreadyInCart = () =>
		cart.hasItem(selectedChildId(), selectedClassId());
	const signInPath = () =>
		customerFestivalRegistrationSignInPath(props.slug, props.festivalSlug);
	const maxPieces = () =>
		normalizeMaxPieces(selectedClass()?.maximumPerformancePieces);
	const cartSummary = () =>
		`Cart: ${cart.itemCount()} ${cart.itemCount() === 1 ? "class" : "classes"} (${cart.totalPriceFormatted()})`;
	const selectHandlers = createRegistrationSelectHandlers(
		setSelectedChildId,
		setSelectedDivisionId,
		setSelectedTeacherId,
		setSelectedClassId,
		setSelectedAccompanistId,
	);

	async function handleRefreshSnapshot(e: Event) {
		e.preventDefault();
		const childId = selectedChildId(),
			birthday = birthdayDraft();
		if (!childId || !birthday) return;
		setIsRefreshingSnapshot(true);
		setSnapshotError(null);
		try {
			await refreshCustomerChildAgeSnapshot(
				props.slug,
				childId,
				getCsrf(),
				birthday,
			);
			await loadChildren();
			setBirthdayDraft("");
		} catch (err) {
			setSnapshotError(
				err instanceof Error ? err.message : "Failed to verify birthdate.",
			);
		} finally {
			setIsRefreshingSnapshot(false);
		}
	}
	const isReadyForCheckout = () =>
		isRegistrationSelectionValid(
			selectedChild(),
			selectedClass(),
			selectedDivisionId(),
			selectedTeacherId(),
			selectedClassId(),
			pieces(),
		) && classOptionEligibility.isEligible(selectedClassId());
	function handleAddToCart() {
		setCheckoutError(null);
		const cls = selectedClass(),
			child = selectedChild();
		if (
			!cls ||
			!child ||
			!isReadyForCheckout() ||
			isAlreadyInCart() ||
			!classOptionEligibility.isEligible(cls.id)
		)
			return;
		cart.addItem(
			buildCartItemInput(
				child,
				selectedDivisionId(),
				selectedDivisionName(),
				selectedTeacher(),
				cls,
				selectedAccompanist(),
				pieces(),
			),
		);
		resetClassFormSelection({
			setSelectedClassId,
			setPieces,
			setSelectedAccompanistId,
		});
	}
	async function executeCheckout(
		lineItems: ReturnType<typeof cartItemsToLineItemInputs>,
	) {
		setCheckoutError(null);
		setIsSubmittingCheckout(true);
		try {
			const res = await startClassCheckout(props.slug, props.festivalSlug, {
				lineItems,
				csrfToken: getCsrf(),
				idempotencyKey: crypto.randomUUID(),
			});
			if (res?.checkoutUrl) {
				cart.clearCart();
				if (typeof window !== "undefined" && window.location?.assign) {
					window.location.assign(res.checkoutUrl);
				}
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
			setIsSubmittingCheckout(false);
		}
	}
	async function handleCartCheckout() {
		const items = cart.items();
		if (
			items.length === 0 ||
			eligibility.isEvaluating() ||
			eligibility.hasIneligibleItems()
		)
			return;
		const lineItems = cartItemsToLineItemInputs(items);
		await executeCheckout(lineItems);
	}
	async function handleCheckout() {
		handleAddToCart();
		await handleCartCheckout();
	}
	return (
		<Show
			when={!props.app.isCustomerSessionLoading()}
			fallback={
				<section class="panel flow-panel" aria-busy="true">
					<p role="status">Checking your sign-in status…</p>
				</section>
			}
		>
			<Show
				when={props.app.customerSession().authenticated}
				fallback={
					<section class="panel flow-panel">
						<header class="admin-page-header">
							<div>
								<h2>Register for Festival Classes</h2>
								<p>
									Sign in with your parent account to register your children.
								</p>
							</div>
						</header>
						<Button
							type="button"
							onClick={() => window.location.assign(signInPath())}
						>
							Sign in to Register
						</Button>
					</section>
				}
			>
				<section class="panel flow-panel">
					<header
						class="admin-page-header"
						style="display: flex; justify-content: space-between; align-items: flex-start;"
					>
						<div>
							<h2>
								{festival()?.festival.name ?? "Festival"} Class Registration
							</h2>
							<p class="muted">
								Select child, division, teacher, and class to register.
							</p>
						</div>
						<Show when={cart.itemCount() > 0}>
							<div style="font-weight: bold; font-size: 0.95rem;">
								{cartSummary()}
							</div>
						</Show>
					</header>

					<Show when={cart.itemCount() > 0}>
						<FestivalRegistrationCartView
							cart={cart}
							eligibility={eligibility}
							isSubmitting={isSubmittingCheckout()}
							error={checkoutError()}
							onSubmitCheckout={handleCartCheckout}
						/>
					</Show>

					<Show when={children().length === 0}>
						<FestivalNoChildrenPanel
							onManageChildren={() =>
								props.app.navigate(`/org/${props.slug}/account/children`)
							}
						/>
					</Show>

					<Show when={children().length > 0}>
						<div
							class="registration-form-grid"
							style="display: grid; gap: 1rem;"
						>
							<label class="field">
								<span>Performer (Child)</span>
								<select
									id="registration-child"
									name="registration-child"
									value={selectedChildId()}
									onChange={selectHandlers.onChildChange}
								>
									<option value="">Select a child…</option>
									<For each={children()}>
										{(child) => (
											<option value={child.id}>{child.displayName}</option>
										)}
									</For>
								</select>
							</label>

							<Show
								when={
									selectedChild() &&
									!selectedChild()?.hasCurrentValidAgeSnapshot
								}
							>
								<div
									class="panel flow-panel division-history-note"
									role="alert"
								>
									<strong>Age Snapshot Required (90-day validity)</strong>
									<p>
										{selectedChild()?.displayName} requires an updated age
										snapshot for class eligibility. Please provide birthdate to
										confirm eligibility.
									</p>
									<form
										onSubmit={handleRefreshSnapshot}
										style="display: flex; gap: 0.5rem; align-items: flex-end;"
									>
										<label class="field" style="flex: 1;">
											<span>Birthdate</span>
											<input
												id="registration-birthdate"
												name="registration-birthdate"
												type="date"
												value={birthdayDraft()}
												onInput={(e) => setBirthdayDraft(e.currentTarget.value)}
												required
											/>
										</label>
										<Button type="submit" disabled={isRefreshingSnapshot()}>
											{isRefreshingSnapshot()
												? "Verifying…"
												: "Confirm Birthdate"}
										</Button>
									</form>
									<Show when={snapshotError()}>
										<p class="field-error" role="alert">
											{snapshotError()}
										</p>
									</Show>
								</div>
							</Show>

							<Show when={selectedChild()?.hasCurrentValidAgeSnapshot}>
								<label class="field">
									<span>Division</span>
									<select
										id="registration-division"
										name="registration-division"
										value={selectedDivisionId()}
										disabled={divisions.loading || Boolean(divisions.error)}
										onChange={selectHandlers.onDivisionChange}
									>
										<option value="">Select a division…</option>
										<For each={divisions()?.divisions ?? []}>
											{(div) => (
												<option value={div.id}>{div.displayName}</option>
											)}
										</For>
									</select>
									<Show when={divisions.loading}>
										<p class="muted">Loading available divisions.</p>
									</Show>
									<Show when={divisions.error}>
										<p class="field-error" role="alert">
											Available divisions could not be loaded. Please try again.
										</p>
									</Show>
								</label>

								<Show when={selectedDivisionId()}>
									<label class="field">
										<span>Teacher</span>
										<select
											id="registration-teacher"
											name="registration-teacher"
											value={selectedTeacherId()}
											onChange={selectHandlers.onTeacherChange}
										>
											<option value="">Select teacher…</option>
											<For each={teachers()}>
												{(t) => <option value={t.id}>{t.name}</option>}
											</For>
										</select>
									</label>
								</Show>

								<Show when={selectedTeacherId()}>
									<label class="field">
										<span>Eligible Class</span>
										<select
											id="registration-class"
											name="registration-class"
											value={selectedClassId()}
											onChange={selectHandlers.onClassChange}
										>
											<option value="">Select an eligible class…</option>
											<For each={eligibleClasses()}>
												{(c) => (
													<option
														value={c.id}
														disabled={!classOptionEligibility.isEligible(c.id)}
													>
														{classOptionEligibility.formatOption(c)}
													</option>
												)}
											</For>
										</select>
										<Show
											when={classOptionEligibility.selectedReason(
												selectedClassId(),
											)}
										>
											{(reason) => (
												<p class="field-error" role="alert">
													{reason()}
												</p>
											)}
										</Show>
									</label>
								</Show>

								<Show when={selectedClass()}>
									<label class="field">
										<span>Accompanist</span>
										<select
											id="registration-accompanist"
											name="registration-accompanist"
											value={selectedAccompanistId()}
											onChange={selectHandlers.onAccompanistChange}
										>
											<option value="">None (No accompanist needed)</option>
											<For each={accompanists()}>
												{(acc) => <option value={acc.id}>{acc.name}</option>}
											</For>
										</select>
									</label>

									<FestivalRegistrationCartCard
										childName={selectedChild()?.displayName ?? null}
										divisionName={selectedDivisionName()}
										teacherName={selectedTeacher()?.name ?? null}
										className={selectedClass()?.displayName ?? null}
										classPrice={selectedClass()?.price ?? null}
										pieces={pieces()}
										accompanistName={selectedAccompanist()?.name ?? null}
										isValid={isReadyForCheckout()}
										isSubmitting={isSubmittingCheckout()}
										error={checkoutError()}
										isAlreadyInCart={isAlreadyInCart()}
										onOpenRepertoireModal={() => setIsRepertoireModalOpen(true)}
										onAddToCart={handleAddToCart}
										onSubmitCheckout={handleCheckout}
									/>
								</Show>
							</Show>
						</div>
					</Show>
				</section>

				<Show when={selectedClass()}>
					<FestivalRepertoireModal
						isOpen={isRepertoireModalOpen()}
						maxPieces={maxPieces()}
						initialPieces={pieces()}
						onSave={setPieces}
						onClose={() => setIsRepertoireModalOpen(false)}
					/>
				</Show>
			</Show>
		</Show>
	);
}
