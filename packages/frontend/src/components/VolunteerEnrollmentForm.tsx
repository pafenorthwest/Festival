import { createSignal, Show } from "solid-js";
import { Button } from "./Button.js";

export interface VolunteerEnrollmentFormProps {
	userEmail: string;
	onEnroll: (data: { name: string; phone: string }) => Promise<void>;
	isEnrolling: boolean;
	error: string | null;
}

export function VolunteerEnrollmentForm(props: VolunteerEnrollmentFormProps) {
	const [name, setName] = createSignal("");
	const [phone, setPhone] = createSignal("");

	async function handleSubmit(event: Event) {
		event.preventDefault();
		await props.onEnroll({ name: name(), phone: phone() });
	}

	return (
		<form class="panel flow-panel" onSubmit={handleSubmit}>
			<h3>Volunteer Enrollment</h3>
			<p class="muted">
				Please confirm your contact details to sign up for volunteer shifts.
			</p>
			<label class="field">
				<span>Name</span>
				<input
					type="text"
					required
					value={name()}
					onInput={(event) => setName(event.currentTarget.value)}
					placeholder="Your full name"
				/>
			</label>
			<label class="field">
				<span>Email</span>
				<input type="email" disabled value={props.userEmail} />
			</label>
			<label class="field">
				<span>Phone</span>
				<input
					type="tel"
					required
					value={phone()}
					onInput={(event) => setPhone(event.currentTarget.value)}
					placeholder="e.g. 555-123-4567"
				/>
			</label>
			<Show when={props.error}>
				<section class="banner error-banner">{props.error}</section>
			</Show>
			<Button type="submit" disabled={props.isEnrolling}>
				{props.isEnrolling ? "Enrolling…" : "Complete Enrollment"}
			</Button>
		</form>
	);
}
