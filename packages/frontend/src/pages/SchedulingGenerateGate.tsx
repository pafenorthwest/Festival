import { Show } from "solid-js";
import { Button } from "../components/Button.js";
import type { SchedulingEditorState } from "./SchedulingEditorState.js";
import {
	SchedulingReadinessFrame,
	type SchedulingReadinessView,
} from "./SchedulingInputReviewSection.js";

export function SchedulingGenerateGate(props: {
	state: SchedulingEditorState;
	readiness: SchedulingReadinessView;
	refresh: () => void;
	onOpenReview: () => void;
}) {
	return (
		<div class="scheduling-card">
			<h3>Generate</h3>
			<SchedulingReadinessFrame
				state={props.state}
				readiness={props.readiness}
				refresh={props.refresh}
			>
				{(loaded) => {
					const blocking = loaded.readiness.blockingIssues.length;
					return (
						<>
							<p>
								<span
									class={`badge ${loaded.readiness.canGenerate ? "badge-active" : "badge-rejected"}`}
								>
									{loaded.readiness.canGenerate
										? "Ready to generate"
										: "Not ready to generate"}
								</span>
							</p>
							<Show when={blocking > 0}>
								<p>
									{blocking} blocking issue{blocking === 1 ? "" : "s"} must be
									resolved first.{" "}
									<button
										type="button"
										class="link-button"
										onClick={props.onOpenReview}
									>
										View in Input review
									</button>
								</p>
							</Show>
							<Button type="button" disabled>
								Generate draft
							</Button>
							<p class="muted">
								Draft generation arrives in the next scheduling milestone.
								Readiness is shown here so inputs can be prepared now.
							</p>
						</>
					);
				}}
			</SchedulingReadinessFrame>
		</div>
	);
}
