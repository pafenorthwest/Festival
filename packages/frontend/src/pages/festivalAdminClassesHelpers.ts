import type {
	FestivalClassConfigurationDto,
	OrganizationDivision,
	RegistrationCatalogValue,
} from "@festival/common";
import { createMemo, createSignal } from "solid-js";

const PRICE_REGEX = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

export interface FestivalClassFormDraft {
	displayName: string;
	divisionId: string;
	classSubtypeId: string;
	price: string;
	minimumAge: number;
	maximumAge: number;
	maximumPerformancePieces: 1 | 2 | 3;
	performanceMinutes: number;
	capacity: number;
	isActive: boolean;
}

export const initialClassFormDraft: FestivalClassFormDraft = {
	displayName: "",
	divisionId: "",
	classSubtypeId: "",
	price: "",
	minimumAge: 0,
	maximumAge: 18,
	maximumPerformancePieces: 1,
	performanceMinutes: 10,
	capacity: 100,
	isActive: true,
};

export function validatePrice(price: string): string | null {
	if (!price?.trim()) return "Price is required.";
	if (!PRICE_REGEX.test(price.trim())) {
		return "Price must be a valid decimal amount (e.g. 35.00).";
	}
	return null;
}

export function validateAges(
	min: number,
	max: number,
): { minError?: string; maxError?: string } | null {
	let minError: string | undefined;
	let maxError: string | undefined;

	if (!Number.isInteger(min) || min < 0) {
		minError = "Minimum age must be a non-negative integer.";
	}
	if (!Number.isInteger(max) || max < 0) {
		maxError = "Maximum age must be a non-negative integer.";
	}
	if (!minError && !maxError && max < min) {
		maxError = "Maximum age must be greater than or equal to minimum age.";
	}

	if (minError || maxError) return { minError, maxError };
	return null;
}

export function validatePieces(pieces: number): string | null {
	if (pieces !== 1 && pieces !== 2 && pieces !== 3) {
		return "Maximum performance pieces must be 1, 2, or 3.";
	}
	return null;
}

export function validateMinutes(minutes: number): string | null {
	if (!Number.isInteger(minutes) || minutes <= 0) {
		return "Performance minutes must be a positive integer.";
	}
	return null;
}

export function validateCapacity(capacity: number): string | null {
	if (!Number.isInteger(capacity) || capacity <= 0) {
		return "Capacity must be a positive integer.";
	}
	return null;
}

export function validateDisplayName(name: string): string | null {
	if (!name?.trim()) return "Class name is required.";
	if (name.trim().length > 150) {
		return "Class name must be 150 characters or fewer.";
	}
	return null;
}

export function formatAgeRange(min: number, max: number): string {
	return `${min}–${max}`;
}

export function formatDuration(minutes: number): string {
	return `${minutes} min`;
}

export function formatPrice(price: string): string {
	return `$${price}`;
}

export function classToDraft(
	c: FestivalClassConfigurationDto,
): FestivalClassFormDraft {
	return {
		displayName: c.displayName,
		divisionId: c.divisionId,
		classSubtypeId: c.classSubtypeId,
		price: c.price,
		minimumAge: c.minimumAge,
		maximumAge: c.maximumAge,
		maximumPerformancePieces: c.maximumPerformancePieces as 1 | 2 | 3,
		performanceMinutes: c.performanceMinutes,
		capacity: c.capacity,
		isActive: c.isActive,
	};
}

export function draftToCreateInput(draft: FestivalClassFormDraft) {
	return {
		displayName: draft.displayName.trim(),
		divisionId: draft.divisionId,
		classSubtypeId: draft.classSubtypeId,
		price: draft.price.trim(),
		minimumAge: draft.minimumAge,
		maximumAge: draft.maximumAge,
		maximumPerformancePieces: draft.maximumPerformancePieces,
		performanceMinutes: draft.performanceMinutes,
		capacity: draft.capacity,
		isActive: draft.isActive,
	};
}

export function draftToUpdateInput(draft: FestivalClassFormDraft) {
	return {
		displayName: draft.displayName.trim(),
		price: draft.price.trim(),
		minimumAge: draft.minimumAge,
		maximumAge: draft.maximumAge,
		maximumPerformancePieces: draft.maximumPerformancePieces,
		performanceMinutes: draft.performanceMinutes,
		capacity: draft.capacity,
		isActive: draft.isActive,
	};
}

