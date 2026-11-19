import type { JSX } from "solid-js";
import { Portal } from "solid-js/web";

interface ModalBackdropProps {
	children: JSX.Element;
}

// Dialogs mount inside the page shell, not on <body>, so shell-scoped styles
// such as `.parent-shell input` keep applying to them.
const SHELL_SELECTOR = "main.shell";

/**
 * Dims the page behind a dialog. It renders through a Portal so the fixed
 * backdrop is positioned against the window: a panel with `backdrop-filter`
 * or an active `transform` (admin panels scale up on hover) becomes the
 * containing block for fixed descendants and would clip the dialog.
 */
export function ModalBackdrop(props: ModalBackdropProps) {
	const mount = () =>
		document.querySelector<HTMLElement>(SHELL_SELECTOR) ?? document.body;

	return (
		<Portal mount={mount()}>
			<div class="modal-backdrop" role="presentation">
				{props.children}
			</div>
		</Portal>
	);
}
