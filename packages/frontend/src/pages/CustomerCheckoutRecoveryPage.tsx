import { createEffect, createSignal, onMount, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { Button } from "../components/Button.js";
import {
	customerCheckoutRecoverySignInPath,
	getCustomerCheckoutRecoveryReview,
	getCustomerSession,
	type RecoveryReviewDto,
	resumeCustomerCheckoutRecovery,
} from "../lib/api.js";

interface CustomerCheckoutRecoveryPageProps {
	app: FestivalAppController;
}

function resolveErrorMessage(err: unknown): string {
	if (err instanceof Error) {
		const msg = err.message.toLowerCase();
		if (
			msg.includes("expired") ||
			(err as { status?: number }).status === 410
		) {
			return "This recovery link has expired. Please contact the organization to request a new recovery link.";
		}
		if (
			msg.includes("already been used") ||
			msg.includes("consumed") ||
			(err as { status?: number }).status === 409
		) {
			return "This recovery link has already been used to resume checkout.";
		}
		if (msg.includes("invalidated")) {
			return "This checkout recovery request is no longer valid.";
		}
		return err.message;
	}
	return "An unexpected error occurred while loading your recovery review.";
}

export function CustomerCheckoutRecoveryPage(
	props: CustomerCheckoutRecoveryPageProps,
) {
	const [review, setReview] = createSignal<RecoveryReviewDto | null>(null);
	const [isLoading, setIsLoading] = createSignal(false);
	const [loadError, setLoadError] = createSignal<string | null>(null);
	const [isResuming, setIsResuming] = createSignal(false);
	const [resumeError, setResumeError] = createSignal<string | null>(null);

	const route = () => props.app.route();
	const slug = () => {
		const r = route();
		return "slug" in r && typeof r.slug === "string" ? r.slug : "";
	};
	const token = () => {
		const r = route();
		return "token" in r && typeof r.token === "string" ? r.token : "";
	};

	onMount(async () => {
		if (!props.app.customerSession().authenticated && slug()) {
			try {
				const sessionRes = await getCustomerSession(slug());
				if (sessionRes.session?.authenticated) {
					props.app.setCustomerSession(sessionRes.session);
				}
			} catch {
				// unauthenticated handled by fallback
			}
		}
	});

	async function loadReview() {
		const s = slug();
		const t = token();
		if (!s || !t) return;
		setIsLoading(true);
		setLoadError(null);
		try {
			const res = await getCustomerCheckoutRecoveryReview(s, t);
			setReview(res);
		} catch (err) {
			setLoadError(resolveErrorMessage(err));
		} finally {
			setIsLoading(false);
		}
	}

	createEffect(() => {
		if (props.app.customerSession().authenticated && slug() && token()) {
			void loadReview();
		}
	});

	async function handleResumePurchase() {
		const s = slug();
		const t = token();
		const session = props.app.customerSession();
		const csrf = session.authenticated ? session.csrfToken : "";
		if (!s || !t) return;

		setIsResuming(true);
		setResumeError(null);
		try {
			const res = await resumeCustomerCheckoutRecovery(s, t, csrf);
			if (res.checkoutUrl) {
				window.location.assign(res.checkoutUrl);
			} else {
				throw new Error("Missing checkout URL from recovery response.");
			}
		} catch (err) {
			setResumeError(resolveErrorMessage(err));
			setIsResuming(false);
		}
	}

	const isRecoveryActive = () => {
		const r = review();
		if (!r) return false;
		return r.recoveryRequest.status === "pending";
	};

	const statusNotice = () => {
		const r = review();
		if (!r) return null;
		if (r.recoveryRequest.status === "expired") {
			return "This recovery link has expired. Please contact the organization to request a new recovery link.";
		}
		if (r.recoveryRequest.status === "consumed") {
			return "This recovery link has already been used to resume checkout.";
		}
		if (r.recoveryRequest.status === "invalidated") {
			return "This recovery link has been invalidated.";
		}
		return null;
	};

	return (
		<Show
			when={!props.app.isCustomerSessionLoading()}
			fallback={
				<section class="panel flow-panel" aria-busy="true">
					<p role="status">Checking your sign-in status…</p>
				</section>
			}
		>
			<Show
				when={props.app.customerSession().authenticated}
				fallback={
					<section class="panel flow-panel customer-recovery-gate">
						<header class="admin-page-header">
							<div>
								<h2>Resume Your Purchase</h2>
								<p>
									Sign in to your customer account to continue where you left
									off.
								</p>
							</div>
						</header>
						<div class="auth-gate-actions">
							<a
								class="button button-primary"
								href={customerCheckoutRecoverySignInPath(slug(), token())}
							>
								Sign in to Resume Purchase
							</a>
						</div>
					</section>
				}
			>
				<section class="panel flow-panel customer-recovery-container">
					<header class="admin-page-header">
						<div>
							<h2>Checkout Recovery</h2>
							<p>Review your item details and complete your registration.</p>
						</div>
					</header>

					<Show when={isLoading()}>
						<p>Loading recovery details…</p>
					</Show>

					<Show when={loadError()}>
						<div class="alert alert-error" role="alert">
							<p>{loadError()}</p>
						</div>
					</Show>

					<Show when={statusNotice()}>
						<div class="alert alert-error" role="alert">
							<p>{statusNotice()}</p>
						</div>
					</Show>

					<Show when={resumeError()}>
						<div class="alert alert-error" role="alert">
							<p>{resumeError()}</p>
						</div>
					</Show>

					<Show when={review() && isRecoveryActive()}>
						<div class="recovery-interrupted-notice">
							<strong>Earlier Interrupted Checkout</strong>
							<p>
								Your previous checkout was interrupted before completion. You
								can resume and finalize your purchase below.
							</p>
						</div>

						<div class="recovery-summary-card panel">
							<h3>Purchase Summary</h3>
							<dl class="summary-details">
								<dt>Item / Offering</dt>
								<dd>
									{review()?.offering?.name ??
										(review()?.sourceIntent.intentType === "membership"
											? "Membership"
											: "Festival Class Registration")}
								</dd>

								<dt>Division</dt>
								<dd>
									{review()?.division?.displayName ??
										review()?.sourceIntent.divisionNameSnapshot ??
										"General"}
								</dd>

								<dt>Price</dt>
								<dd>
									{review()?.offering?.price?.amount ??
										review()?.sourceIntent.amount}{" "}
									{review()?.offering?.price?.currencyCode ??
										review()?.sourceIntent.currencyCode}
								</dd>
							</dl>

							<div class="recovery-actions">
								<Button
									type="button"
									class="button-primary"
									disabled={isResuming()}
									onClick={handleResumePurchase}
								>
									{isResuming()
										? "Redirecting to Checkout…"
										: "Resume Purchase"}
								</Button>
							</div>
						</div>
					</Show>
				</section>
			</Show>
		</Show>
	);
}
