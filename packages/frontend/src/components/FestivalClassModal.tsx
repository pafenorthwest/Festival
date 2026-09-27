import type {
	OrganizationDivision,
	RegistrationCatalogValue,
} from "@festival/common";
import { createEffect, createSignal, For, Show } from "solid-js";
import {
	type FestivalClassFormDraft,
	validateAges,
	validateCapacity,
	validateDisplayName,
	validateMinutes,
	validatePieces,
	validatePrice,
} from "../pages/festivalAdminClassesHelpers.js";
import { Button } from "./Button.js";

interface FestivalClassModalProps {
	isOpen: boolean;
	mode: "create" | "edit";
	festivalName: string;
	activeDivisions: OrganizationDivision[];
	activeSubtypes: RegistrationCatalogValue[];
	initialDraft: FestivalClassFormDraft;
	divisionName?: string;
	subtypeName?: string;
	isSaving: boolean;
	error: string | null;
	onSave: (draft: FestivalClassFormDraft) => Promise<void> | void;
	onClose: () => void;
}

interface FieldErrors {
	displayName?: string;
	divisionId?: string;
	classSubtypeId?: string;
	price?: string;
	minimumAge?: string;
	maximumAge?: string;
	performanceMinutes?: string;
	capacity?: string;
}

function runValidation(
	draft: FestivalClassFormDraft,
	isCreate: boolean,
): FieldErrors {
	const errors: FieldErrors = {};
	if (isCreate) {
		if (!draft.divisionId) errors.divisionId = "Division is required.";
		if (!draft.classSubtypeId) {
			errors.classSubtypeId = "Class subtype is required.";
		}
	}
	const nameErr = validateDisplayName(draft.displayName);
	if (nameErr) errors.displayName = nameErr;
	const priceErr = validatePrice(draft.price);
	if (priceErr) errors.price = priceErr;
	const ageErrs = validateAges(draft.minimumAge, draft.maximumAge);
	if (ageErrs?.minError) errors.minimumAge = ageErrs.minError;
	if (ageErrs?.maxError) errors.maximumAge = ageErrs.maxError;
	const minErr = validateMinutes(draft.performanceMinutes);
	if (minErr) errors.performanceMinutes = minErr;
	const piecesErr = validatePieces(draft.maximumPerformancePieces);
	if (piecesErr) errors.performanceMinutes = piecesErr;
	const capErr = validateCapacity(draft.capacity);
	if (capErr) errors.capacity = capErr;
	return errors;
}

