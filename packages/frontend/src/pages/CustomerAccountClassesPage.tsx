import { createSignal, For, Show } from "solid-js";
import type { CustomerClassRegistrationItem } from "../lib/api.js";
import { listCustomerClassRegistrations } from "../lib/api.js";
import { CustomerAccountPageLayout } from "./CustomerAccountPageLayout.js";

function formatPaidAt(paidAtIso: string | null): string {
	if (!paidAtIso) return "Payment not yet confirmed";
	return new Date(paidAtIso).toLocaleString(undefined, {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		timeZoneName: "short",
	});
}

export function CustomerAccountClassesPage(props: { slug: string }) {
	const [registrations, setRegistrations] = createSignal<
		CustomerClassRegistrationItem[]
	>([]);
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal("");

	async function loadClasses() {
		setLoading(true);
		setError("");
		try {
			const response = await listCustomerClassRegistrations(props.slug);
			setRegistrations(response.registrations);
		} catch {
			setError("Purchased classes could not be loaded. Please try again.");
		} finally {
			setLoading(false);
		}
	}

	return (
		<CustomerAccountPageLayout
			slug={props.slug}
			onAuthenticated={() => void loadClasses()}
		>
			{() => (
				<>
					<h1>Classes</h1>
					<section aria-labelledby="purchased-classes-heading">
						<h2 id="purchased-classes-heading">Purchased classes</h2>
						<p class="muted">
							Classes your family has purchased, with the confirmed payment date
							and time.
						</p>
						<Show when={loading()}>
							<p role="status">Loading your purchased classes…</p>
						</Show>
						<Show when={error()}>
							{(message) => (
								<p class="error-text" role="alert">
									{message()}
								</p>
							)}
						</Show>
						<Show when={!loading() && !error() && registrations().length === 0}>
							<p>No purchased classes found.</p>
						</Show>
						<Show when={registrations().length > 0}>
							<div class="customer-classes-grid" aria-live="polite">
								<For each={registrations()}>
									{(registration) => (
										<article class="customer-class-card">
											<h3>
												{registration.festivalClass?.displayName ??
													"Festival Class"}
											</h3>
											<p>
												Performer:{" "}
												<strong>
													{registration.child?.name ?? "Performer"}
												</strong>
											</p>
											<p class="customer-class-card-paid-at">
												{formatPaidAt(registration.paidAtIso)}
											</p>
										</article>
									)}
								</For>
							</div>
						</Show>
					</section>
				</>
			)}
		</CustomerAccountPageLayout>
	);
}
