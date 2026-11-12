import { createSignal, onCleanup, onMount } from "solid-js";

export function PurchasedRegistrationEditHelp(props: { id: string }) {
	const [open, setOpen] = createSignal(false);
	let help: HTMLSpanElement | undefined;
	let trigger: HTMLButtonElement | undefined;
	onMount(() => {
		const closeOutside = (event: PointerEvent) => {
			if (event.target instanceof Node && !help?.contains(event.target))
				setOpen(false);
		};
		document.addEventListener("pointerdown", closeOutside);
		onCleanup(() => document.removeEventListener("pointerdown", closeOutside));
	});
	return (
		<span
			class="registration-edit-help"
			ref={help}
			onPointerEnter={() => setOpen(true)}
			onPointerLeave={() => {
				if (document.activeElement !== trigger) setOpen(false);
			}}
		>
			<button
				ref={trigger}
				type="button"
				class="registration-edit-info"
				aria-label="About editing this registration"
				aria-describedby={props.id}
				onFocus={() => setOpen(true)}
				onBlur={() => setOpen(false)}
				onClick={() => {
					setOpen(true);
					trigger?.focus();
				}}
				onKeyDown={(event) => {
					if (event.key === "Escape") setOpen(false);
				}}
			>
				<svg
					viewBox="0 0 24 24"
					width="18"
					height="18"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					aria-hidden="true"
				>
					<circle cx="12" cy="12" r="9" />
					<path d="M12 10.5v6" />
					<circle cx="12" cy="7.5" r=".8" fill="currentColor" stroke="none" />
				</svg>
			</button>
			<span
				id={props.id}
				class="registration-edit-tooltip"
				role="tooltip"
				style={{
					visibility: open() ? "visible" : "hidden",
					opacity: open() ? 1 : 0,
				}}
			>
				Edit Repertoire / Accompanist
			</span>
		</span>
	);
}
