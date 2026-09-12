import { For, Show } from "solid-js";
import { formatDateOnly } from "../app/appFormatting.js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import { Button } from "../components/Button.js";
import { setPrimaryFestival } from "../lib/api.js";

interface AdminFestivalsPageProps {
	app: FestivalAppController;
}

export function AdminFestivalsPage(props: AdminFestivalsPageProps) {
	return (
		<Show
			when={props.app.isAdminMember()}
			fallback={
				<AccessDeniedPanel message="Only Admin members can manage festivals." />
			}
		>
			<section class="panel flow-panel">
				<header class="admin-page-header">
					<div>
						<h2>Festivals</h2>
						<p>Festival dates for this organization.</p>
					</div>
				</header>
				<div class="festival-list">
					<For each={props.app.festivals()}>
						{(festival) => (
							<div class="festival-row">
								<strong>{festival.name}</strong>
								<span>
									{festival.shortName}
									{festival.isPrimary ? " (Primary)" : ""}
								</span>
								<span>{formatDateOnly(festival.startDate)}</span>
								<span>{formatDateOnly(festival.endDate)}</span>
								<Show when={!festival.isPrimary}>
									<Button
										type="button"
										disabled={props.app.isBusy()}
										onClick={async () => {
											const current = props.app
												.festivals()
												.find((item) => item.isPrimary);
											if (
												!confirm(
													`Make ${festival.name} primary instead of ${current?.name ?? "the current Festival"}?`,
												)
											)
												return;
											const user = props.app.firebaseUser();
											if (!user) return;
											props.app.setIsBusy(true);
											try {
												await setPrimaryFestival(
													await user.getIdToken(),
													(props.app.route() as { slug: string }).slug,
													festival.shortName,
												);
												location.reload();
											} finally {
												props.app.setIsBusy(false);
											}
										}}
									>
										Make primary
									</Button>
								</Show>
							</div>
						)}
					</For>
				</div>
				<label class="field">
					<span>Festival short name</span>
					<input
						type="text"
						maxLength={64}
						value={props.app.festivalDraft().shortName}
						onInput={(event) =>
							props.app.setFestivalDraft((current) => ({
								...current,
								shortName: event.currentTarget.value.toLowerCase(),
							}))
						}
					/>
				</label>
				<label class="field">
					<span>Festival name</span>
					<input
						type="text"
						maxLength={255}
						value={props.app.festivalDraft().name}
						onInput={(event) => {
							props.app.setFestivalNameTouched(true);
							props.app.setFestivalDraft((current) => ({
								...current,
								name: event.currentTarget.value,
							}));
						}}
						aria-invalid={props.app.hasFestivalNameError()}
					/>
				</label>
				<Show
					when={
						props.app.shouldShowFestivalNameValidation() &&
						props.app.festivalNameValidationMessage()
					}
				>
					<section class="banner error-banner validation-banner">
						{props.app.festivalNameValidationMessage()}
					</section>
				</Show>
				<label class="field">
					<span>Start date</span>
					<input
						type="date"
						value={props.app.festivalDraft().startDate}
						onInput={(event) =>
							props.app.setFestivalDraft((current) => ({
								...current,
								startDate: event.currentTarget.value,
							}))
						}
					/>
				</label>
				<label class="field">
					<span>End date</span>
					<input
						type="date"
						value={props.app.festivalDraft().endDate}
						onInput={(event) =>
							props.app.setFestivalDraft((current) => ({
								...current,
								endDate: event.currentTarget.value,
							}))
						}
					/>
				</label>
				<Button
					type="button"
					onClick={props.app.handleCreateFestival}
					disabled={props.app.isBusy()}
				>
					Create festival
				</Button>
			</section>
		</Show>
	);
}
