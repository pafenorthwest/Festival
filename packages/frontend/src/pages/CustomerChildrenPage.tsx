import { createSignal, For, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { Button } from "../components/Button.js";
import {
	type CustomerChildDto,
	createCustomerChild,
	getCustomerChildren,
	refreshCustomerChildAgeSnapshot,
} from "../lib/api.js";
import { buildFestivalRegistrationPath } from "../lib/routes.js";
import { CustomerAccountPageLayout } from "./CustomerAccountPageLayout.js";

export function childDisplayName(
	firstName: string,
	familyName: string,
	nickName: string,
): string {
	const name = `${firstName.trim()} ${familyName.trim()}`;
	const nickname = nickName.trim();
	return nickname ? `${name} "${nickname}"` : name;
}

export function CustomerChildrenPage(props: {
	slug: string;
	app?: FestivalAppController;
}) {
	const [children, setChildren] = createSignal<CustomerChildDto[]>([]);
	const [isAdding, setIsAdding] = createSignal(false);
	const [status, setStatus] = createSignal("");
	const activeFestival = () =>
		props.app?.parentRegistration.activeFestival(props.slug);
	const [firstName, setFirstName] = createSignal("");
	const [familyName, setFamilyName] = createSignal("");
	const [nickName, setNickName] = createSignal("");
	const [nameFieldsStacked, setNameFieldsStacked] = createSignal(false);
	const [birthday, setBirthday] = createSignal("");
	const [error, setError] = createSignal("");
	let csrfToken = "";
	const [refreshingChildId, setRefreshingChildId] = createSignal("");
	const [refreshBirthday, setRefreshBirthday] = createSignal("");
	async function load() {
		setChildren((await getCustomerChildren(props.slug)).children);
	}
	return (
		<CustomerAccountPageLayout
			slug={props.slug}
			onAuthenticated={(session) => {
				csrfToken = session.csrfToken;
				void load().catch((reason) => setError((reason as Error).message));
			}}
		>
			{() => (
				<>
					<div class="parent-page-heading">
						<p class="eyebrow">Your family</p>
						<h1>Performers</h1>
						<p class="muted">
							Manage your children’s records. Choose their classes separately in
							Registration.
						</p>
					</div>
					<div class="parent-section-heading">
						<h2>Your performers</h2>
						<Button type="button" onClick={() => setIsAdding(true)}>
							Add Performer
						</Button>
					</div>
					<Show when={status()}>
						<p role="status">{status()}</p>
					</Show>
					<div class="parent-performer-list">
						<For each={children()}>
							{(child) => (
								<>
									<p class="customer-child-status parent-performer-row">
										<strong>{child.displayName}</strong>
										<span class="muted">
											{" "}
											—{" "}
											{child.hasCurrentValidAgeSnapshot
												? "Age verification current"
												: "Age verification needs refresh"}
										</span>
									</p>
									{!child.hasCurrentValidAgeSnapshot && (
										<form
											onSubmit={(event) => {
												event.preventDefault();
												void refreshCustomerChildAgeSnapshot(
													props.slug,
													child.id,
													csrfToken,
													refreshBirthday(),
												)
													.then(() => {
														setRefreshBirthday("");
														setRefreshingChildId("");
														return load();
													})
													.catch((reason) =>
														setError((reason as Error).message),
													);
											}}
										>
											<Button
												type="button"
												onClick={() => setRefreshingChildId(child.id)}
											>
												Refresh age
											</Button>
											{refreshingChildId() === child.id && (
												<>
													<input
														required
														type="date"
														value={refreshBirthday()}
														onInput={(event) =>
															setRefreshBirthday(event.currentTarget.value)
														}
													/>
													<Button type="submit">Save age</Button>
												</>
											)}
										</form>
									)}
								</>
							)}
						</For>
					</div>
					<Show when={activeFestival() && children().length > 0}>
						<a
							class="parent-continue-link"
							href={buildFestivalRegistrationPath(
								props.slug,
								activeFestival() ?? "",
							)}
							onClick={(event) => {
								if (
									event.button !== 0 ||
									event.metaKey ||
									event.ctrlKey ||
									event.shiftKey ||
									event.altKey
								)
									return;
								event.preventDefault();
								props.app?.navigate(
									buildFestivalRegistrationPath(
										props.slug,
										activeFestival() ?? "",
									),
								);
							}}
						>
							Continue Registration →
						</a>
					</Show>
					<Show when={isAdding() || children().length === 0}>
						<h2>Add a performer</h2>
						<button
							type="button"
							class="customer-children-name-layout-toggle"
							classList={{ "is-stacked": nameFieldsStacked() }}
							aria-label={
								nameFieldsStacked()
									? "Show name fields side by side"
									: "Show name fields one per row"
							}
							aria-pressed={nameFieldsStacked()}
							onClick={() => setNameFieldsStacked((current) => !current)}
						/>
						<form
							class="customer-children-form"
							onSubmit={(event) => {
								event.preventDefault();
								void createCustomerChild(props.slug, csrfToken, {
									displayName: childDisplayName(
										firstName(),
										familyName(),
										nickName(),
									),
									birthday: birthday(),
								})
									.then(() => {
										setFirstName("");
										setFamilyName("");
										setNickName("");
										setBirthday("");
										setIsAdding(false);
										setStatus("Performer added.");
										return load();
									})
									.catch((reason) => setError((reason as Error).message));
							}}
						>
							<div
								class="customer-children-name-fields"
								classList={{ "is-stacked": nameFieldsStacked() }}
							>
								<label class="field">
									<span>First Name</span>
									<input
										required
										value={firstName()}
										onInput={(event) => setFirstName(event.currentTarget.value)}
									/>
								</label>
								<label class="field">
									<span>Family Name</span>
									<input
										required
										value={familyName()}
										onInput={(event) =>
											setFamilyName(event.currentTarget.value)
										}
									/>
								</label>
								<label class="field">
									<span>
										Nick Name{" "}
										<em class="customer-children-name-optional">(optional)</em>
									</span>
									<input
										value={nickName()}
										onInput={(event) => setNickName(event.currentTarget.value)}
									/>
								</label>
							</div>
							<label class="field">
								<span>Birthday</span>
								<input
									required
									type="date"
									value={birthday()}
									onInput={(event) => setBirthday(event.currentTarget.value)}
								/>
							</label>
							<Button type="submit">Add Performer</Button>
						</form>
					</Show>
					{error() && <p role="alert">{error()}</p>}
				</>
			)}
		</CustomerAccountPageLayout>
	);
}
