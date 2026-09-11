import type { UpdateCustomerProfileInput } from "@festival/common";
import { createSignal, Show } from "solid-js";
import { Button } from "../components/Button.js";
import { getCustomerProfile, updateCustomerProfile } from "../lib/api.js";
import { CustomerAccountPageLayout } from "./CustomerAccountPageLayout.js";

export function CustomerAccountContactPage(props: { slug: string }) {
	const [profile, setProfile] = createSignal<UpdateCustomerProfileInput>({
		name: "",
		email: "",
		mailingAddress: {
			line1: "",
			line2: "",
			city: "",
			region: "",
			postalCode: "",
			countryCode: "",
		},
		phone: "",
	});
	const [savingProfile, setSavingProfile] = createSignal(false);
	const [error, setError] = createSignal("");
	const [status, setStatus] = createSignal("");
	let csrfToken = "";
	let form: HTMLFormElement | undefined;

	async function loadProfile() {
		const profileResponse = await getCustomerProfile(props.slug);
		const current = profileResponse.profile;
		setProfile({
			name: current.name ?? "",
			email: current.email ?? "",
			mailingAddress: {
				line1: current.mailingAddress?.line1 ?? "",
				line2: current.mailingAddress?.line2 ?? "",
				city: current.mailingAddress?.city ?? "",
				region: current.mailingAddress?.region ?? "",
				postalCode: current.mailingAddress?.postalCode ?? "",
				countryCode: current.mailingAddress?.countryCode ?? "",
			},
			phone: current.phone ?? "",
		});
	}

	async function saveProfile() {
		setError("");
		setStatus("");
		setSavingProfile(true);
		try {
			const response = await updateCustomerProfile(
				props.slug,
				csrfToken,
				profile(),
			);
			const current = response.profile;
			setProfile({
				name: current.name ?? "",
				email: current.email ?? "",
				mailingAddress: {
					line1: current.mailingAddress?.line1 ?? "",
					line2: current.mailingAddress?.line2 ?? "",
					city: current.mailingAddress?.city ?? "",
					region: current.mailingAddress?.region ?? "",
					postalCode: current.mailingAddress?.postalCode ?? "",
					countryCode: current.mailingAddress?.countryCode ?? "",
				},
				phone: current.phone ?? "",
			});
			setStatus("Profile saved in Festival.");
		} catch (error) {
			setError((error as Error).message);
		} finally {
			setSavingProfile(false);
		}
	}

	return (
		<CustomerAccountPageLayout
			slug={props.slug}
			onAuthenticated={(session) => {
				csrfToken = session.csrfToken;
				void loadProfile().catch((error) => setError((error as Error).message));
			}}
		>
			{() => (
				<>
					<h1>Contact Information</h1>
					<form
						ref={form}
						class="flow-panel"
						onSubmit={(event) => {
							event.preventDefault();
							void saveProfile();
						}}
					>
						<h2>Festival profile</h2>
						<p class="muted">
							These details are stored in Festival. Changes here do not update
							Shopify.
						</p>
						<label>
							<span>Name</span>
							<input
								required
								value={profile().name}
								onInput={(event) =>
									setProfile((current) => ({
										...current,
										name: event.currentTarget.value,
									}))
								}
							/>
						</label>
						<label>
							<span>Email</span>
							<input
								type="email"
								required
								value={profile().email}
								onInput={(event) =>
									setProfile((current) => ({
										...current,
										email: event.currentTarget.value,
									}))
								}
							/>
						</label>
						<label>
							<span>Phone</span>
							<input
								type="tel"
								required
								value={profile().phone}
								onInput={(event) =>
									setProfile((current) => ({
										...current,
										phone: event.currentTarget.value,
									}))
								}
							/>
						</label>
						<fieldset>
							<legend>Mailing address</legend>
							{(
								[
									["line1", "Address line 1"],
									["line2", "Address line 2"],
									["city", "City"],
									["region", "State or region"],
									["postalCode", "Postal code"],
									["countryCode", "Two-letter country code"],
								] as const
							).map(([field, label]) => (
								<label>
									<span>{label}</span>
									<input
										required={field !== "line2"}
										maxlength={field === "countryCode" ? 2 : undefined}
										value={profile().mailingAddress[field] ?? ""}
										onInput={(event) =>
											setProfile((current) => ({
												...current,
												mailingAddress: {
													...current.mailingAddress,
													[field]: event.currentTarget.value,
												},
											}))
										}
									/>
								</label>
							))}
						</fieldset>
						<Button
							type="button"
							disabled={savingProfile()}
							onClick={() => {
								if (form?.reportValidity()) void saveProfile();
							}}
						>
							{savingProfile() ? "Saving…" : "Save Festival profile"}
						</Button>
					</form>
					<Show when={status()}>
						{(message) => <p role="status">{message()}</p>}
					</Show>
					<Show when={error()}>
						{(message) => (
							<p class="error-text" role="alert">
								{message()}
							</p>
						)}
					</Show>
				</>
			)}
		</CustomerAccountPageLayout>
	);
}
