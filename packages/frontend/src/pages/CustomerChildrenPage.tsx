import { createSignal, For } from "solid-js";
import { Button } from "../components/Button.js";
import {
	type CustomerChildDto,
	createCustomerChild,
	getCustomerChildren,
	refreshCustomerChildAgeSnapshot,
} from "../lib/api.js";
import { CustomerAccountPageLayout } from "./CustomerAccountPageLayout.js";

export function CustomerChildrenPage(props: { slug: string }) {
	const [children, setChildren] = createSignal<CustomerChildDto[]>([]);
	const [displayName, setDisplayName] = createSignal("");
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
					<h1>Children</h1>
					<For each={children()}>
						{(child) => (
							<>
								<p>
									{child.displayName} —{" "}
									{child.hasCurrentValidAgeSnapshot
										? "Age verification current"
										: "Age verification needs refresh"}
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
												.catch((reason) => setError((reason as Error).message));
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
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void createCustomerChild(props.slug, csrfToken, {
								displayName: displayName(),
								birthday: birthday(),
							})
								.then(() => {
									setDisplayName("");
									setBirthday("");
									return load();
								})
								.catch((reason) => setError((reason as Error).message));
						}}
					>
						<label>
							Display name
							<input
								required
								value={displayName()}
								onInput={(event) => setDisplayName(event.currentTarget.value)}
							/>
						</label>
						<label>
							Birthday
							<input
								required
								type="date"
								value={birthday()}
								onInput={(event) => setBirthday(event.currentTarget.value)}
							/>
						</label>
						<Button type="submit">Add child</Button>
					</form>
					{error() && <p role="alert">{error()}</p>}
				</>
			)}
		</CustomerAccountPageLayout>
	);
}
