import { For, Show } from "solid-js";
import type {
	FestivalClassRegistrationPageProps,
	useFestivalRegistrationPage,
} from "../pages/useFestivalRegistrationPage.js";
import { Button } from "./Button.js";

export function FestivalRegistrationContext(input: {
	page: FestivalClassRegistrationPageProps;
	state: ReturnType<typeof useFestivalRegistrationPage>;
}) {
	const props = input.page;
	const {
		selectedChildId,
		selectedDivisionId,
		selectedTeacherId,
		selectHandlers,
		children,
		divisions,
		selectedChild,
		teachers,
		options,
		birthdayDraft,
		setBirthdayDraft,
		isRefreshingSnapshot,
		snapshotError,
		handleRefreshSnapshot,
	} = input.state;
	return (
		<>
			<section class="parent-panel parent-context-selectors">
				<label class="field">
					<span>Performer</span>
					<select
						id="registration-child"
						value={selectedChildId()}
						onChange={selectHandlers.onChildChange}
					>
						<option value="" selected={!selectedChildId()}>
							Select performer…
						</option>
						<For each={children()}>
							{(child) => (
								<option
									value={child.id}
									selected={selectedChildId() === child.id}
								>
									{child.displayName}
								</option>
							)}
						</For>
					</select>
					<a
						href={`/org/${props.slug}/account/children`}
						onClick={(event) => {
							event.preventDefault();
							props.app.navigate(`/org/${props.slug}/account/children`);
						}}
					>
						Manage performers
					</a>
				</label>
				<label class="field">
					<span>Division</span>
					<select
						id="registration-division"
						value={selectedDivisionId()}
						disabled={
							!selectedChild()?.hasCurrentValidAgeSnapshot ||
							divisions.loading ||
							Boolean(divisions.error)
						}
						onChange={selectHandlers.onDivisionChange}
					>
						<option value="" selected={!selectedDivisionId()}>
							Select division…
						</option>
						<For each={divisions()?.divisions ?? []}>
							{(division) => (
								<option
									value={division.id}
									selected={selectedDivisionId() === division.id}
								>
									{division.displayName}
								</option>
							)}
						</For>
					</select>
				</label>
				<label class="field">
					<span>Registered teacher</span>
					<select
						id="registration-teacher"
						value={selectedTeacherId()}
						disabled={!selectedDivisionId() || options.teachersLoading()}
						onChange={selectHandlers.onTeacherChange}
					>
						<option value="" selected={!selectedTeacherId()}>
							Select teacher…
						</option>
						<For each={teachers()}>
							{(teacher) => (
								<option
									value={teacher.id}
									selected={selectedTeacherId() === teacher.id}
								>
									{teacher.name}
								</option>
							)}
						</For>
					</select>
					<details>
						<summary>My teacher isn’t listed</summary>
						<p class="muted">
							Please contact the festival office for help with your teacher’s
							registration. A registered teacher in this division is required.
						</p>
					</details>
				</label>
			</section>
			<Show
				when={
					divisions.error || options.teachersError() || options.classesError()
				}
			>
				<p class="field-error" role="alert">
					{divisions.error
						? "Divisions could not be loaded. Please try again."
						: options.teachersError() || options.classesError()}
				</p>
				<Button
					type="button"
					variant="secondary"
					onClick={() =>
						divisions.error
							? void input.state.retryDivisions()
							: options.retryOptions()
					}
				>
					Retry registration options
				</Button>
			</Show>
			<Show
				when={selectedChild() && !selectedChild()?.hasCurrentValidAgeSnapshot}
			>
				<section class="parent-panel">
					<h2>Confirm performer age</h2>
					<p>
						Provide {selectedChild()?.displayName}’s birthdate to refresh their
						eligibility.
					</p>
					<form onSubmit={handleRefreshSnapshot}>
						<label class="field">
							<span>Birthdate</span>
							<input
								type="date"
								value={birthdayDraft()}
								onInput={(event) => setBirthdayDraft(event.currentTarget.value)}
								required
							/>
						</label>
						<Button type="submit" disabled={isRefreshingSnapshot()}>
							{isRefreshingSnapshot() ? "Verifying…" : "Confirm Birthdate"}
						</Button>
					</form>
					<Show when={snapshotError()}>
						<p class="field-error" role="alert">
							{snapshotError()}
						</p>
					</Show>
				</section>
			</Show>
		</>
	);
}
