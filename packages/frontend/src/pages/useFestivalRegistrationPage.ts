import type { RepertoirePiece } from "@festival/common";
import { useBeforeLeave } from "@solidjs/router";
import {
	createEffect,
	createResource,
	createSignal,
	onCleanup,
} from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import {
	ApiError,
	discoverClassCheckoutRestart,
	evaluateRegistrationEligibility,
	getClassCheckoutRecoveryStatus,
	getPublicDivisions,
	getPublicFestival,
	listCustomerClassRegistrations,
	refreshCustomerChildAgeSnapshot,
	restartClassCheckout,
	startClassCheckout,
} from "../lib/api.js";
import { buildFestivalRegistrationPath } from "../lib/routes.js";
import {
	createRegistrationSelectHandlers,
	doesClassRequireConcerto,
	findById,
	isInstrumentSelectionValid,
	isRegistrationSelectionValid,
} from "./festivalRegistrationHelpers.js";
import {
	useConcertoCatalogSearch,
	useRegistrationOptions,
	useRegistrationWaitlist,
} from "./festivalRegistrationHooks.js";
import {
	buildCartItemInput,
	cartItemsToLineItemInputs,
	type RegistrationCheckoutSubmission,
	resetClassFormSelection,
} from "./registrationCartState.js";
import { useCartEligibility } from "./useCartEligibility.js";
import { useClassOptionEligibility } from "./useClassOptionEligibility.js";

export interface FestivalClassRegistrationPageProps {
	app: FestivalAppController;
	slug: string;
	festivalSlug: string;
	view?: "workspace" | "class" | "cart";
	classId?: string;
}

