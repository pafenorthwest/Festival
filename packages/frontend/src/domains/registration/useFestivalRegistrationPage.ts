import type { RepertoirePiece } from "@festival/common";
import { createSignal, onCleanup } from "solid-js";
import type { FestivalAppController } from "../../app/useFestivalAppController.js";
import { buildFestivalRegistrationPath } from "../../lib/routes.js";
import {
	createRegistrationSelectHandlers,
	doesClassRequireConcerto,
	findById,
	isInstrumentSelectionValid,
	isRegistrationSelectionValid,
} from "../../pages/festivalRegistrationHelpers.js";
import {
	useConcertoCatalogSearch,
	useRegistrationOptions,
	useRegistrationWaitlist,
} from "../../pages/festivalRegistrationHooks.js";
import {
	type RegistrationCartItem,
	resetClassFormSelection,
} from "../../pages/registrationCartState.js";
import { useCartEligibility } from "../../pages/useCartEligibility.js";
import { useClassOptionEligibility } from "../../pages/useClassOptionEligibility.js";
import { useCustomerIdentity } from "../customer/CustomerIdentityContext.js";
import {
	canJoinCartWaitlistItem,
	createAddToCartHandler,
	createCheckoutRecoveryHandlers,
	createSnapshotHandler,
	formatClassStatus,
	type WaitlistTarget,
} from "./registrationPageActions.js";
import {
	createCheckoutRestartRef,
	createRegistrationResources,
	setupLeaveAndRedirectGuards,
	setupRestartDiscoveryEffect,
} from "./registrationPageEffects.js";

export interface FestivalClassRegistrationPageProps {
	app: FestivalAppController;
	slug: string;
	festivalSlug: string;
	view?: "workspace" | "class" | "cart";
	classId?: string;
}

function createLocalSignals() {
	const [selectedWaitlistTarget, setWaitlistTarget] =
		createSignal<WaitlistTarget | null>(null);
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
	const [capacityChanged, setCapacityChanged] = createSignal(false);
	const [birthdayDraft, setBirthdayDraft] = createSignal("");
	const [isRefreshingSnapshot, setIsRefreshingSnapshot] = createSignal(false);
	const [snapshotError, setSnapshotError] = createSignal<string | null>(null);
	return {
		selectedWaitlistTarget,
		setWaitlistTarget,
		selectedAccompanistId,
		setSelectedAccompanistId,
		selectedInstrumentId,
		setSelectedInstrumentId,
		pieces,
		setPieces,
		pieceDirty,
		setPieceDirty,
		isSubmittingCheckout,
		setIsSubmittingCheckout,
		isAdding,
		setIsAdding,
		checkoutError,
		setCheckoutError,
		discoveredRestart,
		setDiscoveredRestart,
		capacityChanged,
		setCapacityChanged,
		birthdayDraft,
		setBirthdayDraft,
		isRefreshingSnapshot,
		setIsRefreshingSnapshot,
		snapshotError,
		setSnapshotError,
	};
}

