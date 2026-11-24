import { For, Show } from "solid-js";

export interface SchedulingIssueLike {
	message: string;
	path?: ReadonlyArray<{ key: unknown }> | undefined;
}

export interface FormattedSchedulingIssue {
	path: string;
	message: string;
}

/**
 * Converts validation issues into `{ path, message }` pairs. The path is a
 * dot path (same shape as valibot's `getDotPath`) with the request-level
 * `config.` prefix removed so it points at the edited field.
 */
export function formatSchedulingIssues(
	issues: ReadonlyArray<SchedulingIssueLike>,
): FormattedSchedulingIssue[] {
	return issues.map((issue) => {
		const keys = (issue.path ?? []).map((item) => String(item.key));
		const path = (keys[0] === "config" ? keys.slice(1) : keys).join(".");
		return { path, message: issue.message };
	});
}

/**
 * Formats a server-side validation error (`{ error, code, path }`) as an
 * issue. The `config.` prefix is removed so the path matches client issues.
 * Server messages may end with the path in parentheses ("… (config.x)");
 * that suffix is dropped when the path is shown separately.
 */
export function formatServerSchedulingIssue(error: {
	message: string;
	path?: string | undefined;
}): FormattedSchedulingIssue {
	const raw = error.path ?? "";
	const path = raw.startsWith("config.") ? raw.slice("config.".length) : raw;
	if (!raw) return { path, message: error.message };
	const message = [` (${raw})`, ` (${path})`, `(${raw})`, `(${path})`].reduce(
		(text, suffix) =>
			text.endsWith(suffix) ? text.slice(0, -suffix.length) : text,
		error.message,
	);
	return { path, message: message.trimEnd() };
}

export function SchedulingValidationIssues(props: {
	issues: FormattedSchedulingIssue[];
}) {
	return (
		<Show when={props.issues.length > 0}>
			<div role="alert" class="scheduling-validation-issues">
				<p>Fix these issues before saving:</p>
				<ul class="scheduling-issue-list">
					<For each={props.issues}>
						{(issue) => (
							<li class="scheduling-error-text">
								<Show when={issue.path}>
									<code>{issue.path}</code>:{" "}
								</Show>
								{issue.message}
							</li>
						)}
					</For>
				</ul>
			</div>
		</Show>
	);
}