export function useFestivalRegistrationPage(
	props: FestivalClassRegistrationPageProps,
) {
	const workspace = props.app.parentRegistration.workspace(
		props.slug,
		props.festivalSlug,
	);
	props.app.parentRegistration.setActiveFestival(
		props.slug,
		props.festivalSlug,
	);
	const cart = workspace.cart;
	const selectedChildId = workspace.childId,
		setSelectedChildId = workspace.setChildId;
	const selectedDivisionId = workspace.divisionId,
		setSelectedDivisionId = workspace.setDivisionId;
	const selectedTeacherId = workspace.teacherId,
		setSelectedTeacherId = workspace.setTeacherId;
	const view = () => props.view ?? "workspace";
	const registerPath = () =>
		buildFestivalRegistrationPath(props.slug, props.festivalSlug);
	const authenticated = () => props.app.customerSession().authenticated;
	const getCsrf = () => {
		const session = props.app.customerSession();
		return session.authenticated ? session.csrfToken : "";
	};
	const [festival] = createResource(
		() => [props.slug, props.festivalSlug] as const,
		([slug, shortName]) => getPublicFestival(slug, shortName),
	);
	const [divisions, { refetch: retryDivisions }] = createResource(
		() => props.slug,
		getPublicDivisions,
	);
	const [purchased] = createResource(
		() =>
			authenticated() ? ([props.slug, props.festivalSlug] as const) : false,
		([slug, shortName]) => listCustomerClassRegistrations(slug, shortName),
	);
	const [waitlistClassId, setWaitlistClassId] = createSignal("");
	const selectedClassId = () => props.classId ?? waitlistClassId();
	const [selectedAccompanistId, setSelectedAccompanistId] = createSignal("");
	const [selectedInstrumentId, setSelectedInstrumentId] = createSignal("");
	const [pieces, setPieces] = createSignal<RepertoirePiece[]>([]);
	const [pieceDirty, setPieceDirty] = createSignal(false);
	const [isSubmittingCheckout, setIsSubmittingCheckout] = createSignal(false);
	const [isAdding, setIsAdding] = createSignal(false);
	const [checkoutError, setCheckoutError] = createSignal<string | null>(null);
	const [discoveredRestart, setDiscoveredRestart] = createSignal<string | null>(
		null,
	);
	const checkoutRestartReference = () => {
		const recovery = cart.checkoutRecovery();
		const reference = recovery?.restartAllowed
			? recovery.recoveryReference
			: recovery || cart.checkoutSubmission()
				? null
				: discoveredRestart();
		return reference === cart.lastRestoredRecoveryReference()
			? null
			: reference;
	};
	const [capacityChanged, setCapacityChanged] = createSignal(false);
	const [birthdayDraft, setBirthdayDraft] = createSignal("");
	const [isRefreshingSnapshot, setIsRefreshingSnapshot] = createSignal(false);
	const [snapshotError, setSnapshotError] = createSignal<string | null>(null);
	let allowLeave = false;
	let handingOff = false;
	let completeHandoff: (() => void) | undefined;
	let formRevision = 0;
	let disposed = false;
	onCleanup(() => {
		disposed = true;
		if (completeHandoff)
			window.removeEventListener("pagehide", completeHandoff);
	});
	createEffect(() => {
		if (view() !== "cart" || !authenticated()) {
			setDiscoveredRestart(null);
			return;
		}
		let active = true;
		let request = 0;
		function discoverRestart() {
			const current = ++request;
			setDiscoveredRestart(null);
			void discoverClassCheckoutRestart(props.slug, props.festivalSlug)
				.then(({ recoveryReference }) => {
					if (active && request === current)
						setDiscoveredRestart(recoveryReference);
				})
				.catch(() => {});
		}
		function pageShow(event: PageTransitionEvent) {
			if (event.persisted) discoverRestart();
		}
		window.addEventListener("pageshow", pageShow);
		onCleanup(() => {
			active = false;
			window.removeEventListener("pageshow", pageShow);
		});
		discoverRestart();
	});
	const options = useRegistrationOptions({
		slug: props.slug,
		festivalSlug: props.festivalSlug,
		isAuthenticated: authenticated,
		childId: selectedChildId,
		divisionId: selectedDivisionId,
		teacherId: selectedTeacherId,
		onAutoSelectChild: setSelectedChildId,
	});
	const { children, teachers, eligibleClasses, accompanists, loadChildren } =
		options;
	const selectedChild = () => findById(children(), selectedChildId());
	const selectedClass = () => findById(eligibleClasses(), selectedClassId());
	const selectedTeacher = () => findById(teachers(), selectedTeacherId());
	const selectedAccompanist = () =>
		findById(accompanists(), selectedAccompanistId());
	const instruments = () => divisions()?.instruments ?? [];
	const selectedInstrument = () =>
		findById(instruments(), selectedInstrumentId());
	const selectedDivisionName = () =>
		findById(divisions()?.divisions, selectedDivisionId())?.displayName ??
		"Division";
	const classOptionEligibility = useClassOptionEligibility({
		slug: () => props.slug,
		festivalSlug: () => props.festivalSlug,
		csrfToken: getCsrf,
		childId: selectedChildId,
		classes: eligibleClasses,
		cart,
	});
	const eligibility = useCartEligibility({
		slug: () => props.slug,
		festivalSlug: () => props.festivalSlug,
		csrfToken: getCsrf,
		cart,
	});
	const { sessionProfile, currentWaitlistEntry, handleWaitlistEntryChanged } =
		useRegistrationWaitlist({
			slug: props.slug,
			festivalSlug: props.festivalSlug,
			isAuthenticated: authenticated,
			selectedClassId: waitlistClassId,
			selectedChildId,
		});
	const catalogSearch = useConcertoCatalogSearch(
		() => props.slug,
		() => props.festivalSlug,
		() => view() === "class" && doesClassRequireConcerto(selectedClass()),
	);
	const selectHandlers = createRegistrationSelectHandlers(
		setSelectedChildId,
		setSelectedDivisionId,
		setSelectedTeacherId,
		setWaitlistClassId,
		setSelectedAccompanistId,
		setSelectedInstrumentId,
	);
	const activeDraft = () =>
		view() === "class" &&
		!allowLeave &&
		(pieceDirty() ||
			pieces().length > 0 ||
			Boolean(selectedAccompanistId() || selectedInstrumentId()));
	function confirmDiscard() {
		return (
			!activeDraft() || window.confirm("Discard changes to this registration?")
		);
	}
	function clearForm() {
		formRevision++;
		resetClassFormSelection({
			setSelectedClassId: setWaitlistClassId,
			setPieces,
			setSelectedAccompanistId,
			setSelectedInstrumentId,
		});
		setPieceDirty(false);
	}
	useBeforeLeave((event) => {
		if (isSubmittingCheckout()) {
			event.preventDefault();
			return;
		}
		if (!confirmDiscard()) event.preventDefault();
		else {
			allowLeave = false;
			clearForm();
		}
	});
	const beforeUnload = (event: BeforeUnloadEvent) => {
		if (!handingOff && (activeDraft() || isSubmittingCheckout())) {
			event.preventDefault();
			event.returnValue = "";
		}
	};
	const requestSignOut = (event: Event) => {
		if (isAdding() || isSubmittingCheckout()) {
			event.preventDefault();
			setCheckoutError(
				"Please wait for the registration request to finish before signing out.",
			);
			return;
		}
		if (!confirmDiscard()) event.preventDefault();
		else allowLeave = true;
	};
	window.addEventListener("beforeunload", beforeUnload);
	window.addEventListener("festival:request-sign-out", requestSignOut);
	onCleanup(() => {
		window.removeEventListener("beforeunload", beforeUnload);
		window.removeEventListener("festival:request-sign-out", requestSignOut);
	});
	createEffect(() => {
		if (
			view() !== "cart" &&
			authenticated() &&
			options.childrenLoaded() &&
			!options.childrenLoading() &&
			!options.childrenError() &&
			children().length === 0
		) {
			props.app.navigate(
				`/org/${props.slug}/account/children?returnTo=${encodeURIComponent(registerPath())}`,
			);
		}
	});
	const isPurchased = (classId: string) =>
		(purchased()?.registrations ?? []).some(
			(item) =>
				item.entitlement.childId === selectedChildId() &&
				item.entitlement.festivalClassId === classId &&
				item.entitlement.status !== "cancelled" &&
				item.entitlement.status !== "revoked",
		);
	function status(classId: string) {
		if (isPurchased(classId)) return "Purchased";
		if (cart.hasItem(selectedChildId(), classId)) return "In cart";
		if (classOptionEligibility.isWaitlist(classId)) return "Waitlist";
		const info = classOptionEligibility.getOption(classId);
		if (info?.isEligible) return "Available";
		return info?.reasonCode === "MISSING_PREREQUISITE"
			? "Prerequisite unmet"
			: info?.reasonCode === "ALREADY_REGISTERED"
				? "Purchased"
				: "Unavailable";
	}
	function openWaitlist(classId: string) {
		if (!confirmDiscard()) return;
		clearForm();
		setWaitlistClassId(classId);
	}
	async function handleRefreshSnapshot(event: Event) {
		event.preventDefault();
		if (!selectedChildId() || !birthdayDraft()) return;
		setIsRefreshingSnapshot(true);
		setSnapshotError(null);
		try {
			await refreshCustomerChildAgeSnapshot(
				props.slug,
				selectedChildId(),
				getCsrf(),
				birthdayDraft(),
			);
			await loadChildren();
			setBirthdayDraft("");
		} catch (error) {
			setSnapshotError(
				error instanceof Error ? error.message : "Failed to verify birthdate.",
			);
		} finally {
			setIsRefreshingSnapshot(false);
		}
	}
	const localSelectionValid = () =>
		isRegistrationSelectionValid(
			selectedChild(),
			selectedClass(),
			selectedDivisionId(),
			selectedTeacherId(),
			selectedClassId(),
			pieces(),
			catalogSearch.catalogWorks(),
		) &&
		isInstrumentSelectionValid(instruments(), selectedInstrumentId()) &&
		Boolean(selectedTeacher()) &&
		!options.teachersLoading() &&
		!options.classesLoading() &&
		!divisions.loading &&
		!divisions.error &&
		(!selectedAccompanistId() || Boolean(selectedAccompanist()));
	async function handleAddToCart() {
		setCheckoutError(null);
		setCapacityChanged(false);
		const cls = selectedClass(),
			child = selectedChild();
		if (
			!cls ||
			!child ||
			!localSelectionValid() ||
			pieceDirty() ||
			isAdding() ||
			Boolean(cart.checkoutSubmission()) ||
			isPurchased(cls.id) ||
			cart.hasItem(child.id, cls.id)
		)
			return;
		setIsAdding(true);
		const revision = formRevision;
		try {
			const input = buildCartItemInput(
				child,
				selectedDivisionId(),
				selectedDivisionName(),
				selectedTeacher(),
				cls,
				selectedAccompanist(),
				pieces(),
				selectedInstrument(),
			);
			const candidate = {
				...cartItemsToLineItemInputs([{ ...input, lineId: "candidate" }])[0],
				id: `candidate:${cls.id}`,
				isCandidate: true,
			};
			const response = await evaluateRegistrationEligibility(
				props.slug,
				props.festivalSlug,
				[...cartItemsToLineItemInputs(cart.items()), candidate],
				getCsrf(),
			);
			if (disposed || revision !== formRevision || view() !== "class") return;
			const result = response.results.find(
				(item) =>
					item.childId === child.id &&
					item.festivalClassId === cls.id &&
					(!item.lineItemId || item.lineItemId === candidate.id),
			);
			if (
				!result?.eligible ||
				!result.isEligible ||
				result.reasonCode !== "AVAILABLE"
			) {
				setCapacityChanged(
					result?.reasonCode === "SOLD_OUT" ||
						result?.availability === "waitlist",
				);
				throw new Error(
					result?.message ||
						"This registration could not be verified. Please try again.",
				);
			}
			cart.addItem(input);
			allowLeave = true;
			clearForm();
			props.app.navigate(registerPath());
		} catch (error) {
			setCheckoutError(
				error instanceof Error
					? error.message
					: "Unable to add this registration.",
			);
		} finally {
			setIsAdding(false);
		}
	}
	function handOffCheckout(
		checkoutUrl: string,
		submission: RegistrationCheckoutSubmission,
	) {
		handingOff = true;
		completeHandoff = () => {
			setDiscoveredRestart(null);
			cart.completeCheckout(submission);
			handingOff = false;
			setIsSubmittingCheckout(false);
		};
		window.addEventListener("pagehide", completeHandoff, { once: true });
		window.location.assign(checkoutUrl);
	}
	function handleCheckoutError(error: unknown, validationMayRelease = false) {
		handingOff = false;
		if (completeHandoff)
			window.removeEventListener("pagehide", completeHandoff);
		if (error instanceof ApiError && error.recovery) {
			cart.setCheckoutRecovery(error.recovery);
		} else if (
			validationMayRelease &&
			error instanceof ApiError &&
			error.status === 409 &&
			error.code === "checkout_pre_dispatch_rejected"
		) {
			cart.releaseCheckout({ retireKey: true });
			setCheckoutError(
				"Your registrations are still in your cart. Please try checking out again.",
			);
			return;
		} else if (
			validationMayRelease &&
			error instanceof ApiError &&
			[400, 404, 422].includes(error.status)
		) {
			// These are definitive validation rejections before external dispatch.
			cart.releaseCheckout();
		}
		setCheckoutError(
			error instanceof Error
				? error.message
				: "Checkout failed. Please try again.",
		);
	}
	async function handleRefreshCheckout() {
		const recovery = cart.checkoutRecovery();
		const submission = cart.checkoutSubmission();
		if (!recovery || !submission || isSubmittingCheckout()) return;
		setCheckoutError(null);
		setIsSubmittingCheckout(true);
		try {
			const result = await getClassCheckoutRecoveryStatus(
				props.slug,
				props.festivalSlug,
				recovery.recoveryReference,
				getCsrf(),
				submission.idempotencyKey,
			);
			if (disposed || cart.checkoutSubmission() !== submission) return;
			cart.setCheckoutRecovery(result);
			if (result.checkoutUrl) handOffCheckout(result.checkoutUrl, submission);
		} catch (error) {
			handleCheckoutError(error);
		} finally {
			if (!handingOff) setIsSubmittingCheckout(false);
		}
	}
	function handleRestartCheckout() {
		if (isSubmittingCheckout()) return;
		if (cart.restartAbandonedCheckout()) setCheckoutError(null);
	}
	async function handleRestoreCheckout() {
		const recoveryReference = checkoutRestartReference();
		if (!recoveryReference || isSubmittingCheckout()) return;
		const csrfToken = getCsrf();
		setCheckoutError(null);
		setIsSubmittingCheckout(true);
		try {
			const restart = await restartClassCheckout(
				props.slug,
				props.festivalSlug,
				recoveryReference,
				csrfToken,
			);
			if (!disposed && getCsrf() === csrfToken)
				cart.restoreCheckout(recoveryReference, restart);
		} catch (error) {
			if (!disposed && getCsrf() === csrfToken) handleCheckoutError(error);
		} finally {
			setIsSubmittingCheckout(false);
		}
	}
	async function handleCartCheckout() {
		if (cart.itemCount() === 0 || isSubmittingCheckout()) return;
		const recovery = cart.checkoutRecovery();
		if (recovery && !recovery.retryAllowed) return;
		setCheckoutError(null);
		setIsSubmittingCheckout(true);
		try {
			// An existing submission must reach server-side resume even if a new
			// advisory capacity check would reject a fresh cart.
			if (!cart.checkoutSubmission()) {
				await eligibility.recheck();
				if (!eligibility.isCartEligible())
					throw new Error(
						eligibility.error() ||
							"Resolve the cart's eligibility issues before checkout.",
					);
			}
			const submission = cart.beginCheckout();
			const res = await startClassCheckout(props.slug, props.festivalSlug, {
				lineItems: submission.lineItems,
				csrfToken: getCsrf(),
				idempotencyKey: submission.idempotencyKey,
			});
			if (disposed || cart.checkoutSubmission() !== submission) return;
			if (!res?.checkoutUrl)
				throw new Error("Checkout failed to initialize. Please try again.");
			handOffCheckout(res.checkoutUrl, submission);
		} catch (error) {
			handleCheckoutError(error, true);
		} finally {
			if (!handingOff) setIsSubmittingCheckout(false);
		}
	}
	return {
		view,
		registerPath,
		authenticated,
		festival,
		divisions,
		retryDivisions,
		purchased,
		waitlistClassId,
		setWaitlistClassId,
		selectedChildId,
		selectedDivisionId,
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
		birthdayDraft,
		setBirthdayDraft,
		isRefreshingSnapshot,
		snapshotError,
		options,
		children,
		teachers,
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
		handleRefreshSnapshot,
		localSelectionValid,
		handleAddToCart,
		handleCartCheckout,
		handleRefreshCheckout,
		handleRestartCheckout,
		checkoutRestartReference,
		handleRestoreCheckout,
		cart,
	};
}
