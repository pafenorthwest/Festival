import { createSignal, For, onMount, Show } from "solid-js";
import { listIanaTimezones } from "../app/adminDivisions.js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import { Button } from "../components/Button.js";
import {
	getAdminRegistrationConfiguration,
	getAdminTimezone,
	updateAdminRegistrationAgeDate,
	updateAdminTimezone,
} from "../lib/api.js";

export function AdminSettingsPage(props: { app: FestivalAppController }) {
	const [timezone, setTimezone] = createSignal("");
	const [timezoneDraft, setTimezoneDraft] = createSignal("");
	const [registrationAgeDate, setRegistrationAgeDate] = createSignal("");
	const [isLoading, setIsLoading] = createSignal(true);
	const [isSaving, setIsSaving] = createSignal(false);
	const [error, setError] = createSignal("");

	onMount(() => {
		const route = props.app.route();
		const user = props.app.firebaseUser();
		if (route.kind !== "org-admin-settings" || !user) return;
		void (async () => {
			try {
				const [timezoneResponse, registrationResponse] = await Promise.all([
					getAdminTimezone(await user.getIdToken(), route.slug),
					getAdminRegistrationConfiguration(
						await user.getIdToken(),
						route.slug,
					),
				]);
				setTimezone(timezoneResponse.timezone);
				setTimezoneDraft(timezoneResponse.timezone);
				setRegistrationAgeDate(
					registrationResponse.ageConfiguration?.registrationAgeDate ?? "",
				);
			} catch (reason) {
				setError(
					reason instanceof Error
						? reason.message
						: "Organization settings could not be loaded.",
				);
			} finally {
				setIsLoading(false);
			}
		})();
	});

	async function saveTimezone() {
		const route = props.app.route();
		const user = props.app.firebaseUser();
		if (
			route.kind !== "org-admin-settings" ||
			!user ||
			isSaving() ||
			timezoneDraft() === timezone()
		)
			return;
		setIsSaving(true);
		setError("");
		try {
			const response = await updateAdminTimezone(
				await user.getIdToken(),
				route.slug,
				{ timezone: timezoneDraft() },
			);
			setTimezone(response.timezone);
			setTimezoneDraft(response.timezone);
		} catch (reason) {
			setError(
				reason instanceof Error
					? reason.message
					: "Timezone could not be saved.",
			);
			setTimezoneDraft(timezone());
		} finally {
			setIsSaving(false);
		}
	}

	async function saveRegistrationAgeDate() {
		const route = props.app.route();
		const user = props.app.firebaseUser();
		if (
			route.kind !== "org-admin-settings" ||
			!user ||
			isSaving() ||
			!registrationAgeDate()
		)
			return;
		setIsSaving(true);
		setError("");
		try {
			const response = await updateAdminRegistrationAgeDate(
				await user.getIdToken(),
				route.slug,
				registrationAgeDate(),
			);
			setRegistrationAgeDate(response.ageConfiguration.registrationAgeDate);
		} catch (reason) {
			setError(
				reason instanceof Error
					? reason.message
					: "Registration age cutoff could not be saved.",
			);
		} finally {
			setIsSaving(false);
		}
	}

	return (
		<Show
			when={props.app.isAdminMember()}
			fallback={
				<AccessDeniedPanel message="Only Admin members can manage organization settings." />
			}
		>
			<Show when={isLoading()}>
				<section class="panel flow-panel">
					<p role="status">Loading organization settings…</p>
				</section>
			</Show>
			<Show when={error()}>
				<section class="panel flow-panel">
					<p role="alert">{error()}</p>
				</section>
			</Show>

			<Show when={!isLoading() && !error()}>
				<section class="panel flow-panel">
					<h3>Organization timezone</h3>
					<label class="field">
						<select
							aria-label="Organization timezone"
							value={timezoneDraft()}
							onChange={(event) => setTimezoneDraft(event.currentTarget.value)}
						>
							<For each={listIanaTimezones(timezone())}>
								{(value) => <option value={value}>{value}</option>}
							</For>
						</select>
					</label>
					<Button
						type="button"
						disabled={isSaving() || timezoneDraft() === timezone()}
						onClick={() => void saveTimezone()}
					>
						Save timezone
					</Button>
				</section>

				<section class="panel flow-panel">
					<h3>Registration age cutoff</h3>
					<fieldset class="field">
						<legend>Age calculation date</legend>
						<p class="muted">
							A registrant’s age is calculated as of this date for every
							festival registration.
						</p>
						<input
							type="date"
							value={registrationAgeDate()}
							onInput={(event) =>
								setRegistrationAgeDate(event.currentTarget.value)
							}
						/>
					</fieldset>
					<Button
						type="button"
						disabled={isSaving() || !registrationAgeDate()}
						onClick={() => void saveRegistrationAgeDate()}
					>
						Save registration age cutoff
					</Button>
				</section>
			</Show>
		</Show>
	);
}
