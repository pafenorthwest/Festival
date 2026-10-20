import type { FestivalSummary } from "@festival/common";
import { createSignal, Show } from "solid-js";
import type { FestivalDraft } from "../app/appTypes.js";
import { updateFestivalRegistrationWindow } from "../lib/api.js";
import {
	buildRegistrationWindowPayload,
	toRegistrationWindowInputValue,
} from "../pages/adminFestivalsHelpers.js";
import { Button } from "./Button.js";

export interface FestivalRegistrationWindowEditorProps {
	festival: FestivalSummary;
	slug: string;
	timezone: string;
	getIdToken: () => Promise<string | null>;
	onSaved: (updated: FestivalSummary) => void;
	onCancel: () => void;
}

export function FestivalRegistrationWindowEditor(
	props: FestivalRegistrationWindowEditorProps,
) {
	const [opensDraft, setOpensDraft] = createSignal(
		toRegistrationWindowInputValue(
			props.festival.registrationOpensAt,
			props.timezone,
		),
	);
	const [closesDraft, setClosesDraft] = createSignal(
		toRegistrationWindowInputValue(
			props.festival.registrationClosesAt,
			props.timezone,
		),
	);
	const [error, setError] = createSignal("");
	const [isSaving, setIsSaving] = createSignal(false);

	async function handleSave(clear = false) {
		const check = buildRegistrationWindowPayload(
			clear ? null : opensDraft(),
			clear ? null : closesDraft(),
			props.timezone,
		);
		if (!check.isValid) {
			setError(check.error);
			return;
		}
		setIsSaving(true);
		setError("");
		try {
			const token = await props.getIdToken();
			if (!token) return;
			const response = await updateFestivalRegistrationWindow(
				token,
				props.slug,
				props.festival.shortName,
				check.payload,
			);
			props.onSaved(response.festival);
		} catch (reason) {
			setError(
				reason instanceof Error
					? reason.message
					: "Registration window could not be updated.",
			);
		} finally {
			setIsSaving(false);
		}
	}

	return (
		<div class="festival-window-editor">
			<label class="field">
				<span>Registration opens at</span>
				<input
					type="datetime-local"
					value={opensDraft()}
					onInput={(e) => setOpensDraft(e.currentTarget.value)}
					disabled={isSaving()}
				/>
			</label>
			<label class="field">
				<span>Registration closes at</span>
				<input
					type="datetime-local"
					value={closesDraft()}
					onInput={(e) => setClosesDraft(e.currentTarget.value)}
					disabled={isSaving()}
				/>
			</label>
			<div class="festival-subtype-edit-actions">
				<Button
					type="button"
					disabled={isSaving()}
					onClick={() => void handleSave(false)}
				>
					Save registration window
				</Button>
				<Button
					type="button"
					variant="secondary"
					disabled={isSaving()}
					onClick={() => void handleSave(true)}
				>
					Clear window
				</Button>
				<Button
					type="button"
					variant="secondary"
					disabled={isSaving()}
					onClick={props.onCancel}
				>
					Cancel
				</Button>
			</div>
			<Show when={error()}>
				<p class="field-error" role="alert">
					{error()}
				</p>
			</Show>
		</div>
	);
}

export interface CreateFestivalFormProps {
	draft: FestivalDraft;
	hasNameError: boolean;
	showNameValidation: boolean;
	nameValidationMessage: string;
	isBusy: boolean;
	onUpdateDraft: (updater: (current: FestivalDraft) => FestivalDraft) => void;
	onTouchName: () => void;
	onSubmit: () => void;
}

export function CreateFestivalForm(props: CreateFestivalFormProps) {
	return (
		<>
			<label class="field">
				<span>Festival short name</span>
				<input
					type="text"
					maxLength={64}
					value={props.draft.shortName}
					onInput={(e) =>
						props.onUpdateDraft((c) => ({
							...c,
							shortName: e.currentTarget.value.toLowerCase(),
						}))
					}
				/>
			</label>
			<label class="field">
				<span>Festival name</span>
				<input
					type="text"
					maxLength={255}
					value={props.draft.name}
					onInput={(e) => {
						props.onTouchName();
						props.onUpdateDraft((c) => ({
							...c,
							name: e.currentTarget.value,
						}));
					}}
					aria-invalid={props.hasNameError}
				/>
			</label>
			<Show when={props.showNameValidation && props.nameValidationMessage}>
				<section class="banner error-banner validation-banner">
					{props.nameValidationMessage}
				</section>
			</Show>
			<label class="field">
				<span>Start date</span>
				<input
					type="date"
					value={props.draft.startDate}
					onInput={(e) =>
						props.onUpdateDraft((c) => ({
							...c,
							startDate: e.currentTarget.value,
						}))
					}
				/>
			</label>
			<label class="field">
				<span>End date</span>
				<input
					type="date"
					value={props.draft.endDate}
					onInput={(e) =>
						props.onUpdateDraft((c) => ({
							...c,
							endDate: e.currentTarget.value,
						}))
					}
				/>
			</label>
			<label class="field">
				<span>Registration opens at (optional)</span>
				<input
					type="datetime-local"
					value={props.draft.registrationOpensAt ?? ""}
					onInput={(e) =>
						props.onUpdateDraft((c) => ({
							...c,
							registrationOpensAt: e.currentTarget.value,
						}))
					}
				/>
			</label>
			<label class="field">
				<span>Registration closes at (optional)</span>
				<input
					type="datetime-local"
					value={props.draft.registrationClosesAt ?? ""}
					onInput={(e) =>
						props.onUpdateDraft((c) => ({
							...c,
							registrationClosesAt: e.currentTarget.value,
						}))
					}
				/>
			</label>
			<Button type="button" onClick={props.onSubmit} disabled={props.isBusy}>
				Create festival
			</Button>
		</>
	);
}
