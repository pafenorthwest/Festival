import type {
	SchedulingConfiguration,
	SchedulingConfigurationRevision,
} from "@festival/common";
import { createMemo, createSignal, Show } from "solid-js";
import type { FormattedSchedulingIssue } from "./SchedulingValidationIssues.js";

export type SchedulingSaveFn = (
	expectedRevision: number,
	config: SchedulingConfiguration,
) => Promise<SchedulingConfigurationRevision>;

/**
 * Editor state owned by the loaded workspace (not the Setup tab) so that
 * unsaved edits, the latest saved revision, and save feedback survive tab
 * switches. It is recreated only when the configuration is (re)loaded.
 */
export function createSchedulingEditorState(
	initial: SchedulingConfigurationRevision,
) {
	const [saved, setSaved] = createSignal(initial);
	const [draft, setDraft] = createSignal<SchedulingConfiguration>(
		structuredClone(initial.config),
	);
	const [saving, setSaving] = createSignal(false);
	const [stale, setStale] = createSignal(false);
	const [notice, setNotice] = createSignal("");
	const [error, setError] = createSignal("");
	const [issues, setIssues] = createSignal<FormattedSchedulingIssue[]>([]);
	const changed = createMemo(
		() => JSON.stringify(draft()) !== JSON.stringify(saved().config),
	);
	return {
		saved,
		setSaved,
		draft,
		setDraft,
		saving,
		setSaving,
		stale,
		setStale,
		notice,
		setNotice,
		error,
		setError,
		issues,
		setIssues,
		changed,
	};
}

export type SchedulingEditorState = ReturnType<
	typeof createSchedulingEditorState
>;

export function SchedulingMetaLine(props: { state: SchedulingEditorState }) {
	return (
		<p class="scheduling-meta-line">
			<span>Configuration revision {props.state.saved().revision}</span> ·{" "}
			<span>Active version: None published</span>
			<Show when={props.state.changed()}>
				{" "}
				· <span class="scheduling-unsaved-indicator">Unsaved changes</span>
			</Show>
		</p>
	);
}
