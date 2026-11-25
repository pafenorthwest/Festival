import { createMemo, createResource, Match, Show, Switch } from "solid-js";
import type { SchedulingReadinessResponse } from "../lib/api.js";
import {
	type SchedulingEditorState,
	SchedulingMetaLine,
	type SchedulingSaveFn,
} from "./SchedulingEditorState.js";
import { SchedulingGenerateGate } from "./SchedulingGenerateGate.js";
import {
	SchedulingInputReviewSection,
	type SchedulingReadinessView,
} from "./SchedulingInputReviewSection.js";

export type SchedulingReadinessLoader =
	() => Promise<SchedulingReadinessResponse>;

/**
 * Non-Setup scheduling tabs. Input review and Generate share one readiness
 * fetch, refreshed when either tab opens and after every saved revision.
 */
export function SchedulingReadinessTabs(props: {
	activeTab: string;
	state: SchedulingEditorState;
	load: SchedulingReadinessLoader;
	save: SchedulingSaveFn;
	reload: () => void;
	onOpenReview: () => void;
}) {
	const key = createMemo(() =>
		props.activeTab === "review" || props.activeTab === "generate"
			? { revision: props.state.saved().revision }
			: null,
	);
	const [resource, { refetch }] = createResource(key, () => props.load());
	const view: SchedulingReadinessView = {
		loading: () => resource.loading,
		error: () => resource.error as unknown,
		data: () => (resource.error ? undefined : resource.latest),
	};

	return (
		<Switch
			fallback={
				<div class="scheduling-card">
					<SchedulingMetaLine state={props.state} />
					<Show when={props.state.changed()}>
						<p class="muted">
							Your unsaved Setup edits are kept. Return to Setup to save them.
						</p>
					</Show>
					<p class="muted">
						This view is planned in a later scheduling milestone.
					</p>
				</div>
			}
		>
			<Match when={props.activeTab === "review"}>
				<SchedulingInputReviewSection
					state={props.state}
					readiness={view}
					refresh={() => void refetch()}
					save={props.save}
					reload={props.reload}
				/>
			</Match>
			<Match when={props.activeTab === "generate"}>
				<SchedulingGenerateGate
					state={props.state}
					readiness={view}
					refresh={() => void refetch()}
					onOpenReview={props.onOpenReview}
				/>
			</Match>
		</Switch>
	);
}
