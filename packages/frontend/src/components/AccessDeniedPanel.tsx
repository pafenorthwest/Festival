import { Show } from "solid-js";
import { useOptionalFestivalShell } from "../app/FestivalShellContext.js";

interface AccessDeniedPanelProps {
	message: string;
}

export function AccessDeniedPanel(props: AccessDeniedPanelProps) {
	const shell = useOptionalFestivalShell();
	return (
		<Show
			when={!shell?.isSessionHydrating?.()}
			fallback={
				<section class="panel flow-panel">
					<p role="status">Loading…</p>
				</section>
			}
		>
			<section class="panel flow-panel access-denied-panel">
				<h2>Access denied</h2>
				<p>{props.message}</p>
			</section>
		</Show>
	);
}
