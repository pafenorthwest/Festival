import type { SchedulingDiagnosticIssue } from "@festival/common";
import { For, Show } from "solid-js";

/**
 * Blocking-issue or warning list shared by the Setup capacity preview and the
 * Input review. Each item names its target (registration ID or class code)
 * and configuration path when the diagnostic carries one.
 */
export function SchedulingIssueList(props: {
	title: string;
	issues: readonly SchedulingDiagnosticIssue[];
	tone: "error" | "warning";
	ariaLabel: string;
}) {
	return (
		<Show when={props.issues.length > 0}>
			<section
				class={`scheduling-card ${props.tone === "error" ? "scheduling-alert-box" : "scheduling-warning-box"}`}
				aria-label={props.ariaLabel}
			>
				<h4>
					{props.title} ({props.issues.length})
				</h4>
				<ul class="scheduling-issue-list">
					<For each={props.issues}>
						{(issue) => (
							<li
								class={
									props.tone === "error" ? "scheduling-error-text" : undefined
								}
							>
								<Show when={issue.targetId}>
									<span class="badge badge-neutral scheduling-issue-target">
										{issue.targetId}
									</span>{" "}
								</Show>
								<Show when={issue.path}>
									<code>{issue.path}</code>:{" "}
								</Show>
								{issue.message}
							</li>
						)}
					</For>
				</ul>
			</section>
		</Show>
	);
}
