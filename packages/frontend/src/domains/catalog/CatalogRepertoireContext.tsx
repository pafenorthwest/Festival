import type { FestivalSummary } from "@festival/common";
import {
	validateFestivalDates,
	validateFestivalName,
	validateFestivalRegistrationWindow,
} from "@festival/common";
import {
	createContext,
	createEffect,
	createMemo,
	createSignal,
	type ParentProps,
	useContext,
} from "solid-js";
import type { FestivalDraft } from "../../app/appTypes.js";
import { getIdToken } from "../../app/createFestivalDataLoaders.js";
import { useFestivalShell } from "../../app/FestivalShellContext.js";
import { createFestival, getFestivals } from "../../lib/api.js";

const INITIAL_FESTIVAL_DRAFT: FestivalDraft = {
	shortName: "",
	name: "",
	startDate: "",
	endDate: "",
	registrationOpensAt: "",
	registrationClosesAt: "",
};

function createCatalogRepertoireState() {
	const shell = useFestivalShell();
	const [festivals, setFestivals] = createSignal<FestivalSummary[]>([]);
	const [festivalDraft, setFestivalDraft] = createSignal<FestivalDraft>({
		...INITIAL_FESTIVAL_DRAFT,
	});
	const [festivalNameTouched, setFestivalNameTouched] = createSignal(false);
	const [createFestivalAttempted, setCreateFestivalAttempted] =
		createSignal(false);

	const festivalNameValidation = createMemo(() =>
		validateFestivalName(festivalDraft().name),
	);
	const shouldShowFestivalNameValidation = createMemo(
		() => createFestivalAttempted() || festivalNameTouched(),
	);
	const hasFestivalNameError = createMemo(
		() => shouldShowFestivalNameValidation() && !festivalNameValidation().valid,
	);
	const festivalNameValidationMessage = createMemo(() =>
		festivalNameValidation().errors.join(" "),
	);

	async function loadFestivals(slug: string) {
		const token = await getIdToken(shell.firebaseUser());
		if (!token) {
			return;
		}

		const response = await getFestivals(token, slug);
		setFestivals(response.festivals);
	}

	createEffect(() => {
		const currentRoute = shell.route();
		const role = shell.sessionMembership()?.role ?? "";
		if (
			currentRoute.kind === "org-admin-volunteers" &&
			["Admin", "Division Chair", "Concert Chair"].includes(role)
		) {
			void loadFestivals(currentRoute.slug);
			return;
		}

		if (!shell.isAdminMember()) {
			return;
		}

		if (
			currentRoute.kind === "org-admin-festivals" ||
			currentRoute.kind === "org-admin-volunteers" ||
			currentRoute.kind === "org-admin-rooms"
		) {
			void loadFestivals(currentRoute.slug);
		}
	});

	async function handleCreateFestival() {
		const user = shell.firebaseUser();
		const currentRoute = shell.route();
		if (!user || currentRoute.kind !== "org-admin-festivals") {
			return;
		}

		setCreateFestivalAttempted(true);
		const nameValidation = festivalNameValidation();
		const draft = festivalDraft();
		if (!nameValidation.valid) {
			shell.setStatusMessage("");
			return;
		}

		if (!draft.startDate || !draft.endDate) {
			shell.setErrorMessage("Festival start date and end date are required.");
			return;
		}

		const dateValidation = validateFestivalDates(draft);
		if (!dateValidation.valid) {
			shell.setErrorMessage(dateValidation.errors.join(" "));
			return;
		}

		const rawOpensAt = draft.registrationOpensAt?.trim() || null;
		const rawClosesAt = draft.registrationClosesAt?.trim() || null;
		const windowValidation = validateFestivalRegistrationWindow(
			{
				registrationOpensAt: rawOpensAt,
				registrationClosesAt: rawClosesAt,
			},
			shell.organization()?.timezone ?? "UTC",
		);
		if (!windowValidation.isValid) {
			shell.setErrorMessage(windowValidation.errors.join(" "));
			return;
		}

		shell.setIsBusy(true);
		shell.clearMessages();
		try {
			const token = await user.getIdToken();
			await createFestival(token, currentRoute.slug, {
				shortName: draft.shortName,
				name: nameValidation.normalized,
				startDate: draft.startDate,
				endDate: draft.endDate,
				...(rawOpensAt || rawClosesAt
					? {
							registrationOpensAt: rawOpensAt,
							registrationClosesAt: rawClosesAt,
						}
					: {}),
			});
			setFestivalDraft({ ...INITIAL_FESTIVAL_DRAFT });
			setFestivalNameTouched(false);
			setCreateFestivalAttempted(false);
			await loadFestivals(currentRoute.slug);
			shell.setStatusMessage("Festival created.");
		} catch (error) {
			shell.setErrorMessage((error as Error).message);
		} finally {
			shell.setIsBusy(false);
		}
	}

	return {
		createFestivalAttempted,
		festivalDraft,
		festivalNameTouched,
		festivalNameValidation,
		festivalNameValidationMessage,
		festivals,
		handleCreateFestival,
		hasFestivalNameError,
		loadFestivals,
		setCreateFestivalAttempted,
		setFestivalDraft,
		setFestivalNameTouched,
		setFestivals,
		shouldShowFestivalNameValidation,
	};
}

export type CatalogRepertoireContextValue = ReturnType<
	typeof createCatalogRepertoireState
>;

const CatalogRepertoireContext = createContext<CatalogRepertoireContextValue>();

export function CatalogRepertoireProvider(props: ParentProps) {
	const value = createCatalogRepertoireState();
	return (
		<CatalogRepertoireContext.Provider value={value}>
			{props.children}
		</CatalogRepertoireContext.Provider>
	);
}

export function useCatalogRepertoire(): CatalogRepertoireContextValue {
	const context = useContext(CatalogRepertoireContext);
	if (!context) {
		throw new Error(
			"useCatalogRepertoire must be used within a CatalogRepertoireProvider.",
		);
	}
	return context;
}
