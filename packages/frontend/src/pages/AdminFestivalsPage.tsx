import type { RegistrationCatalogValue } from "@festival/common";
import { createEffect, createSignal, For, Show } from "solid-js";
import { formatDateOnly } from "../app/appFormatting.js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import { Button } from "../components/Button.js";
import {
	CreateFestivalForm,
	FestivalRegistrationWindowEditor,
} from "../components/FestivalRegistrationWindowEditor.js";
import {
	createFestivalClassSubtype,
	listFestivalClassSubtypes,
	setPrimaryFestival,
	updateAdminClassSubtype,
	updateFestivalRegistrationWindow,
} from "../lib/api.js";
import { buildFestivalAdminClassesPath } from "../lib/routes.js";
import { formatFestivalRegistrationWindow } from "./adminFestivalsHelpers.js";

export { updateFestivalRegistrationWindow };

interface AdminFestivalsPageProps {
	app: FestivalAppController;
}

export function AdminFestivalsPage(props: AdminFestivalsPageProps) {
	const [classSubtypesByFestival, setClassSubtypesByFestival] = createSignal<
		Record<string, RegistrationCatalogValue[]>
	>({});
	const [selectedFestivalSlug, setSelectedFestivalSlug] = createSignal("");
	const [subtypeDraft, setSubtypeDraft] = createSignal("");
	const [requiredSubtypeDraft, setRequiredSubtypeDraft] = createSignal("");
	const [editingSubtypeId, setEditingSubtypeId] = createSignal<string | null>(
		null,
	);
	const [editingRequiredSubtypeId, setEditingRequiredSubtypeId] =
		createSignal("");
	const [subtypeError, setSubtypeError] = createSignal("");
	const [isLoadingSubtypes, setIsLoadingSubtypes] = createSignal(false);
	const [isCreatingSubtype, setIsCreatingSubtype] = createSignal(false);
	const [isUpdatingSubtype, setIsUpdatingSubtype] = createSignal(false);
	const [editingWindowSlug, setEditingWindowSlug] = createSignal<string | null>(
		null,
	);
	const orgTimezone = () => props.app.organization()?.timezone ?? "UTC";

	createEffect(() => {
		const route = props.app.route();
		const user = props.app.firebaseUser();
		const festivals = props.app.festivals();
		if (
			route.kind !== "org-admin-festivals" ||
			!user ||
			!props.app.isAdminMember()
		)
			return;
		void (async () => {
			setIsLoadingSubtypes(true);
			setSubtypeError("");
			try {
				const token = await user.getIdToken();
				const entries = await Promise.all(
					festivals.map(async (festival) => {
						const res = await listFestivalClassSubtypes(
							token,
							route.slug,
							festival.shortName,
						);
						return [festival.shortName, res.classSubtypes] as const;
					}),
				);
				setClassSubtypesByFestival(Object.fromEntries(entries));
			} catch (reason) {
				setSubtypeError(
					reason instanceof Error
						? reason.message
						: "Class subtypes could not be loaded.",
				);
			} finally {
				setIsLoadingSubtypes(false);
			}
		})();
	});

	function getRequiredSubtypeName(id: string): string {
		const subtypes = classSubtypesByFestival()[selectedFestivalSlug()] ?? [];
		return subtypes.find((s) => s.id === id)?.displayName ?? id;
	}

	function startEditing(subtype: RegistrationCatalogValue) {
		setEditingSubtypeId(subtype.id);
		setEditingRequiredSubtypeId(subtype.requiredSubtypeId ?? "");
		setSubtypeError("");
	}

	function cancelEditing() {
		setEditingSubtypeId(null);
		setEditingRequiredSubtypeId("");
		setSubtypeError("");
	}

	async function saveSubtypePrerequisite(subtypeId: string) {
		const route = props.app.route();
		const user = props.app.firebaseUser();
		const festivalSlug = selectedFestivalSlug();
		if (route.kind !== "org-admin-festivals" || !user || !festivalSlug) return;
		setIsUpdatingSubtype(true);
		setSubtypeError("");
		try {
			const token = await user.getIdToken();
			const response = await updateAdminClassSubtype(
				token,
				route.slug,
				subtypeId,
				{ requiredSubtypeId: editingRequiredSubtypeId() || null },
			);
			setClassSubtypesByFestival((current) => ({
				...current,
				[festivalSlug]: (current[festivalSlug] ?? []).map((item) =>
					item.id === subtypeId ? response.value : item,
				),
			}));
			setEditingSubtypeId(null);
		} catch (reason) {
			setSubtypeError(
				reason instanceof Error
					? reason.message
					: "Class subtype could not be updated.",
			);
		} finally {
			setIsUpdatingSubtype(false);
		}
	}

	async function createSubtype() {
		const route = props.app.route();
		const user = props.app.firebaseUser();
		const festivalSlug = selectedFestivalSlug();
		const displayName = subtypeDraft().trim();
		if (route.kind !== "org-admin-festivals" || !user || !festivalSlug) return;
		if (!displayName) {
			setSubtypeError("Class subtype name is required.");
			return;
		}
		setIsCreatingSubtype(true);
		setSubtypeError("");
		try {
			const response = await createFestivalClassSubtype(
				await user.getIdToken(),
				route.slug,
				festivalSlug,
				displayName,
				requiredSubtypeDraft(),
			);
			setClassSubtypesByFestival((current) => ({
				...current,
				[festivalSlug]: [...(current[festivalSlug] ?? []), response.value],
			}));
			setSubtypeDraft("");
			setRequiredSubtypeDraft("");
		} catch (reason) {
			setSubtypeError(
				reason instanceof Error
					? reason.message
					: "Class subtype could not be created.",
			);
		} finally {
			setIsCreatingSubtype(false);
		}
	}

	async function handleSetPrimary(shortName: string, name: string) {
		const current = props.app.festivals().find((item) => item.isPrimary);
		if (
			!confirm(
				`Make ${name} primary instead of ${current?.name ?? "the current Festival"}?`,
			)
		)
			return;
		const user = props.app.firebaseUser();
		if (!user) return;
		props.app.setIsBusy(true);
		try {
			await setPrimaryFestival(
				await user.getIdToken(),
				(props.app.route() as { slug: string }).slug,
				shortName,
			);
			location.reload();
		} finally {
			props.app.setIsBusy(false);
		}
	}

	const currentSubtypes = () =>
		classSubtypesByFestival()[selectedFestivalSlug()] ?? [];
	const currentSlug = () => (props.app.route() as { slug: string }).slug;

	return (
		<Show
			when={props.app.isAdminMember()}
			fallback={
				<AccessDeniedPanel message="Only Admin members can manage festivals." />
			}
		>
			<section class="panel flow-panel">
				<header class="admin-page-header">
					<div>
						<h2>Festivals</h2>
						<p>Festival dates for this organization.</p>
					</div>
				</header>
				<div class="festival-list">
					<For each={props.app.festivals()}>
						{(festival) => {
							const hasClassSubtypes = () =>
								(classSubtypesByFestival()[festival.shortName] ?? []).length >
								0;
							const windowSummary = () =>
								festival.registrationOpensAt && festival.registrationClosesAt
									? formatFestivalRegistrationWindow(festival, orgTimezone())
									: "Registration window not set (Closed)";
							return (
								<div class="festival-row">
									<strong>{festival.name}</strong>
									<span>
										{festival.shortName}
										{festival.isPrimary ? " (Primary)" : ""}
									</span>
									<span>{formatDateOnly(festival.startDate)}</span>
									<span>{formatDateOnly(festival.endDate)}</span>
									<span class="festival-registration-window">
										{windowSummary()}
									</span>
									<Button
										type="button"
										variant="secondary"
										onClick={() => setEditingWindowSlug(festival.shortName)}
									>
										Registration window
									</Button>
									<Button
										type="button"
										class="festival-classes-button"
										disabled={!hasClassSubtypes()}
										title={
											hasClassSubtypes()
												? undefined
												: "Create class subtypes first"
										}
										aria-describedby={
											hasClassSubtypes()
												? undefined
												: `class-subtypes-required-${festival.shortName}`
										}
										onClick={() =>
											props.app.navigate(
												buildFestivalAdminClassesPath(
													currentSlug(),
													festival.shortName,
												),
											)
										}
									>
										<span aria-hidden="true">🎓</span> Classes
									</Button>
									<Show when={!hasClassSubtypes()}>
										<span
											id={`class-subtypes-required-${festival.shortName}`}
											class="sr-only"
										>
											Create class subtypes first
										</span>
									</Show>
									<Show when={!festival.isPrimary}>
										<Button
											type="button"
											disabled={props.app.isBusy()}
											onClick={() =>
												void handleSetPrimary(festival.shortName, festival.name)
											}
										>
											Make primary
										</Button>
									</Show>
									<Show when={editingWindowSlug() === festival.shortName}>
										<FestivalRegistrationWindowEditor
											festival={festival}
											slug={currentSlug()}
											timezone={orgTimezone()}
											getIdToken={async () =>
												(await props.app.firebaseUser()?.getIdToken()) ?? null
											}
											onSaved={(updated) => {
												props.app.setFestivals((current) =>
													current.map((item) =>
														item.shortName === festival.shortName
															? updated
															: item,
													),
												);
												setEditingWindowSlug(null);
											}}
											onCancel={() => setEditingWindowSlug(null)}
										/>
									</Show>
								</div>
							);
						}}
					</For>
				</div>
				<CreateFestivalForm
					draft={props.app.festivalDraft()}
					hasNameError={props.app.hasFestivalNameError()}
					showNameValidation={props.app.shouldShowFestivalNameValidation()}
					nameValidationMessage={props.app.festivalNameValidationMessage()}
					isBusy={props.app.isBusy()}
					onUpdateDraft={props.app.setFestivalDraft}
					onTouchName={() => props.app.setFestivalNameTouched(true)}
					onSubmit={props.app.handleCreateFestival}
				/>
				<section
					class="festival-subtypes-card"
					aria-labelledby="class-subtypes-heading"
				>
					<h3 id="class-subtypes-heading">Class subtypes</h3>
					<p class="muted">
						Select a festival before viewing or creating its class subtypes.
					</p>
					<label class="field">
						<span>Festival</span>
						<select
							value={selectedFestivalSlug()}
							onChange={(e) => {
								setSelectedFestivalSlug(e.currentTarget.value);
								setSubtypeError("");
								setSubtypeDraft("");
								setRequiredSubtypeDraft("");
								setEditingSubtypeId(null);
							}}
						>
							<option value="">Select a festival</option>
							<For each={props.app.festivals()}>
								{(festival) => (
									<option value={festival.shortName}>{festival.name}</option>
								)}
							</For>
						</select>
					</label>
					<Show when={selectedFestivalSlug()}>
						<label class="field">
							<span>New class subtype</span>
							<input
								type="text"
								maxLength={100}
								value={subtypeDraft()}
								onInput={(e) => setSubtypeDraft(e.currentTarget.value)}
								disabled={isCreatingSubtype()}
							/>
						</label>
						<label class="field">
							<span>Requires Subtype</span>
							<select
								value={requiredSubtypeDraft()}
								onChange={(e) => setRequiredSubtypeDraft(e.currentTarget.value)}
								disabled={isCreatingSubtype()}
							>
								<option value="">None (no prerequisite)</option>
								<For each={currentSubtypes()}>
									{(subtype) => (
										<option value={subtype.id}>{subtype.displayName}</option>
									)}
								</For>
							</select>
						</label>
						<Button
							type="button"
							disabled={isCreatingSubtype() || isLoadingSubtypes()}
							onClick={() => void createSubtype()}
						>
							Create class subtype
						</Button>
						<Show when={isLoadingSubtypes()}>
							<p class="muted" role="status">
								Loading class subtypes...
							</p>
						</Show>
						<Show when={!isLoadingSubtypes()}>
							<ul class="festival-subtype-list">
								<For each={currentSubtypes()}>
									{(subtype) => (
										<li>
											<Show
												when={editingSubtypeId() === subtype.id}
												fallback={
													<div class="festival-subtype-item">
														<span>
															{subtype.displayName}
															{subtype.requiredSubtypeId
																? ` (requires: ${getRequiredSubtypeName(subtype.requiredSubtypeId)})`
																: ""}
														</span>
														<Button
															type="button"
															variant="secondary"
															disabled={
																isUpdatingSubtype() || isCreatingSubtype()
															}
															onClick={() => startEditing(subtype)}
														>
															Edit
														</Button>
													</div>
												}
											>
												<div class="festival-subtype-edit-form">
													<span>{subtype.displayName}</span>
													<label class="field">
														<span>Requires Subtype</span>
														<select
															value={editingRequiredSubtypeId()}
															onChange={(e) =>
																setEditingRequiredSubtypeId(
																	e.currentTarget.value,
																)
															}
															disabled={isUpdatingSubtype()}
														>
															<option value="">None (no prerequisite)</option>
															<For
																each={currentSubtypes().filter(
																	(option) => option.id !== subtype.id,
																)}
															>
																{(option) => (
																	<option value={option.id}>
																		{option.displayName}
																	</option>
																)}
															</For>
														</select>
													</label>
													<div class="festival-subtype-edit-actions">
														<Button
															type="button"
															disabled={isUpdatingSubtype()}
															onClick={() =>
																void saveSubtypePrerequisite(subtype.id)
															}
														>
															Save
														</Button>
														<Button
															type="button"
															variant="secondary"
															disabled={isUpdatingSubtype()}
															onClick={() => cancelEditing()}
														>
															Cancel
														</Button>
													</div>
												</div>
											</Show>
										</li>
									)}
								</For>
							</ul>
							<Show when={currentSubtypes().length === 0}>
								<p class="muted">No class subtypes yet.</p>
							</Show>
						</Show>
					</Show>
					<Show when={subtypeError()}>
						<p class="field-error" role="alert">
							{subtypeError()}
						</p>
					</Show>
				</section>
			</section>
		</Show>
	);
}
