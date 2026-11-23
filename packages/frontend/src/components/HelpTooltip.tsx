import { createSignal, onCleanup, onMount } from "solid-js";

export const CHECKBOX_HELP_TEXT = {
	membershipDataConsent:
		"Allows festival staff to access your Shopify contact details (name, email, phone, and mailing address) to manage your membership and support registrations. Payment card details stay with Shopify and are never shared with Festival.",
	waitlistDataConsent:
		"Allows festival staff to use your contact information (name, email, and phone) to notify you if a spot opens and coordinate waitlist placement.",
	publicDirectoryPublishing:
		"Optional. Publishes only your display name and division in the Public Teacher Directory while your teacher membership is active. Private details like email, phone, and address are never shown. You can change this anytime in your account.",
	accompanistDirectoryPublishing:
		"Optional. Publishes only your display name, role, and approved divisions in the Public Directory while your accompanist membership is active. Private details like email, phone, and city are never shown. You can change this anytime in your account.",
} as const;

export const CUSTOMER_HELP_TEXT = {
	dropRefundRequest:
		"Submits a refund request to festival staff when you drop this registration. Refunds are reviewed and processed according to the organization's refund policy and are not automatic.",
	ageVerification:
		"For privacy, Festival verifies your performer's age as of the organization's age cutoff date without storing their birth date permanently. Re-enter their birthday whenever the cutoff date changes or verification expires.",
	paidWaitlist:
		"Your payment succeeded as the class reached capacity. Your performer holds a paid waitlist spot; festival staff will promote them if space opens or contact you about a transfer or refund.",
	accompanistDivisions:
		"Select the divisions you are available to accompany. Performers registering in these divisions will be able to choose you as their accompanist.",
	concertoCatalog:
		"Concerto classes require selecting an approved work from the festival catalog, which pre-fills title and composer. Contact the festival office if your concerto is not listed.",
	transferClass:
		"Moves this registration to another eligible class. Your existing repertoire and accompanist stay attached if compatible; contact the festival office for fee differences.",
} as const;

function HelpInfoIcon() {
	return (
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
	);
}

export function HelpTooltip(props: {
	id: string;
	label: string;
	text: string;
}) {
	const [open, setOpen] = createSignal(false);
	let help: HTMLSpanElement | undefined;
	let trigger: HTMLButtonElement | undefined;
	let pointerDown = false;
	onMount(() => {
		if (typeof document === "undefined") return;
		const closeOutside = (event: PointerEvent) => {
			if (
				typeof Node !== "undefined" &&
				event.target instanceof Node &&
				!help?.contains(event.target)
			)
				setOpen(false);
		};
		document.addEventListener("pointerdown", closeOutside);
		onCleanup(() => document.removeEventListener("pointerdown", closeOutside));
	});
	return (
		<span
			class="help-tooltip"
			ref={help}
			onPointerEnter={(event) => {
				if (event.pointerType !== "touch") setOpen(true);
			}}
			onPointerLeave={(event) => {
				if (
					event.pointerType !== "touch" &&
					(typeof document === "undefined" ||
						document.activeElement !== trigger)
				)
					setOpen(false);
			}}
		>
			<button
				ref={trigger}
				type="button"
				class="help-tooltip-trigger"
				aria-label={props.label}
				aria-describedby={props.id}
				aria-expanded={open()}
				onPointerDown={() => {
					pointerDown = true;
				}}
				onFocus={() => {
					if (!pointerDown) setOpen(true);
					pointerDown = false;
				}}
				onBlur={() => setOpen(false)}
				onClick={() => {
					pointerDown = false;
					setOpen((current) => !current);
				}}
				onKeyDown={(event) => {
					if (event.key === "Escape") setOpen(false);
				}}
			>
				<HelpInfoIcon />
			</button>
			<span
				id={props.id}
				class="help-tooltip-bubble"
				role="tooltip"
				data-open={open() ? "true" : "false"}
				style={{
					visibility: open() ? "visible" : "hidden",
					opacity: open() ? 1 : 0,
				}}
			>
				{props.text}
			</span>
		</span>
	);
}
