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
import { FestivalClassWaitlistModal } from "../components/FestivalClassWaitlistModal.js";
import {
	createFestivalClass,
	getAdminFestival,
	listDivisions,
	listFestivalClasses,
	listFestivalClassSubtypes,
	updateFestivalClass,
} from "../lib/api.js";
import { buildFestivalAdminPath } from "../lib/routes.js";
import {
	draftToCreateInput,
	draftToUpdateInput,
	type FestivalClassFormDraft,
	getModalDivisionName,
	getModalInitialDraft,
	getModalSubtypeName,
	resolveErrorMessage,
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
	const [waitlistClass, setWaitlistClass] =
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
			const [classList, divisionRes, subtypeResponse] = await Promise.all([
				listFestivalClasses(token, props.slug, props.festivalSlug),
				listDivisions(token, props.slug),
				listFestivalClassSubtypes(token, props.slug, props.festivalSlug),
			]);
			setClasses(classList);
			setDivisions(divisionRes.divisions);
			setClassSubtypes(subtypeResponse.classSubtypes ?? []);
		} catch (err) {
			setDataError(resolveErrorMessage(err, "Could not load class catalog."));
		} finally {
			setIsLoadingData(false);
		}
	}

	createEffect(() => {
		if (festival()) void loadData();
	});

	const activeDivisions = createMemo(() =>
		divisions().filter((d) => d.isActive),
	);
	const activeSubtypes = createMemo(() =>
		classSubtypes().filter((s) => s.isActive),
	);

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
				resolveErrorMessage(err, "Could not update class status."),
			);
		}
	}

	async function saveModalClass(
		action: (token: string) => Promise<void>,
		fallbackErr: string,
		onSuccess: () => void,
	) {
		const user = props.app.firebaseUser();
		if (!user) return;
		setIsSavingModal(true);
		setModalError(null);
		try {
			await action(await user.getIdToken());
			onSuccess();
		} catch (err) {
			setModalError(resolveErrorMessage(err, fallbackErr));
		} finally {
			setIsSavingModal(false);
		}
	}

	async function handleCreateClass(draft: FestivalClassFormDraft) {
		await saveModalClass(
			async (token) => {
				const created = await createFestivalClass(
					token,
					props.slug,
					props.festivalSlug,
					draftToCreateInput(draft),
				);
				setClasses((prev) => [...prev, created]);
			},
			"Could not create class.",
			() => setIsCreateModalOpen(false),
		);
	}

	async function handleEditClass(draft: FestivalClassFormDraft) {
		const current = editingClass();
		if (!current) return;
		await saveModalClass(
			async (token) => {
				const updated = await updateFestivalClass(
					token,
					props.slug,
					props.festivalSlug,
					current.id,
					draftToUpdateInput(draft),
				);
				setClasses((prev) =>
					prev.map((c) => (c.id === updated.id ? updated : c)),
				);
			},
			"Could not update class.",
			() => setEditingClass(null),
		);
	}

	const dashboardPath = () =>
		buildFestivalAdminPath(props.slug, props.festivalSlug);

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
						onViewWaitlist={(item) => setWaitlistClass(item)}
					/>

					<Button
						type="button"
						variant="secondary"
						data-preload-path={dashboardPath()}
						onClick={() => props.app.navigate(dashboardPath())}
					>
						Back to Festival dashboard
					</Button>

					<FestivalClassModal
						isOpen={isCreateModalOpen() || Boolean(editingClass())}
						mode={editingClass() ? "edit" : "create"}
						festivalName={festival()?.festival.name ?? ""}
						activeDivisions={activeDivisions()}
						activeSubtypes={activeSubtypes()}
						divisionName={getModalDivisionName(editingClass(), divisions())}
						subtypeName={getModalSubtypeName(editingClass(), classSubtypes())}
						initialDraft={getModalInitialDraft(editingClass())}
						isSaving={isSavingModal()}
						error={modalError()}
						onSave={editingClass() ? handleEditClass : handleCreateClass}
						onClose={() => {
							setIsCreateModalOpen(false);
							setEditingClass(null);
						}}
					/>

					<FestivalClassWaitlistModal
						isOpen={Boolean(waitlistClass())}
						slug={props.slug}
						festivalSlug={props.festivalSlug}
						classItem={waitlistClass()}
						getIdToken={async () =>
							(await props.app.firebaseUser()?.getIdToken()) ?? null
						}
						onClose={() => setWaitlistClass(null)}
					/>
				</section>
			</Show>
		</Show>
	);
}
