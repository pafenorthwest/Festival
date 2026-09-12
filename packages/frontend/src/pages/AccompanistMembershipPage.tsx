import { createSignal, For, onMount, Show } from "solid-js";
import { Button } from "../components/Button.js";
import {
	acquireAccompanistMembership,
	getAccompanistMembershipForm,
	getCustomerProfile,
	getCustomerSession,
} from "../lib/api.js";

export function AccompanistMembershipPage(props: { slug: string }) {
	const [csrfToken, setCsrfToken] = createSignal("");
	const [name, setName] = createSignal("");
	const [email, setEmail] = createSignal("");
	const [city, setCity] = createSignal("");
	const [phone, setPhone] = createSignal("");
	const [divisions, setDivisions] = createSignal<
		Array<{ id: string; displayName: string }>
	>([]);
	const [selected, setSelected] = createSignal<string[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [submitting, setSubmitting] = createSignal(false);
	const [error, setError] = createSignal("");
	const [success, setSuccess] = createSignal("");

	onMount(async () => {
		try {
			const [session, profile, form] = await Promise.all([
				getCustomerSession(props.slug),
				getCustomerProfile(props.slug),
				getAccompanistMembershipForm(props.slug),
			]);
			if (!session.session.authenticated) {
				window.location.assign(
					`/api/organizations/${encodeURIComponent(props.slug)}/customer-auth/start?returnTo=${encodeURIComponent(window.location.pathname)}`,
				);
				return;
			}
			setCsrfToken(session.session.csrfToken);
			setName(profile.profile.name ?? "");
			setEmail(profile.profile.email ?? "");
			setPhone(profile.profile.phone ?? "");
			setCity(profile.profile.mailingAddress?.city ?? "");
			setDivisions(form.divisions);
			setSelected(
				form.policy.policy === "one_to_all"
					? form.divisions.map((division) => division.id)
					: form.divisions.slice(0, 1).map((division) => division.id),
			);
		} catch {
			setError("Accompanist membership information could not be loaded.");
		} finally {
			setLoading(false);
		}
	});

	function toggle(id: string) {
		setSelected((current) =>
			current.includes(id)
				? current.filter((entry) => entry !== id)
				: [...current, id],
		);
	}
	async function submit(event: SubmitEvent) {
		event.preventDefault();
		setError("");
		setSuccess("");
		setSubmitting(true);
		try {
			const result = await acquireAccompanistMembership(
				props.slug,
				csrfToken(),
				{
					name: name(),
					email: email(),
					city: city(),
					phone: phone(),
					divisionIds: selected(),
				},
			);
			setSuccess(`Membership active through ${result.membership.endsOn}.`);
		} catch (reason) {
			setError(
				reason instanceof Error
					? reason.message
					: "Accompanist membership could not be saved.",
			);
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<section class="panel flow-panel">
			<h2>Accompanist Membership</h2>
			<Show when={loading()}>
				<p role="status">Loading membership form…</p>
			</Show>
			<Show when={error()}>{(message) => <p role="alert">{message()}</p>}</Show>
			<Show when={!loading()}>
				<form class="flow-panel" onSubmit={submit}>
					<label>
						Name
						<input
							value={name()}
							onInput={(event) => setName(event.currentTarget.value)}
							required
						/>
					</label>
					<label>
						Email
						<input
							type="email"
							value={email()}
							onInput={(event) => setEmail(event.currentTarget.value)}
							required
						/>
					</label>
					<label>
						City
						<input
							value={city()}
							onInput={(event) => setCity(event.currentTarget.value)}
							required
						/>
					</label>
					<label>
						Phone
						<input
							value={phone()}
							onInput={(event) => setPhone(event.currentTarget.value)}
							required
						/>
					</label>
					<fieldset>
						<legend>Divisions</legend>
						<For each={divisions()}>
							{(division) => (
								<label>
									<input
										type="checkbox"
										checked={selected().includes(division.id)}
										onChange={() => toggle(division.id)}
									/>{" "}
									{division.displayName}
								</label>
							)}
						</For>
					</fieldset>
					<Button type="submit" disabled={submitting()}>
						{submitting() ? "Saving…" : "Activate membership"}
					</Button>
					<Show when={success()}>
						{(message) => <p role="status">{message()}</p>}
					</Show>
				</form>
			</Show>
		</section>
	);
}
