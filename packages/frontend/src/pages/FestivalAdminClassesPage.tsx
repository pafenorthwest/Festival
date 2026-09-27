import type {
	FestivalClassConfigurationDto,
	OrganizationDivision,
	RegistrationCatalogValue,
} from "@festival/common";
import {
	createEffect,
	createMemo,
	createResource,
	createSignal,
	Show,
} from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import { Button } from "../components/Button.js";
import { FestivalClassModal } from "../components/FestivalClassModal.js";
import { FestivalClassTable } from "../components/FestivalClassTable.js";
import {
	createFestivalClass,
	getAdminFestival,
	getAdminRegistrationConfiguration,
	listDivisions,
	listFestivalClasses,
	updateFestivalClass,
} from "../lib/api.js";
import { buildFestivalAdminPath } from "../lib/routes.js";
import {
	type FestivalClassFormDraft,
	initialClassFormDraft,
} from "./festivalAdminClassesHelpers.js";

export function FestivalAdminClassesPage(props: {
	app: FestivalAppController;
	slug: string;
	festivalSlug: string;
}) {
	const [festival] = createResource(
		() => {
			const user = props.app.firebaseUser();
			return props.app.isAdminMember() && user
				? ([props.slug, props.festivalSlug, user] as const)
				: null;
		},
		async (input) => {
			if (!input) throw new Error("Sign in to manage this festival.");
			const [slug, festivalSlug, user] = input;
			return getAdminFestival(await user.getIdToken(), slug, festivalSlug);
		},
	);

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
	const [isSavingModal, setIsSavingModal] = createSignal(false);
	const [modalError, setModalError] = createSignal<string | null>(null);

	async function loadData() {
		const user = props.app.firebaseUser();
		if (!user) return;
		setIsLoadingData(true);
		setDataError(null);
		try {
			const token = await user.getIdToken();
			const [classList, divisionRes, regConfig] = await Promise.all([
				listFestivalClasses(token, props.slug, props.festivalSlug),
				listDivisions(token, props.slug),
				getAdminRegistrationConfiguration(token, props.slug),
			]);
			setClasses(classList);
			setDivisions(divisionRes.divisions);
			setClassSubtypes(regConfig.classSubtypes ?? []);
		} catch (err) {
			setDataError(
				err instanceof Error ? err.message : "Could not load class catalog.",
			);
		} finally {
			setIsLoadingData(false);
		}
	}

	createEffect(() => {
		if (festival()) {
			void loadData();
		}
	});

	const activeDivisions = createMemo(() =>
		divisions().filter((d) => d.isActive),
	);
	const activeSubtypes = createMemo(() =>
		classSubtypes().filter((s) => s.isActive),
	);

	function getDivisionName(id: string): string {
		return divisions().find((d) => d.id === id)?.displayName ?? id;
	}

	function getSubtypeName(id: string): string {
		return classSubtypes().find((s) => s.id === id)?.displayName ?? id;
	}

	async function handleToggleActive(item: FestivalClassConfigurationDto) {
		const user = props.app.firebaseUser();
		if (!user) return;
		setActionError(null);
		try {
			const token = await user.getIdToken();
			const updated = await updateFestivalClass(
				token,
				props.slug,
				props.festivalSlug,
				item.id,
				{ isActive: !item.isActive },
			);
			setClasses((prev) =>
				prev.map((c) => (c.id === updated.id ? updated : c)),
			);
		} catch (err) {
			setActionError(
				err instanceof Error ? err.message : "Could not update class status.",
			);
		}
	}

	async function handleCreateClass(draft: FestivalClassFormDraft) {
		const user = props.app.firebaseUser();
		if (!user) return;
		setIsSavingModal(true);
		setModalError(null);
		try {
			const token = await user.getIdToken();
			const created = await createFestivalClass(
				token,
				props.slug,
				props.festivalSlug,
				{
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
				},
			);
			setClasses((prev) => [...prev, created]);
			setIsCreateModalOpen(false);
		} catch (err) {
			setModalError(
				err instanceof Error ? err.message : "Could not create class.",
			);
		} finally {
			setIsSavingModal(false);
		}
	}

	async function handleEditClass(draft: FestivalClassFormDraft) {
		const user = props.app.firebaseUser();
		const current = editingClass();
		if (!user || !current) return;
		setIsSavingModal(true);
		setModalError(null);
		try {
			const token = await user.getIdToken();
			const updated = await updateFestivalClass(
				token,
				props.slug,
				props.festivalSlug,
				current.id,
				{
					displayName: draft.displayName.trim(),
					price: draft.price.trim(),
					minimumAge: draft.minimumAge,
					maximumAge: draft.maximumAge,
					maximumPerformancePieces: draft.maximumPerformancePieces,
					performanceMinutes: draft.performanceMinutes,
					capacity: draft.capacity,
					isActive: draft.isActive,
				},
			);
			setClasses((prev) =>
				prev.map((c) => (c.id === updated.id ? updated : c)),
			);
			setEditingClass(null);
		} catch (err) {
			setModalError(
				err instanceof Error ? err.message : "Could not update class.",
			);
		} finally {
			setIsSavingModal(false);
		}
	}

	return (
		<Show
			when={props.app.isAdminMember()}
			fallback={
				<AccessDeniedPanel message="Only Admin members can manage festival classes." />
			}
		>
			<Show when={festival.loading}>
				<section class="panel">
					<p class="muted">Loading festival classes.</p>
				</section>
			</Show>
			<Show when={festival.error}>
				<section class="panel">
					<p role="alert">Festival not found.</p>
				</section>
			</Show>
			<Show when={festival()}>
				<section class="panel flow-panel">
					<header class="admin-page-header">
						<div>
							<h2>{festival()?.festival.name} classes</h2>
							<p>Class catalog management is scoped to this Festival.</p>
						</div>
						<Button
							type="button"
							onClick={() => {
								setModalError(null);
								setIsCreateModalOpen(true);
							}}
						>
							Create class
						</Button>
					</header>

					<Show when={isLoadingData()}>
						<p class="muted">Loading class catalog...</p>
					</Show>

					<Show when={dataError()}>
						<section class="banner error-banner" role="alert">
							<p>{dataError()}</p>
							<Button type="button" onClick={() => void loadData()}>
								Try again
							</Button>
						</section>
					</Show>

					<Show when={actionError()}>
						<p class="field-error" role="alert">
							{actionError()}
						</p>
					</Show>

					<FestivalClassTable
						classes={classes()}
						divisions={divisions()}
						classSubtypes={classSubtypes()}
						isLoading={isLoadingData()}
						onEdit={(item) => {
							setModalError(null);
							setEditingClass(item);
						}}
						onToggleActive={(item) => void handleToggleActive(item)}
					/>

					<Button
						type="button"
						variant="secondary"
						onClick={() =>
							props.app.navigate(
								buildFestivalAdminPath(props.slug, props.festivalSlug),
							)
						}
					>
						Back to Festival dashboard
					</Button>

					<FestivalClassModal
						isOpen={isCreateModalOpen()}
						mode="create"
						festivalName={festival()?.festival.name ?? ""}
						activeDivisions={activeDivisions()}
						activeSubtypes={activeSubtypes()}
						initialDraft={initialClassFormDraft}
						isSaving={isSavingModal()}
						error={modalError()}
						onSave={handleCreateClass}
						onClose={() => setIsCreateModalOpen(false)}
					/>

					<Show when={editingClass()}>
						{(selected) => (
							<FestivalClassModal
								isOpen={true}
								mode="edit"
								festivalName={festival()?.festival.name ?? ""}
								activeDivisions={activeDivisions()}
								activeSubtypes={activeSubtypes()}
								divisionName={getDivisionName(selected().divisionId)}
								subtypeName={getSubtypeName(selected().classSubtypeId)}
								initialDraft={{
									displayName: selected().displayName,
									divisionId: selected().divisionId,
									classSubtypeId: selected().classSubtypeId,
									price: selected().price,
									minimumAge: selected().minimumAge,
									maximumAge: selected().maximumAge,
									maximumPerformancePieces: selected().maximumPerformancePieces,
									performanceMinutes: selected().performanceMinutes,
									capacity: selected().capacity,
									isActive: selected().isActive,
								}}
								isSaving={isSavingModal()}
								error={modalError()}
								onSave={handleEditClass}
								onClose={() => setEditingClass(null)}
							/>
						)}
					</Show>
				</section>
			</Show>
		</Show>
	);
}
