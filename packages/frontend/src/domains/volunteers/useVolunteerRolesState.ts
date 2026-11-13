import {
	type Accessor,
	createMemo,
	createResource,
	createSignal,
	type Resource,
	type Setter,
} from "solid-js";
import {
	type CreateVolunteerRoleInput,
	type CreateVolunteerShiftInput,
	createVolunteerRole,
	createVolunteerShift,
	deleteVolunteerRole,
	deleteVolunteerShift,
	getVolunteerCoverageGaps,
	getVolunteerShiftsForRole,
	updateVolunteerRole,
	updateVolunteerShift,
	type VolunteerRole,
	type VolunteerShift,
} from "../../lib/api.js";

const emptyRoleDraft: CreateVolunteerRoleInput = {
	slug: "",
	displayName: "",
	description: "",
	detailsUrl: "",
	isRoomProctor: false,
};

const emptyShiftDraft: CreateVolunteerShiftInput = {
	date: "",
	period: "AM",
	timeText: "",
	division: "",
	adjudicator: "",
};

export interface VolunteerRolesStateParams {
	slug: Accessor<string>;
	idToken: Accessor<string | null>;
	festivalShortName: Accessor<string | undefined>;
	roles: Resource<VolunteerRole[]>;
	refetchRoles: () => Promise<VolunteerRole[] | undefined> | unknown;
}

function useCrudSignals<TDraft>(emptyDraft: TDraft) {
	const [draft, setDraft] = createSignal(emptyDraft);
	const [formError, setFormError] = createSignal<string | null>(null);
	const [isSubmitting, setIsSubmitting] = createSignal(false);
	const [editingId, setEditingId] = createSignal<string | null>(null);
	const [deletingId, setDeletingId] = createSignal<string | null>(null);

	function startEdit(id: string, nextDraft: TDraft) {
		setFormError(null);
		setEditingId(id);
		setDraft(() => nextDraft);
	}

	function cancelEdit() {
		setEditingId(null);
		setDraft(() => emptyDraft);
		setFormError(null);
	}

	async function run(
		fallbackMessage: string,
		task: () => Promise<void>,
		deleteTargetId?: string,
	) {
		setFormError(null);
		if (deleteTargetId) setDeletingId(deleteTargetId);
		else setIsSubmitting(true);
		try {
			await task();
		} catch (error) {
			setFormError(error instanceof Error ? error.message : fallbackMessage);
		} finally {
			if (deleteTargetId) setDeletingId(null);
			else setIsSubmitting(false);
		}
	}

	return {
		draft,
		setDraft: setDraft as Setter<TDraft>,
		formError,
		isSubmitting,
		editingId,
		setEditingId,
		deletingId,
		startEdit,
		cancelEdit,
		run,
	};
}

function useCoverageGapsState(params: VolunteerRolesStateParams) {
	const [coverageGaps, { refetch: refetchCoverageGaps }] = createResource(
		() => {
			const token = params.idToken();
			const festival = params.festivalShortName();
			return token && festival ? ([token, festival] as const) : undefined;
		},
		([token, festival]) =>
			getVolunteerCoverageGaps(params.slug(), festival, token),
	);
	// "all" | "Filled" | "Open": which of the three summary counts is the
	// active filter for the slot list below them. See #232.
	const [slotStatusFilter, setSlotStatusFilter] = createSignal<
		"all" | "Filled" | "Open"
	>("all");
	const filteredSlots = createMemo(() => {
		const slots = coverageGaps()?.slots ?? [];
		const filter = slotStatusFilter();
		return filter === "all" ? slots : slots.filter((s) => s.status === filter);
	});
	return {
		coverageGaps,
		refetchCoverageGaps,
		slotStatusFilter,
		setSlotStatusFilter,
		filteredSlots,
	};
}