export function getDivisionName(
	divisions: OrganizationDivision[],
	id: string,
): string {
	return divisions.find((d) => d.id === id)?.displayName ?? id;
}

export function getSubtypeName(
	subtypes: RegistrationCatalogValue[],
	id: string,
): string {
	return subtypes.find((s) => s.id === id)?.displayName ?? id;
}

export function resolveErrorMessage(err: unknown, fallback: string): string {
	return err instanceof Error ? err.message : fallback;
}

export function getModalDivisionName(
	editing: FestivalClassConfigurationDto | null,
	divisions: OrganizationDivision[],
): string | undefined {
	return editing ? getDivisionName(divisions, editing.divisionId) : undefined;
}

export function getModalSubtypeName(
	editing: FestivalClassConfigurationDto | null,
	subtypes: RegistrationCatalogValue[],
): string | undefined {
	return editing ? getSubtypeName(subtypes, editing.classSubtypeId) : undefined;
}

export function getModalInitialDraft(
	editing: FestivalClassConfigurationDto | null,
): FestivalClassFormDraft {
	return editing ? classToDraft(editing) : initialClassFormDraft;
}

export function formatWaitlistTimestamp(isoDate: string): string {
	if (!isoDate) return "N/A";
	const d = new Date(isoDate);
	if (Number.isNaN(d.getTime())) return isoDate;
	return d.toLocaleString("en-US", {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

export function replaceClassItem(
	list: FestivalClassConfigurationDto[],
	updated: FestivalClassConfigurationDto,
): FestivalClassConfigurationDto[] {
	return list.map((c) => (c.id === updated.id ? updated : c));
}

export function createClassesPageSignals() {
	const [classes, setClasses] = createSignal<FestivalClassConfigurationDto[]>(
		[],
	);
	const [divisions, setDivisions] = createSignal<OrganizationDivision[]>([]);
	const [classSubtypes, setClassSubtypes] = createSignal<
		RegistrationCatalogValue[]
	>([]);
	const [isLoadingData, setIsLoadingData] = createSignal(false);
	const [dataError, setDataError] = createSignal<string | null>(null);
	const [actionError, setActionError] = createSignal<string | null>(null);
	const [isCreateModalOpen, setIsCreateModalOpen] = createSignal(false);
	const [editingClass, setEditingClass] =
		createSignal<FestivalClassConfigurationDto | null>(null);
	const [waitlistClass, setWaitlistClass] =
		createSignal<FestivalClassConfigurationDto | null>(null);
	const [isSavingModal, setIsSavingModal] = createSignal(false);
	const [modalError, setModalError] = createSignal<string | null>(null);

	function resetForScopeChange() {
		setIsLoadingData(false);
		setClasses([]);
		setDivisions([]);
		setClassSubtypes([]);
		setDataError(null);
		setActionError(null);
		setIsCreateModalOpen(false);
		setEditingClass(null);
		setWaitlistClass(null);
		setModalError(null);
	}

	const activeDivisions = createMemo(() =>
		divisions().filter((d) => d.isActive),
	);
	const activeSubtypes = createMemo(() =>
		classSubtypes().filter((sub) => sub.isActive),
	);

	function openCreateModal() {
		setModalError(null);
		setIsCreateModalOpen(true);
	}

	function openEditModal(item: FestivalClassConfigurationDto) {
		setModalError(null);
		setEditingClass(item);
	}

	function closeModal() {
		setIsCreateModalOpen(false);
		setEditingClass(null);
	}

	return {
		classes,
		setClasses,
		divisions,
		setDivisions,
		classSubtypes,
		setClassSubtypes,
		activeDivisions,
		activeSubtypes,
		isLoadingData,
		setIsLoadingData,
		dataError,
		setDataError,
		actionError,
		setActionError,
		isCreateModalOpen,
		setIsCreateModalOpen,
		editingClass,
		setEditingClass,
		waitlistClass,
		setWaitlistClass,
		isSavingModal,
		setIsSavingModal,
		modalError,
		setModalError,
		openCreateModal,
		openEditModal,
		closeModal,
		resetForScopeChange,
	};
}
