import type {
	CustomerChildDto,
	FestivalClassConfigurationDto,
	RepertoirePiece,
} from "@festival/common";
import {
	createEffect,
	createMemo,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { Button } from "../components/Button.js";
import { FestivalRegistrationCartCard } from "../components/FestivalRegistrationCartCard.js";
import { FestivalRepertoireModal } from "../components/FestivalRepertoireModal.js";
import {
	getCustomerChildren,
	getPublicFestival,
	listRegistrationAccompanists,
	listRegistrationEligibleClasses,
	listRegistrationTeachers,
	refreshCustomerChildAgeSnapshot,
	startClassCheckout,
} from "../lib/api.js";

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

	const [children, setChildren] = createSignal<CustomerChildDto[]>([]);
	const [selectedChildId, setSelectedChildId] = createSignal<string>("");
	const [selectedDivisionId, setSelectedDivisionId] = createSignal<string>("");
	const [selectedTeacherId, setSelectedTeacherId] = createSignal<string>("");
	const [selectedClassId, setSelectedClassId] = createSignal<string>("");
	const [selectedAccompanistId, setSelectedAccompanistId] =
		createSignal<string>("");
	const [pieces, setPieces] = createSignal<RepertoirePiece[]>([]);

	const [teachers, setTeachers] = createSignal<
		Array<{ id: string; name: string }>
	>([]);
	const [eligibleClasses, setEligibleClasses] = createSignal<
		FestivalClassConfigurationDto[]
	>([]);
	const [accompanists, setAccompanists] = createSignal<
		Array<{ id: string; name: string }>
	>([]);

	const [isRepertoireModalOpen, setIsRepertoireModalOpen] = createSignal(false);
	const [isSubmittingCheckout, setIsSubmittingCheckout] = createSignal(false);
	const [checkoutError, setCheckoutError] = createSignal<string | null>(null);

	const [birthdayDraft, setBirthdayDraft] = createSignal("");
	const [isRefreshingSnapshot, setIsRefreshingSnapshot] = createSignal(false);
	const [snapshotError, setSnapshotError] = createSignal<string | null>(null);

	const selectedChild = createMemo(
		() => children().find((c) => c.id === selectedChildId()) ?? null,
	);
	const selectedClass = createMemo(
		() => eligibleClasses().find((c) => c.id === selectedClassId()) ?? null,
	);
	const selectedTeacher = createMemo(
		() => teachers().find((t) => t.id === selectedTeacherId()) ?? null,
	);
	const selectedAccompanist = createMemo(
		() => accompanists().find((a) => a.id === selectedAccompanistId()) ?? null,
	);

	async function loadChildren() {
		try {
			const res = await getCustomerChildren(props.slug);
			setChildren(res.children);
			if (res.children.length === 1 && res.children[0]) {
				setSelectedChildId(res.children[0].id);
			}
		} catch {
			// Handled gracefully in UI
		}
	}

	async function loadAccompanists() {
		try {
			const res = await listRegistrationAccompanists(
				props.slug,
				props.festivalSlug,
			);
			setAccompanists(res.accompanists);
		} catch {
			// Handled gracefully in UI
		}
	}

	createEffect(() => {
		if (props.app.customerSession()) {
			void loadChildren();
			void loadAccompanists();
		}
	});

	createEffect(async () => {
		const childId = selectedChildId();
		const divId = selectedDivisionId();
		if (!childId || !divId) {
			setTeachers([]);
			setSelectedTeacherId("");
			return;
		}
		try {
			const res = await listRegistrationTeachers(
				props.slug,
				props.festivalSlug,
				childId,
				divId,
			);
			setTeachers(res.teachers);
		} catch {
			setTeachers([]);
		}
	});

	createEffect(async () => {
		const childId = selectedChildId();
		const divId = selectedDivisionId();
		const teacherId = selectedTeacherId();
		if (!childId || !divId || !teacherId) {
			setEligibleClasses([]);
			setSelectedClassId("");
			return;
		}
		try {
			const res = await listRegistrationEligibleClasses(
				props.slug,
				props.festivalSlug,
				childId,
				divId,
				teacherId,
			);
			setEligibleClasses(res.classes);
		} catch {
			setEligibleClasses([]);
		}
	});

	async function handleRefreshSnapshot(e: Event) {
		e.preventDefault();
		const childId = selectedChildId();
		const birthday = birthdayDraft();
		const csrf = props.app.customerSession()?.csrfToken ?? "";
		if (!childId || !birthday) return;
		setIsRefreshingSnapshot(true);
		setSnapshotError(null);
		try {
			await refreshCustomerChildAgeSnapshot(
				props.slug,
				childId,
				csrf,
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

	const isReadyForCheckout = createMemo(() => {
		const child = selectedChild();
		if (!child?.hasCurrentValidAgeSnapshot) return false;
		if (!selectedDivisionId() || !selectedTeacherId() || !selectedClassId())
			return false;
		const cls = selectedClass();
		if (!cls) return false;
		if (pieces().length < 1 || pieces().length > cls.maximumPerformancePieces)
			return false;
		return pieces().every(
			(p) =>
				Boolean(p.title.trim()) &&
				Boolean(p.composer.trim()) &&
				p.durationSeconds > 0,
		);
	});

	async function handleCheckout() {
		setCheckoutError(null);
		const cls = selectedClass();
		const child = selectedChild();
		if (!cls || !child || !isReadyForCheckout()) return;
		setIsSubmittingCheckout(true);
		try {
			const csrf = props.app.customerSession()?.csrfToken ?? "";
			const idempotencyKey = crypto.randomUUID();
			const res = await startClassCheckout(
				props.slug,
				props.festivalSlug,
				csrf,
				idempotencyKey,
				{
					festivalClassId: cls.id,
					childId: child.id,
					divisionId: selectedDivisionId(),
					teacherId: selectedTeacherId(),
					accompanistId: selectedAccompanistId() || undefined,
					pieces: pieces(),
				},
			);
			if (res.checkoutUrl) {
				window.location.assign(res.checkoutUrl);
			}
		} catch (err) {
			setCheckoutError(
				err instanceof Error
					? err.message
					: "Checkout failed. Please try again.",
			);
			setIsSubmittingCheckout(false);
		}
	}

	return (
		<Show
			when={props.app.customerSession()}
			fallback={
				<section class="panel flow-panel">
					<header class="admin-page-header">
						<div>
							<h2>Register for Festival Classes</h2>
							<p>Sign in with your parent account to register your children.</p>
						</div>
					</header>
					<Button type="button" onClick={() => props.app.openSignInModal()}>
						Sign in to Register
					</Button>
				</section>
			}
		>
			<section class="panel flow-panel">
				<header class="admin-page-header">
					<div>
						<h2>
							{festival()?.festival.name ?? "Festival"} Class Registration
						</h2>
						<p class="muted">
							Select child, division, teacher, and class to register.
						</p>
					</div>
				</header>

				<Show when={children().length === 0}>
					<div class="panel flow-panel" role="alert">
						<p>
							No children found in your family account. Please add a child in
							your account first.
						</p>
						<Button
							type="button"
							onClick={() =>
								props.app.navigate(`/org/${props.slug}/account/children`)
							}
						>
							Manage Children
						</Button>
					</div>
				</Show>

				<Show when={children().length > 0}>
					<div class="registration-form-grid" style="display: grid; gap: 1rem;">
						<label class="field">
							<span>Performer (Child)</span>
							<select
								value={selectedChildId()}
								onChange={(e) => {
									setSelectedChildId(e.currentTarget.value);
									setSelectedClassId("");
								}}
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
								selectedChild() && !selectedChild()?.hasCurrentValidAgeSnapshot
							}
						>
							<div class="panel flow-panel division-history-note" role="alert">
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
									value={selectedDivisionId()}
									onChange={(e) => {
										setSelectedDivisionId(e.currentTarget.value);
										setSelectedTeacherId("");
										setSelectedClassId("");
									}}
								>
									<option value="">Select a division…</option>
									<For each={props.app.divisions().filter((d) => d.isActive)}>
										{(div) => <option value={div.id}>{div.displayName}</option>}
									</For>
								</select>
							</label>

							<Show when={selectedDivisionId()}>
								<label class="field">
									<span>Teacher</span>
									<select
										value={selectedTeacherId()}
										onChange={(e) => {
											setSelectedTeacherId(e.currentTarget.value);
											setSelectedClassId("");
										}}
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
										value={selectedClassId()}
										onChange={(e) => setSelectedClassId(e.currentTarget.value)}
									>
										<option value="">Select an eligible class…</option>
										<For each={eligibleClasses()}>
											{(c) => (
												<option value={c.id}>
													{c.displayName} · ${c.price} ({c.minimumAge}–
													{c.maximumAge} yrs)
												</option>
											)}
										</For>
									</select>
								</label>
							</Show>

							<Show when={selectedClass()}>
								<label class="field">
									<span>Accompanist</span>
									<select
										value={selectedAccompanistId()}
										onChange={(e) =>
											setSelectedAccompanistId(e.currentTarget.value)
										}
									>
										<option value="">None (No accompanist needed)</option>
										<For each={accompanists()}>
											{(acc) => <option value={acc.id}>{acc.name}</option>}
										</For>
									</select>
								</label>

								<FestivalRegistrationCartCard
									childName={selectedChild()?.displayName ?? null}
									divisionName={
										props.app
											.divisions()
											.find((d) => d.id === selectedDivisionId())
											?.displayName ?? null
									}
									teacherName={selectedTeacher()?.name ?? null}
									className={selectedClass()?.displayName ?? null}
									classPrice={selectedClass()?.price ?? null}
									pieces={pieces()}
									accompanistName={selectedAccompanist()?.name ?? null}
									isValid={isReadyForCheckout()}
									isSubmitting={isSubmittingCheckout()}
									error={checkoutError()}
									onOpenRepertoireModal={() => setIsRepertoireModalOpen(true)}
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
					maxPieces={selectedClass()?.maximumPerformancePieces ?? 1}
					initialPieces={pieces()}
					onSave={(saved) => setPieces(saved)}
					onClose={() => setIsRepertoireModalOpen(false)}
				/>
			</Show>
		</Show>
	);
}