function useRoleCrudState(
	ctx: VolunteerRolesStateParams,
	onRolesChanged: () => Promise<void>,
	onRoleDeleted: (roleId: string) => void,
) {
	const crud = useCrudSignals(emptyRoleDraft);
	const startEditRole = (role: VolunteerRole) =>
		crud.startEdit(role.id, {
			slug: "",
			displayName: role.displayName,
			description: role.description,
			detailsUrl: role.detailsUrl ?? "",
			isRoomProctor: role.isRoomProctor,
		});
	const cancelEditRole = () => crud.cancelEdit();

	async function handleRoleFormSubmit(event: Event) {
		event.preventDefault();
		const token = ctx.idToken();
		const festival = ctx.festivalShortName();
		if (!token || !festival) return;
		const editingId = crud.editingId();
		await crud.run(
			`Could not ${editingId ? "update" : "create"} role.`,
			async () => {
				if (editingId) {
					await updateVolunteerRole(
						token,
						ctx.slug(),
						festival,
						editingId,
						crud.draft(),
					);
					crud.setEditingId(null);
				} else {
					await createVolunteerRole(token, ctx.slug(), festival, crud.draft());
				}
				crud.setDraft(emptyRoleDraft);
				await onRolesChanged();
			},
		);
	}

	async function handleDeleteRole(role: { id: string; displayName: string }) {
		const token = ctx.idToken();
		const festival = ctx.festivalShortName();
		if (!token || !festival) return;
		if (
			!confirm(
				`Delete the "${role.displayName}" role? This also deletes all of its shifts.`,
			)
		)
			return;
		await crud.run(
			"Could not delete role.",
			async () => {
				await deleteVolunteerRole(token, ctx.slug(), festival, role.id);
				if (crud.editingId() === role.id) cancelEditRole();
				onRoleDeleted(role.id);
				await onRolesChanged();
			},
			role.id,
		);
	}

	return {
		roleDraft: crud.draft,
		setRoleDraft: crud.setDraft,
		roleFormError: crud.formError,
		isCreatingRole: crud.isSubmitting,
		editingRoleId: crud.editingId,
		deletingRoleId: crud.deletingId,
		startEditRole,
		cancelEditRole,
		handleRoleFormSubmit,
		handleDeleteRole,
	};
}

function useShiftCrudState(
	ctx: VolunteerRolesStateParams,
	selectedRoleId: Accessor<string | null>,
	onShiftsChanged: () => Promise<void>,
) {
	const crud = useCrudSignals(emptyShiftDraft);
	const startEditShift = (shift: VolunteerShift) =>
		crud.startEdit(shift.id, {
			date: shift.date,
			period: shift.period,
			timeText: shift.timeText ?? "",
			division: shift.division ?? "",
			adjudicator: shift.adjudicator ?? "",
		});
	const cancelEditShift = () => crud.cancelEdit();

	async function handleShiftFormSubmit(event: Event) {
		event.preventDefault();
		const token = ctx.idToken();
		const festival = ctx.festivalShortName();
		const roleId = selectedRoleId();
		if (!token || !festival || !roleId) return;
		const editingId = crud.editingId();
		await crud.run(
			`Could not ${editingId ? "update" : "create"} shift.`,
			async () => {
				if (editingId) {
					await updateVolunteerShift(
						token,
						ctx.slug(),
						festival,
						roleId,
						editingId,
						crud.draft(),
					);
					crud.setEditingId(null);
				} else {
					await createVolunteerShift(
						token,
						ctx.slug(),
						festival,
						roleId,
						crud.draft(),
					);
				}
				crud.setDraft(emptyShiftDraft);
				await onShiftsChanged();
			},
		);
	}

	async function handleDeleteShift(shift: { id: string }) {
		const token = ctx.idToken();
		const festival = ctx.festivalShortName();
		const roleId = selectedRoleId();
		if (!token || !festival || !roleId || !confirm("Delete this shift?"))
			return;
		await crud.run(
			"Could not delete shift.",
			async () => {
				await deleteVolunteerShift(
					token,
					ctx.slug(),
					festival,
					roleId,
					shift.id,
				);
				if (crud.editingId() === shift.id) cancelEditShift();
				await onShiftsChanged();
			},
			shift.id,
		);
	}

	return {
		shiftDraft: crud.draft,
		setShiftDraft: crud.setDraft,
		shiftFormError: crud.formError,
		isCreatingShift: crud.isSubmitting,
		editingShiftId: crud.editingId,
		deletingShiftId: crud.deletingId,
		startEditShift,
		cancelEditShift,
		handleShiftFormSubmit,
		handleDeleteShift,
	};
}

export function useVolunteerRolesState(params: VolunteerRolesStateParams) {
	const [selectedRoleId, setSelectedRoleId] = createSignal<string | null>(null);
	const selectedRole = () =>
		params.roles()?.find((r) => r.id === selectedRoleId()) ?? null;
	const gaps = useCoverageGapsState(params);
	const [shifts, { refetch: refetchShifts }] = createResource(
		() => {
			const token = params.idToken();
			const festival = params.festivalShortName();
			const roleId = selectedRoleId();
			return token && festival && roleId
				? ([token, festival, roleId] as const)
				: undefined;
		},
		([token, festival, roleId]) =>
			getVolunteerShiftsForRole(token, params.slug(), festival, roleId),
	);

	const roleCrud = useRoleCrudState(
		params,
		async () => {
			await params.refetchRoles();
			await gaps.refetchCoverageGaps();
		},
		(roleId) => {
			if (selectedRoleId() === roleId) setSelectedRoleId(null);
		},
	);
	const shiftCrud = useShiftCrudState(params, selectedRoleId, async () => {
		await refetchShifts();
		await gaps.refetchCoverageGaps();
	});

	return {
		...gaps,
		selectedRoleId,
		setSelectedRoleId,
		selectedRole,
		shifts,
		...roleCrud,
		...shiftCrud,
	};
}