export function FestivalClassModal(props: FestivalClassModalProps) {
	const [draft, setDraft] = createSignal<FestivalClassFormDraft>({
		...props.initialDraft,
	});
	const [errors, setErrors] = createSignal<FieldErrors>({});

	createEffect(() => {
		if (props.isOpen) {
			setDraft({ ...props.initialDraft });
			setErrors({});
		}
	});

	function updateField<K extends keyof FestivalClassFormDraft>(
		key: K,
		val: FestivalClassFormDraft[K],
	) {
		setDraft((prev) => ({ ...prev, [key]: val }));
		setErrors((prev) => ({ ...prev, [key]: undefined }));
	}

	function handleSubmit(event: Event) {
		event.preventDefault();
		const errs = runValidation(draft(), props.mode === "create");
		setErrors(errs);
		if (Object.keys(errs).length === 0) {
			void props.onSave(draft());
		}
	}

	return (
		<Show when={props.isOpen}>
			<div class="modal-backdrop" role="presentation">
				<section
					class="modal-card panel flow-panel class-modal-card"
					role="dialog"
					aria-modal="true"
				>
					<header class="class-modal-header">
						<h3>
							{props.mode === "create"
								? "Create festival class"
								: "Edit festival class"}
						</h3>
					</header>
					<form class="flow-panel" onSubmit={handleSubmit}>
						<Show when={props.mode === "edit"}>
							<label class="field">
								<span>Festival</span>
								<input type="text" value={props.festivalName} readOnly />
							</label>
							<label class="field">
								<span>Division</span>
								<input type="text" value={props.divisionName ?? ""} readOnly />
							</label>
							<label class="field">
								<span>Class subtype</span>
								<input type="text" value={props.subtypeName ?? ""} readOnly />
							</label>
						</Show>
						<Show when={props.mode === "create"}>
							<label class="field">
								<span>Division</span>
								<select
									value={draft().divisionId}
									onChange={(e) =>
										updateField("divisionId", e.currentTarget.value)
									}
									aria-invalid={Boolean(errors().divisionId)}
								>
									<option value="">Select a division</option>
									<For each={props.activeDivisions}>
										{(division) => (
											<option value={division.id}>
												{division.displayName}
											</option>
										)}
									</For>
								</select>
								<Show when={errors().divisionId}>
									<p class="field-error" role="alert">
										{errors().divisionId}
									</p>
								</Show>
							</label>
							<label class="field">
								<span>Class subtype</span>
								<select
									value={draft().classSubtypeId}
									onChange={(e) =>
										updateField("classSubtypeId", e.currentTarget.value)
									}
									aria-invalid={Boolean(errors().classSubtypeId)}
								>
									<option value="">Select a class subtype</option>
									<For each={props.activeSubtypes}>
										{(subtype) => (
											<option value={subtype.id}>{subtype.displayName}</option>
										)}
									</For>
								</select>
								<Show when={errors().classSubtypeId}>
									<p class="field-error" role="alert">
										{errors().classSubtypeId}
									</p>
								</Show>
							</label>
						</Show>
						<label class="field">
							<span>Class name</span>
							<input
								type="text"
								value={draft().displayName}
								onInput={(e) =>
									updateField("displayName", e.currentTarget.value)
								}
								aria-invalid={Boolean(errors().displayName)}
								placeholder="e.g. Junior Solo Piano"
							/>
							<Show when={errors().displayName}>
								<p class="field-error" role="alert">
									{errors().displayName}
								</p>
							</Show>
						</label>
						<label class="field">
							<span>Price ($)</span>
							<input
								type="text"
								value={draft().price}
								onInput={(e) => updateField("price", e.currentTarget.value)}
								aria-invalid={Boolean(errors().price)}
								placeholder="35.00"
							/>
							<Show when={errors().price}>
								<p class="field-error" role="alert">
									{errors().price}
								</p>
							</Show>
						</label>
						<div class="form-grid-2col">
							<label class="field">
								<span>Minimum age</span>
								<input
									type="number"
									min="0"
									step="1"
									value={draft().minimumAge}
									onInput={(e) =>
										updateField(
											"minimumAge",
											Number.parseInt(e.currentTarget.value, 10) || 0,
										)
									}
									aria-invalid={Boolean(errors().minimumAge)}
								/>
								<Show when={errors().minimumAge}>
									<p class="field-error" role="alert">
										{errors().minimumAge}
									</p>
								</Show>
							</label>
							<label class="field">
								<span>Maximum age</span>
								<input
									type="number"
									min="0"
									step="1"
									value={draft().maximumAge}
									onInput={(e) =>
										updateField(
											"maximumAge",
											Number.parseInt(e.currentTarget.value, 10) || 0,
										)
									}
									aria-invalid={Boolean(errors().maximumAge)}
								/>
								<Show when={errors().maximumAge}>
									<p class="field-error" role="alert">
										{errors().maximumAge}
									</p>
								</Show>
							</label>
						</div>
						<label class="field">
							<span>Maximum performance pieces</span>
							<select
								value={draft().maximumPerformancePieces}
								onChange={(e) =>
									updateField(
										"maximumPerformancePieces",
										Number.parseInt(e.currentTarget.value, 10) as 1 | 2 | 3,
									)
								}
							>
								<option value={1}>1</option>
								<option value={2}>2</option>
								<option value={3}>3</option>
							</select>
						</label>
						<div class="form-grid-2col">
							<label class="field">
								<span>Performance minutes</span>
								<input
									type="number"
									min="1"
									step="1"
									value={draft().performanceMinutes}
									onInput={(e) =>
										updateField(
											"performanceMinutes",
											Number.parseInt(e.currentTarget.value, 10) || 0,
										)
									}
									aria-invalid={Boolean(errors().performanceMinutes)}
								/>
								<Show when={errors().performanceMinutes}>
									<p class="field-error" role="alert">
										{errors().performanceMinutes}
									</p>
								</Show>
							</label>
							<label class="field">
								<span>Capacity</span>
								<input
									type="number"
									min="1"
									step="1"
									value={draft().capacity}
									onInput={(e) =>
										updateField(
											"capacity",
											Number.parseInt(e.currentTarget.value, 10) || 0,
										)
									}
									aria-invalid={Boolean(errors().capacity)}
								/>
								<Show when={errors().capacity}>
									<p class="field-error" role="alert">
										{errors().capacity}
									</p>
								</Show>
							</label>
						</div>
						<label class="class-checkbox-field">
							<input
								type="checkbox"
								checked={draft().isActive}
								onChange={(e) =>
									updateField("isActive", e.currentTarget.checked)
								}
							/>
							<span>Active (available for registration)</span>
						</label>
						<Show when={props.error}>
							<p class="field-error" role="alert">
								{props.error}
							</p>
						</Show>
						<div class="modal-actions class-modal-actions">
							<Button type="submit" disabled={props.isSaving}>
								{props.isSaving
									? "Saving..."
									: props.mode === "create"
										? "Create class"
										: "Save changes"}
							</Button>
							<Button
								type="button"
								variant="secondary"
								onClick={props.onClose}
								disabled={props.isSaving}
							>
								Cancel
							</Button>
						</div>
					</form>
				</section>
			</div>
		</Show>
	);
}
