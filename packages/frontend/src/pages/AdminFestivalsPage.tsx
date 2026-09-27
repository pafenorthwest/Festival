import type { RegistrationCatalogValue } from "@festival/common";
import { createEffect, createSignal, For, Show } from "solid-js";
import { formatDateOnly } from "../app/appFormatting.js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import { Button } from "../components/Button.js";
import {
	createFestivalClassSubtype,
	listFestivalClassSubtypes,
	setPrimaryFestival,
} from "../lib/api.js";
import { buildFestivalAdminClassesPath } from "../lib/routes.js";

interface AdminFestivalsPageProps {
	app: FestivalAppController;
}

export function AdminFestivalsPage(props: AdminFestivalsPageProps) {
	const [classSubtypesByFestival, setClassSubtypesByFestival] = createSignal<
		Record<string, RegistrationCatalogValue[]>
	>({});
	const [selectedFestivalSlug, setSelectedFestivalSlug] = createSignal("");
	const [subtypeDraft, setSubtypeDraft] = createSignal("");
	const [subtypeError, setSubtypeError] = createSignal("");
	const [isLoadingSubtypes, setIsLoadingSubtypes] = createSignal(false);
	const [isCreatingSubtype, setIsCreatingSubtype] = createSignal(false);

	createEffect(() => {
		const route = props.app.route();
		const user = props.app.firebaseUser();
		const festivals = props.app.festivals();
		if (
			route.kind !== "org-admin-festivals" ||
			!user ||
			!props.app.isAdminMember()
		) {
			return;
		}
		void (async () => {
			setIsLoadingSubtypes(true);
			setSubtypeError("");
			try {
				const token = await user.getIdToken();
				const entries = await Promise.all(
					festivals.map(async (festival) => {
						const response = await listFestivalClassSubtypes(
							token,
							route.slug,
							festival.shortName,
						);
						return [festival.shortName, response.classSubtypes] as const;
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
			);
			setClassSubtypesByFestival((current) => ({
				...current,
				[festivalSlug]: [...(current[festivalSlug] ?? []), response.value],
			}));
			setSubtypeDraft("");
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
							return (
								<div class="festival-row">
									<strong>{festival.name}</strong>
									<span>
										{festival.shortName}
										{festival.isPrimary ? " (Primary)" : ""}
									</span>
									<span>{formatDateOnly(festival.startDate)}</span>
									<span>{formatDateOnly(festival.endDate)}</span>
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
													(props.app.route() as { slug: string }).slug,
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
											onClick={async () => {
												const current = props.app
													.festivals()
													.find((item) => item.isPrimary);
												if (
													!confirm(
														`Make ${festival.name} primary instead of ${current?.name ?? "the current Festival"}?`,
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
														festival.shortName,
													);
													location.reload();
												} finally {
													props.app.setIsBusy(false);
												}
											}}
										>
											Make primary
										</Button>
									</Show>
								</div>
							);
						}}
					</For>
				</div>
				<label class="field">
					<span>Festival short name</span>
					<input
						type="text"
						maxLength={64}
						value={props.app.festivalDraft().shortName}
						onInput={(event) =>
							props.app.setFestivalDraft((current) => ({
								...current,
								shortName: event.currentTarget.value.toLowerCase(),
							}))
						}
					/>
				</label>
				<label class="field">
					<span>Festival name</span>
					<input
						type="text"
						maxLength={255}
						value={props.app.festivalDraft().name}
						onInput={(event) => {
							props.app.setFestivalNameTouched(true);
							props.app.setFestivalDraft((current) => ({
								...current,
								name: event.currentTarget.value,
							}));
						}}
						aria-invalid={props.app.hasFestivalNameError()}
					/>
				</label>
				<Show
					when={
						props.app.shouldShowFestivalNameValidation() &&
						props.app.festivalNameValidationMessage()
					}
				>
					<section class="banner error-banner validation-banner">
						{props.app.festivalNameValidationMessage()}
					</section>
				</Show>
				<label class="field">
					<span>Start date</span>
					<input
						type="date"
						value={props.app.festivalDraft().startDate}
						onInput={(event) =>
							props.app.setFestivalDraft((current) => ({
								...current,
								startDate: event.currentTarget.value,
							}))
						}
					/>
				</label>
				<label class="field">
					<span>End date</span>
					<input
						type="date"
						value={props.app.festivalDraft().endDate}
						onInput={(event) =>
							props.app.setFestivalDraft((current) => ({
								...current,
								endDate: event.currentTarget.value,
							}))
						}
					/>
				</label>
				<Button
					type="button"
					onClick={props.app.handleCreateFestival}
					disabled={props.app.isBusy()}
				>
					Create festival
				</Button>
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
							onChange={(event) => {
								setSelectedFestivalSlug(event.currentTarget.value);
								setSubtypeError("");
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
								onInput={(event) => setSubtypeDraft(event.currentTarget.value)}
								disabled={isCreatingSubtype()}
							/>
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
								<For
									each={classSubtypesByFestival()[selectedFestivalSlug()] ?? []}
								>
									{(subtype) => <li>{subtype.displayName}</li>}
								</For>
							</ul>
							<Show
								when={
									(classSubtypesByFestival()[selectedFestivalSlug()] ?? [])
										.length === 0
								}
							>
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
