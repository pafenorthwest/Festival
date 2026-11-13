import { Show } from "solid-js";
import { Button } from "../components/Button.js";
import { useCustomerIdentity } from "../domains/customer/CustomerIdentityContext.js";
import {
	FestivalRegistrationCartSection,
	FestivalRegistrationClassView,
	FestivalRegistrationWaitlistPanel,
	FestivalRegistrationWorkspaceView,
} from "../domains/registration/FestivalRegistrationForm.js";
import {
	type FestivalClassRegistrationPageProps,
	type FestivalRegistrationPageState,
	useFestivalRegistrationPage,
} from "../domains/registration/useFestivalRegistrationPage.js";
import { customerFestivalRegistrationSignInPath } from "../lib/api.js";

function RegistrationPageHeading(props: {
	state: FestivalRegistrationPageState;
}) {
	const { state } = props;
	const view = state.view;
	return (
		<header class="parent-page-heading">
			<p class="parent-eyebrow">
				{state.festival()?.festival.name ?? "Festival"}
			</p>
			<h1>
				{view() === "cart"
					? "Your cart"
					: view() === "class"
						? (state.selectedClass()?.displayName ?? "Class registration")
						: "Registration"}
			</h1>
			<p class="muted">
				{view() === "cart"
					? "Review your family's registrations before checkout."
					: view() === "class"
						? `${state.selectedChild()?.displayName ?? "Performer"} · ${state.selectedDivisionName()} · ${state.selectedTeacher()?.name ?? "Registered teacher"}`
						: "Choose a performer, then find their next class."}
			</p>
		</header>
	);
}

function RegistrationSignInFallback(props: {
	slug: string;
	festivalSlug: string;
	view: () => "workspace" | "class" | "cart";
}) {
	return (
		<section class="parent-panel">
			<h1>Registration</h1>
			<p>Sign in with your parent account to register your performers.</p>
			<Button
				type="button"
				onClick={() =>
					window.location.assign(
						customerFestivalRegistrationSignInPath(
							props.slug,
							props.festivalSlug,
							props.view() === "cart" ? "cart" : "register",
						),
					)
				}
			>
				{props.view() === "cart"
					? "Sign in to View Cart"
					: "Sign in to Register"}
			</Button>
		</section>
	);
}

export function FestivalClassRegistrationPage(
	props: FestivalClassRegistrationPageProps,
) {
	const customerIdentity = useCustomerIdentity();
	const state = useFestivalRegistrationPage(props);

	return (
		<Show
			when={!customerIdentity.isCustomerSessionLoading()}
			fallback={<p role="status">Checking your sign-in status…</p>}
		>
			<Show
				when={state.authenticated()}
				fallback={
					<RegistrationSignInFallback
						slug={props.slug}
						festivalSlug={props.festivalSlug}
						view={state.view}
					/>
				}
			>
				<RegistrationPageHeading state={state} />
				<Show when={state.view() === "cart"}>
					<FestivalRegistrationCartSection page={props} state={state} />
				</Show>
				<Show when={state.view() !== "cart"}>
					<Show when={state.purchased.error}>
						<p class="muted" role="status">
							Purchased registrations could not be loaded. Existing eligibility
							checks will still prevent duplicate registrations.
						</p>
					</Show>
					<Show when={state.options.childrenLoading()}>
						<p role="status">Loading performers…</p>
					</Show>
					<Show when={state.options.childrenError()}>
						<p class="field-error" role="alert">
							{state.options.childrenError()}
						</p>
						<Button
							type="button"
							variant="secondary"
							onClick={() => void state.loadChildren()}
						>
							Retry performers
						</Button>
					</Show>
					<Show when={state.view() === "workspace"}>
						<FestivalRegistrationWorkspaceView page={props} state={state} />
					</Show>
					<Show when={state.view() === "class" && !state.waitlistTarget()}>
						<FestivalRegistrationClassView page={props} state={state} />
					</Show>
				</Show>
				<FestivalRegistrationWaitlistPanel page={props} state={state} />
			</Show>
		</Show>
	);
}
