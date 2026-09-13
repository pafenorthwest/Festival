import { createEffect, createSignal, For, onMount, Show } from "solid-js";
import { Button } from "../components/Button.js";
import {
	acquireAccompanistMembership,
	customerAccompanistMembershipSignInPath,
	getAccompanistMembershipForm,
	getCustomerProfile,
	getCustomerSession,
} from "../lib/api.js";
import { buildOrgRootPath } from "../lib/routes.js";

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
	const [authenticated, setAuthenticated] = createSignal(false);
	const [needsSignIn, setNeedsSignIn] = createSignal(false);
	const [redirectingToShopify, setRedirectingToShopify] = createSignal(false);
	const [submitting, setSubmitting] = createSignal(false);
	const [error, setError] = createSignal("");
	const [success, setSuccess] = createSignal("");
	let signInDialog: HTMLElement | undefined;

	onMount(async () => {
		try {
			const session = await getCustomerSession(props.slug);
			if (!session.session.authenticated) {
				setNeedsSignIn(true);
				return;
			}
			const [profile, form] = await Promise.all([
				getCustomerProfile(props.slug),
				getAccompanistMembershipForm(props.slug),
			]);
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
			setAuthenticated(true);
		} catch {
			setError("Accompanist membership information could not be loaded.");
		} finally {
			setLoading(false);
		}
	});

	createEffect(() => {
		if (needsSignIn()) signInDialog?.focus();
	});

	function trapSignInDialogFocus(event: KeyboardEvent) {
		if (event.key !== "Tab" || !signInDialog) return;
		const focusable = Array.from(
			signInDialog.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
			),
		);
		const first = focusable[0];
		const last = focusable.at(-1);
		if (!first || !last) {
			event.preventDefault();
			return;
		}
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	function continueToShopify() {
		if (redirectingToShopify()) return;
		setRedirectingToShopify(true);
		window.location.assign(customerAccompanistMembershipSignInPath(props.slug));
	}

	function cancelSignIn() {
		if (redirectingToShopify()) return;
		window.location.assign(buildOrgRootPath(props.slug));
	}

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
				<p role="status">Checking your sign-in status…</p>
			</Show>
			<Show when={error()}>{(message) => <p role="alert">{message()}</p>}</Show>
			<Show when={needsSignIn()}>
				<div class="modal-backdrop" role="presentation">
					<section
						ref={signInDialog}
						class="modal-card accompanist-sign-in-card"
						role="dialog"
						aria-modal="true"
						aria-labelledby="accompanist-sign-in-title"
						aria-describedby="accompanist-sign-in-description"
						tabindex="-1"
						onKeyDown={trapSignInDialogFocus}
					>
						<h3 id="accompanist-sign-in-title">Sign in to continue</h3>
						<p id="accompanist-sign-in-description">
							You'll sign in securely with Shopify to complete your accompanist
							membership and select your divisions.
						</p>
						<p>
							Sign in is required before we can show your enrollment details.
						</p>
						<div class="modal-actions">
							<Button
								type="button"
								disabled={redirectingToShopify()}
								onClick={continueToShopify}
							>
								{redirectingToShopify()
									? "Continuing to Shopify…"
									: "Continue to Shopify"}
							</Button>
							<Button
								type="button"
								variant="secondary"
								disabled={redirectingToShopify()}
								onClick={cancelSignIn}
							>
								Cancel
							</Button>
						</div>
					</section>
				</div>
			</Show>
			<Show when={authenticated()}>
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
