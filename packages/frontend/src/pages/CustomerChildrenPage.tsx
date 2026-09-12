import { For, createSignal } from "solid-js";
import { Button } from "../components/Button.js";
import {
	createCustomerChild,
	getCustomerChildren,
	type CustomerChildDto,
} from "../lib/api.js";
import { CustomerAccountPageLayout } from "./CustomerAccountPageLayout.js";

export function CustomerChildrenPage(props: { slug: string }) {
	const [children, setChildren] = createSignal<CustomerChildDto[]>([]);
	const [displayName, setDisplayName] = createSignal("");
	const [birthday, setBirthday] = createSignal("");
	const [error, setError] = createSignal("");
	let csrfToken = "";
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
							<p>
								{child.displayName} —{" "}
								{child.hasCurrentValidAgeSnapshot
									? "Age verification current"
									: "Age verification needs refresh"}
							</p>
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
