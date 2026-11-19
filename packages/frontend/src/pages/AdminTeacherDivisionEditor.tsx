import type {
	OrganizationDivision,
	TeacherProfileRecord,
} from "@festival/common";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { Button } from "../components/Button.js";
import { ApiError, updateAdminTeacherProfileDivisions } from "../lib/api.js";

export interface AdminTeacherDivisionAuthContext {
	token: string;
	slug: string;
}

export interface AdminTeacherDivisionEditorProps {
	profile: TeacherProfileRecord;
	activeDivisions: readonly OrganizationDivision[];
	disabled: boolean;
	acquireAuth: () => Promise<AdminTeacherDivisionAuthContext | null>;
	onSaved: (updated: TeacherProfileRecord) => void;
	onError: (message: string) => void;
	onBusyChange?: (busy: boolean) => void;
}

function resolveInitialSelectedDivisionId(
	profile: TeacherProfileRecord,
	activeDivisions: readonly OrganizationDivision[],
): string {
	const current = profile.division_ids[0] ?? "";
	return activeDivisions.some((div) => div.id === current) ? current : "";
}

async function submitTeacherDivisionUpdate(options: {
	props: AdminTeacherDivisionEditorProps;
	chosenDivisionId: string;
	isDisposed: () => boolean;
	setSaving: (saving: boolean) => void;
}) {
	const { props, chosenDivisionId, isDisposed, setSaving } = options;
	setSaving(true);
	props.onBusyChange?.(true);
	props.onError("");
	try {
		const auth = await props.acquireAuth();
		if (!auth || isDisposed()) return;
		const updated = await updateAdminTeacherProfileDivisions(
			auth.token,
			auth.slug,
			{ profileId: props.profile.id, divisionIds: [chosenDivisionId] },
		);
		if (!isDisposed()) props.onSaved(updated);
	} catch (err) {
		if (!isDisposed()) {
			props.onError(
				err instanceof ApiError
					? err.message
					: "Teacher division could not be updated.",
			);
		}
	} finally {
		if (!isDisposed()) {
			setSaving(false);
			props.onBusyChange?.(false);
		}
	}
}

function createDivisionEditorController(
	props: AdminTeacherDivisionEditorProps,
) {
	const [selectedId, setSelectedId] = createSignal(
		resolveInitialSelectedDivisionId(props.profile, props.activeDivisions),
	);
	const [saving, setSaving] = createSignal(false);
	let disposed = false;
	onCleanup(() => {
		disposed = true;
	});
	createEffect(() => {
		setSelectedId(
			resolveInitialSelectedDivisionId(props.profile, props.activeDivisions),
		);
	});
	const isBusy = () => props.disabled || saving();
	const isUnchanged = () =>
		props.profile.division_ids.length === 1 &&
		props.profile.division_ids[0] === selectedId();
	const handleSave = () => {
		const chosen = selectedId();
		if (!chosen || isBusy() || isUnchanged()) return;
		void submitTeacherDivisionUpdate({
			props,
			chosenDivisionId: chosen,
			isDisposed: () => disposed,
			setSaving,
		});
	};
	return { selectedId, setSelectedId, saving, isBusy, isUnchanged, handleSave };
}

export function AdminTeacherDivisionEditor(
	props: AdminTeacherDivisionEditorProps,
) {
	const ctrl = createDivisionEditorController(props);
	const selectId = () => `admin-teacher-division-${props.profile.id}`;
	return (
		<div class="admin-teacher-division-editor">
			<label class="muted" for={selectId()}>
				Assigned division
			</label>
			<select
				id={selectId()}
				aria-label={`Assigned division for ${props.profile.display_name}`}
				value={ctrl.selectedId()}
				disabled={ctrl.isBusy() || props.activeDivisions.length === 0}
				onChange={(e) => ctrl.setSelectedId(e.currentTarget.value)}
			>
				<Show when={!ctrl.selectedId()}>
					<option value="">Select active division…</option>
				</Show>
				<For each={props.activeDivisions}>
					{(div) => <option value={div.id}>{div.displayName}</option>}
				</For>
			</select>
			<Button
				type="button"
				variant="secondary"
				disabled={ctrl.isBusy() || !ctrl.selectedId() || ctrl.isUnchanged()}
				onClick={ctrl.handleSave}
			>
				{ctrl.saving() ? "Saving…" : "Save Division"}
			</Button>
		</div>
	);
}
