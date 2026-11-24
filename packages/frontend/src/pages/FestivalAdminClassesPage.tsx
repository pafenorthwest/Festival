import type { FestivalClassConfigurationDto } from "@festival/common";
import {
	createEffect,
	createResource,
	on,
	onCleanup,
	Show,
	untrack,
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
import { readSafeResource } from "../lib/readSafeResource.js";
import { buildFestivalAdminPath } from "../lib/routes.js";
import {
	createClassesPageSignals,
	draftToCreateInput,
	draftToUpdateInput,
	type FestivalClassFormDraft,
	getModalDivisionName,
	getModalInitialDraft,
	getModalSubtypeName,
	replaceClassItem,
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
		async ([slug, festivalSlug, user]) =>
			getAdminFestival(await user.getIdToken(), slug, festivalSlug),
	);
	const readyFestival = () =>
		festival.loading ? undefined : readSafeResource(festival);

	const s = createClassesPageSignals();
	const { waitlistClass, setWaitlistClass } = s;

	let loadRequestId = 0;
	onCleanup(() => {
		loadRequestId += 1;
	});

	async function loadData() {
		const user = props.app.firebaseUser();
		if (!user) return;
		const { slug, festivalSlug } = props;
		const requestId = ++loadRequestId;
		s.setIsLoadingData(true);
		s.setDataError(null);
		try {
			const token = await user.getIdToken();
			if (requestId !== loadRequestId) return;
			const [classList, divisionRes, subtypeResponse] = await Promise.all([
				listFestivalClasses(token, slug, festivalSlug),
				listDivisions(token, slug),
				listFestivalClassSubtypes(token, slug, festivalSlug),
			]);
			if (requestId !== loadRequestId) return;
			s.setClasses(classList);
			s.setDivisions(divisionRes.divisions);
			s.setClassSubtypes(subtypeResponse.classSubtypes ?? []);
		} catch (err) {
			if (requestId !== loadRequestId) return;
			s.setDataError(resolveErrorMessage(err, "Could not load class catalog."));
		} finally {
			if (requestId === loadRequestId) s.setIsLoadingData(false);
		}
	}

	createEffect(
		on(
			() => [props.slug, props.festivalSlug] as const,
			() => {
				loadRequestId += 1;
				s.resetForScopeChange();
			},
			{ defer: true },
		),
	);

	createEffect(() => {
		if (readyFestival()) untrack(() => void loadData());
	});

	async function handleToggleActive(item: FestivalClassConfigurationDto) {
		const user = props.app.firebaseUser();
		if (!user) return;
		s.setActionError(null);
		try {
			const token = await user.getIdToken();
			const updated = await updateFestivalClass(
				token,
				props.slug,
				props.festivalSlug,
				item.id,
				{ isActive: !item.isActive },
			);
			s.setClasses((prev) => replaceClassItem(prev, updated));
		} catch (err) {
			s.setActionError(
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
		s.setIsSavingModal(true);
		s.setModalError(null);
		try {
			await action(await user.getIdToken());
			onSuccess();
		} catch (err) {
			s.setModalError(resolveErrorMessage(err, fallbackErr));
		} finally {
			s.setIsSavingModal(false);
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
				s.setClasses((prev) => [...prev, created]);
			},
			"Could not create class.",
			() => s.setIsCreateModalOpen(false),
		);
	}

	async function handleEditClass(draft: FestivalClassFormDraft) {
		const current = s.editingClass();
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
				s.setClasses((prev) => replaceClassItem(prev, updated));
			},
			"Could not update class.",
			() => s.setEditingClass(null),
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
			<Show when={readyFestival()}>
				<section class="panel flow-panel">
					<header class="admin-page-header">
						<div>
							<h2>{readyFestival()?.festival.name} classes</h2>
							<p>Class catalog management is scoped to this Festival.</p>
						</div>
						<Button type="button" onClick={s.openCreateModal}>
							Create class
						</Button>
					</header>
					<Show when={s.isLoadingData()}>
						<p class="muted">Loading class catalog...</p>
					</Show>
					<Show when={s.dataError()}>
						<section class="banner error-banner" role="alert">
							<p>{s.dataError()}</p>
							<Button type="button" onClick={() => void loadData()}>
								Try again
							</Button>
						</section>
					</Show>
					<Show when={s.actionError()}>
						<p class="field-error" role="alert">
							{s.actionError()}
						</p>
					</Show>

					<FestivalClassTable
						classes={s.classes()}
						divisions={s.divisions()}
						classSubtypes={s.classSubtypes()}
						isLoading={s.isLoadingData()}
						onEdit={s.openEditModal}
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
						isOpen={s.isCreateModalOpen() || Boolean(s.editingClass())}
						mode={s.editingClass() ? "edit" : "create"}
						festivalName={readyFestival()?.festival.name ?? ""}
						activeDivisions={s.activeDivisions()}
						activeSubtypes={s.activeSubtypes()}
						divisionName={getModalDivisionName(s.editingClass(), s.divisions())}
						subtypeName={getModalSubtypeName(
							s.editingClass(),
							s.classSubtypes(),
						)}
						initialDraft={getModalInitialDraft(s.editingClass())}
						isSaving={s.isSavingModal()}
						error={s.modalError()}
						onSave={s.editingClass() ? handleEditClass : handleCreateClass}
						onClose={s.closeModal}
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