export function useFestivalRegistrationPage(
	props: FestivalClassRegistrationPageProps,
) {
	const customerIdentity = useCustomerIdentity();
	const workspace = props.app.parentRegistration.workspace(
		props.slug,
		props.festivalSlug,
	);
	props.app.parentRegistration.setActiveFestival(
		props.slug,
		props.festivalSlug,
	);
	const cart = workspace.cart;
	const selectedChildId = workspace.childId;
	const setSelectedChildId = workspace.setChildId;
	const selectedDivisionId = workspace.divisionId;
	const setSelectedDivisionId = workspace.setDivisionId;
	const selectedTeacherId = workspace.teacherId;
	const setSelectedTeacherId = workspace.setTeacherId;
	const view = () => props.view ?? "workspace";
	const registerPath = () =>
		buildFestivalRegistrationPath(props.slug, props.festivalSlug);
	const authenticated = () => customerIdentity.customerSession().authenticated;
	const getCsrf = () => {
		const session = customerIdentity.customerSession();
		return session.authenticated ? session.csrfToken : "";
	};
	const { festival, divisions, retryDivisions, purchased } =
		createRegistrationResources(props.slug, props.festivalSlug, authenticated);
	const signals = createLocalSignals();
	const waitlistTarget = () => {
		const target = signals.selectedWaitlistTarget();
		if (
			target?.lineId &&
			!cart.items().some((item) => item.lineId === target.lineId)
		) {
			return null;
		}
		return target;
	};
	const selectedClassId = () =>
		props.classId ?? waitlistTarget()?.classId ?? "";
	const checkoutRestartReference = createCheckoutRestartRef(
		cart,
		props.festivalSlug,
		signals.discoveredRestart,
	);

	let allowLeave = false;
	let handingOff = false;
	let completeHandoff: (() => void) | undefined;
	let formRevision = 0;
	let disposed = false;
	onCleanup(() => {
		disposed = true;
		if (completeHandoff) {
			window.removeEventListener("pagehide", completeHandoff);
		}
	});
	setupRestartDiscoveryEffect({
		view,
		authenticated,
		slug: props.slug,
		festivalSlug: props.festivalSlug,
		setDiscoveredRestart: signals.setDiscoveredRestart,
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
		findById(accompanists(), signals.selectedAccompanistId());
	const instruments = () => divisions()?.instruments ?? [];
	const selectedInstrument = () =>
		findById(instruments(), signals.selectedInstrumentId());
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
			selectedClassId: () => waitlistTarget()?.classId ?? "",
			selectedChildId: () => waitlistTarget()?.childId ?? "",
		});
	const catalogSearch = useConcertoCatalogSearch(
		() => props.slug,
		() => props.festivalSlug,
		() => view() === "class" && doesClassRequireConcerto(selectedClass()),
	);
	const closeWaitlist = () => signals.setWaitlistTarget(null);
	const selectHandlers = createRegistrationSelectHandlers(
		setSelectedChildId,
		setSelectedDivisionId,
		setSelectedTeacherId,
		closeWaitlist,
		signals.setSelectedAccompanistId,
		signals.setSelectedInstrumentId,
	);
	const activeDraft = () =>
		view() === "class" &&
		!allowLeave &&
		(signals.pieceDirty() ||
			signals.pieces().length > 0 ||
			Boolean(
				signals.selectedAccompanistId() || signals.selectedInstrumentId(),
			));
	const confirmDiscard = () =>
		!activeDraft() || window.confirm("Discard changes to this registration?");
	const clearForm = () => {
		formRevision++;
		resetClassFormSelection({
			setSelectedClassId: closeWaitlist,
			setPieces: signals.setPieces,
			setSelectedAccompanistId: signals.setSelectedAccompanistId,
			setSelectedInstrumentId: signals.setSelectedInstrumentId,
		});
		signals.setPieceDirty(false);
	};

	setupLeaveAndRedirectGuards({
		view,
		authenticated,
		slug: props.slug,
		registerPath,
		navigate: props.app.navigate,
		options,
		activeDraft,
		confirmDiscard,
		clearForm,
		isAdding: signals.isAdding,
		isSubmittingCheckout: signals.isSubmittingCheckout,
		isHandingOff: () => handingOff,
		setAllowLeave: (val) => {
			allowLeave = val;
		},
		setCheckoutError: signals.setCheckoutError,
	});

	const isPurchased = (classId: string) =>
		purchased.state === "ready" &&
		(purchased()?.registrations ?? []).some(
			(item) =>
				item.entitlement.childId === selectedChildId() &&
				item.entitlement.festivalClassId === classId &&
				item.entitlement.status !== "cancelled" &&
				item.entitlement.status !== "revoked",
		);
	const status = (classId: string) =>
		formatClassStatus(
			classId,
			selectedChildId(),
			isPurchased,
			cart,
			classOptionEligibility,
		);
	const openWaitlist = (classId: string) => {
		if (!confirmDiscard()) return;
		clearForm();
		signals.setWaitlistTarget({
			classId,
			className: findById(eligibleClasses(), classId)?.displayName ?? "Class",
			childId: selectedChildId(),
			childName: selectedChild()?.displayName ?? "Performer",
		});
	};
	const canJoinCartWaitlist = (item: RegistrationCartItem) =>
		canJoinCartWaitlistItem(
			item,
			signals.isSubmittingCheckout(),
			cart,
			eligibility,
		);
	const openCartWaitlist = (item: RegistrationCartItem) => {
		if (canJoinCartWaitlist(item)) signals.setWaitlistTarget(item);
	};
	const handleRefreshSnapshot = createSnapshotHandler({
		slug: props.slug,
		getCsrf,
		selectedChildId,
		birthdayDraft: signals.birthdayDraft,
		setBirthdayDraft: signals.setBirthdayDraft,
		setIsRefreshingSnapshot: signals.setIsRefreshingSnapshot,
		setSnapshotError: signals.setSnapshotError,
		loadChildren,
	});
	const localSelectionValid = () =>
		isRegistrationSelectionValid(
			selectedChild(),
			selectedClass(),
			selectedDivisionId(),
			selectedTeacherId(),
			selectedClassId(),
			signals.pieces(),
			catalogSearch.catalogWorks(),
		) &&
		isInstrumentSelectionValid(instruments(), signals.selectedInstrumentId()) &&
		Boolean(selectedTeacher()) &&
		!options.teachersLoading() &&
		!options.classesLoading() &&
		!divisions.loading &&
		!divisions.error &&
		(!signals.selectedAccompanistId() || Boolean(selectedAccompanist()));

	const handleAddToCart = createAddToCartHandler({
		slug: props.slug,
		festivalSlug: props.festivalSlug,
		getCsrf,
		cart,
		view,
		registerPath,
		navigate: props.app.navigate,
		selectedChild,
		selectedDivisionId,
		selectedDivisionName,
		selectedTeacher,
		selectedClass,
		selectedAccompanist,
		selectedInstrument,
		pieces: signals.pieces,
		pieceDirty: signals.pieceDirty,
		isAdding: signals.isAdding,
		setIsAdding: signals.setIsAdding,
		localSelectionValid,
		isPurchased,
		setCheckoutError: signals.setCheckoutError,
		setCapacityChanged: signals.setCapacityChanged,
		getFormRevision: () => formRevision,
		isDisposed: () => disposed,
		setAllowLeave: (val) => {
			allowLeave = val;
		},
		clearForm,
	});
	const checkoutHandlers = createCheckoutRecoveryHandlers({
		slug: props.slug,
		festivalSlug: props.festivalSlug,
		getCsrf,
		cart,
		eligibility,
		isSubmittingCheckout: signals.isSubmittingCheckout,
		setIsSubmittingCheckout: signals.setIsSubmittingCheckout,
		setCheckoutError: signals.setCheckoutError,
		setDiscoveredRestart: signals.setDiscoveredRestart,
		checkoutRestartReference,
		isDisposed: () => disposed,
		setHandingOff: (val) => {
			handingOff = val;
		},
		isHandingOff: () => handingOff,
		setCompleteHandoff: (fn) => {
			completeHandoff = fn;
		},
		getCompleteHandoff: () => completeHandoff,
	});

	return {
		view,
		registerPath,
		authenticated,
		festival,
		divisions,
		retryDivisions,
		purchased,
		waitlistTarget,
		closeWaitlist,
		selectedChildId,
		selectedDivisionId,
		selectedTeacherId,
		selectedAccompanistId: signals.selectedAccompanistId,
		selectedInstrumentId: signals.selectedInstrumentId,
		pieces: signals.pieces,
		setPieces: signals.setPieces,
		pieceDirty: signals.pieceDirty,
		setPieceDirty: signals.setPieceDirty,
		isSubmittingCheckout: signals.isSubmittingCheckout,
		isAdding: signals.isAdding,
		checkoutError: signals.checkoutError,
		capacityChanged: signals.capacityChanged,
		birthdayDraft: signals.birthdayDraft,
		setBirthdayDraft: signals.setBirthdayDraft,
		isRefreshingSnapshot: signals.isRefreshingSnapshot,
		snapshotError: signals.snapshotError,
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
		canJoinCartWaitlist,
		openCartWaitlist,
		handleRefreshSnapshot,
		localSelectionValid,
		handleAddToCart,
		...checkoutHandlers,
		checkoutRestartReference,
		cart,
	};
}

export type FestivalRegistrationPageState = ReturnType<
	typeof useFestivalRegistrationPage
>;
