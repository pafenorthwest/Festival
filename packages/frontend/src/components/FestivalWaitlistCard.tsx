import type {
	CustomerWaitlistEntryDto,
	JoinWaitlistInput,
	WithdrawWaitlistInput,
} from "@festival/common";
import { createEffect, createSignal, Show } from "solid-js";
import { joinClassWaitlist, withdrawClassWaitlist } from "../lib/api.js";
import { Button } from "./Button.js";

export interface FestivalWaitlistCardProfile {
	name?: string;
	email?: string;
	phone?: string;
}

export interface FestivalWaitlistCardProps {
	isAuthenticated: boolean;
	childId: string;
	childName?: string;
	className?: string;
	festivalClassId?: string;
	classId?: string;
	orgSlug?: string;
	festivalSlug?: string;
	csrfToken?: string;
	profile?: FestivalWaitlistCardProfile | null;
	initialProfile?: FestivalWaitlistCardProfile | null;
	existingEntry?: CustomerWaitlistEntryDto | null;
	isSubmitting?: boolean;
	error?: string | null;
	successMessage?: string | null;
	onSignIn?: () => void;
	onSignInRequest?: () => void;
	onJoinWaitlist?: (input: JoinWaitlistInput) => void | Promise<void>;
	onWithdrawWaitlist?: (input: WithdrawWaitlistInput) => void | Promise<void>;
	onEntryChanged?: (
		entry?: CustomerWaitlistEntryDto | null,
	) => void | Promise<void>;
}

export function FestivalWaitlistCard(props: FestivalWaitlistCardProps) {
	const effectiveProfile = () => props.initialProfile ?? props.profile;
	const [name, setName] = createSignal(effectiveProfile()?.name ?? "");
	const [email, setEmail] = createSignal(effectiveProfile()?.email ?? "");
	const [phone, setPhone] = createSignal(effectiveProfile()?.phone ?? "");
	const [consent, setConsent] = createSignal(false);
	const [localError, setLocalError] = createSignal("");
	const [localSuccess, setLocalSuccess] = createSignal("");
	const [withdrawing, setWithdrawing] = createSignal(false);
	const [internalSubmitting, setInternalSubmitting] = createSignal(false);

	createEffect(() => {
		const p = effectiveProfile();
		if (p) {
			if (p.name && !name()) setName(p.name);
			if (p.email && !email()) setEmail(p.email);
			if (p.phone && !phone()) setPhone(p.phone);
		}
	});

	const targetClassId = () => props.classId ?? props.festivalClassId ?? "";

	createEffect(() => {
		void props.childId;
		void targetClassId();
		void props.existingEntry?.id;
		void props.existingEntry?.status;
		setLocalError("");
		setLocalSuccess("");
		setConsent(false);
	});

	const isJoined = () =>
		Boolean(props.existingEntry && props.existingEntry.status !== "withdrawn");
	const activeError = () => props.error || localError();
	const activeSuccess = () => props.successMessage || localSuccess();
	const isSubmitting = () => props.isSubmitting || internalSubmitting();
	const handleSignIn = () => {
		if (props.onSignInRequest) props.onSignInRequest();
		else if (props.onSignIn) props.onSignIn();
	};

	async function handleSubmit(event: Event) {
		event.preventDefault();
		setLocalError("");
		setLocalSuccess("");
		if (!consent()) {
			setLocalError(
				"Please consent to festival staff accessing your contact information.",
			);
			return;
		}
		const n = name().trim();
		const e = email().trim();
		const p = phone().trim();
		if (!n || !e || !p) {
			setLocalError("Please enter your name, email, and phone number.");
			return;
		}
		const input: JoinWaitlistInput = {
			childId: props.childId,
			festivalClassId: targetClassId(),
			parentName: n,
			parentEmail: e,
			parentPhone: p,
			staffAccessConsent: true,
		};
		setInternalSubmitting(true);
		try {
			if (props.onJoinWaitlist) {
				await props.onJoinWaitlist(input);
			} else if (props.orgSlug && props.festivalSlug && targetClassId()) {
				const res = await joinClassWaitlist(
					props.orgSlug,
					props.festivalSlug,
					targetClassId(),
					props.csrfToken ?? "",
					input,
				);
				if (props.onEntryChanged) {
					await props.onEntryChanged(res.entry);
				}
			}
			setLocalSuccess("You have been added to the waitlist.");
		} catch (err) {
			setLocalError(
				err instanceof Error
					? err.message
					: "Unable to join waitlist. Please try again.",
			);
		} finally {
			setInternalSubmitting(false);
		}
	}

	async function handleWithdraw() {
		setLocalError("");
		setLocalSuccess("");
		setWithdrawing(true);
		const input: WithdrawWaitlistInput = {
			waitlistEntryId: props.existingEntry?.id,
			childId: props.childId,
			festivalClassId: targetClassId(),
		};
		try {
			if (props.onWithdrawWaitlist) {
				await props.onWithdrawWaitlist(input);
			} else if (props.orgSlug && props.festivalSlug && targetClassId()) {
				await withdrawClassWaitlist(
					props.orgSlug,
					props.festivalSlug,
					targetClassId(),
					props.csrfToken ?? "",
					input,
				);
				if (props.onEntryChanged) {
					await props.onEntryChanged(null);
				}
			}
			setLocalSuccess("You have been withdrawn from the waitlist.");
		} catch (err) {
			setLocalError(
				err instanceof Error
					? err.message
					: "Unable to withdraw from waitlist. Please try again.",
			);
		} finally {
			setWithdrawing(false);
		}
	}

	return (
		<section
			class="panel flow-panel waitlist-card"
			aria-labelledby="waitlist-card-title"
		>
			<div class="waitlist-card-header">
				<span class="badge badge-warning" data-testid="waitlist-badge">
					Waitlist
				</span>
				<h3 id="waitlist-card-title">
					{props.className ? `${props.className} Waitlist` : "Class Waitlist"}
				</h3>
			</div>

			<p class="waitlist-explanation muted">
				Waitlist entry is free ($0). No payment or checkout is required. If a
				spot becomes available, festival staff will reach out to you directly.
			</p>

			<Show when={activeError()}>
				<p class="field-error" role="alert">
					{activeError()}
				</p>
			</Show>
			<Show when={activeSuccess()}>
				<p class="field-success" role="status">
					{activeSuccess()}
				</p>
			</Show>

			<Show
				when={props.isAuthenticated}
				fallback={
					<div class="waitlist-unauthenticated flow-panel">
						<p>Please sign in to join the waitlist for this class.</p>
						<Show when={props.onSignIn || props.onSignInRequest}>
							<Button type="button" onClick={handleSignIn}>
								Sign in to join waitlist
							</Button>
						</Show>
					</div>
				}
			>
				<Show
					when={!isJoined()}
					fallback={
						<div class="waitlist-joined flow-panel">
							<p>You are currently on the waitlist for this class.</p>
							<Show when={props.existingEntry?.joinedAt}>
								<p class="muted">
									Joined on:{" "}
									{props.existingEntry?.joinedAt
										? new Date(props.existingEntry.joinedAt).toLocaleString()
										: ""}
								</p>
							</Show>
							<div class="waitlist-actions">
								<Button
									type="button"
									variant="secondary"
									disabled={isSubmitting() || withdrawing()}
									onClick={handleWithdraw}
								>
									{withdrawing() ? "Withdrawing…" : "Withdraw from waitlist"}
								</Button>
							</div>
						</div>
					}
				>
					<form class="flow-panel" onSubmit={handleSubmit}>
						<label class="field">
							<span>Parent / Guardian Name</span>
							<input
								type="text"
								required
								value={name()}
								onInput={(e) => setName(e.currentTarget.value)}
								placeholder="Full name"
							/>
						</label>
						<label class="field">
							<span>Email Address</span>
							<input
								type="email"
								required
								value={email()}
								onInput={(e) => setEmail(e.currentTarget.value)}
								placeholder="name@example.com"
							/>
						</label>
						<label class="field">
							<span>Phone Number</span>
							<input
								type="tel"
								required
								value={phone()}
								onInput={(e) => setPhone(e.currentTarget.value)}
								placeholder="e.g. 555-123-4567"
							/>
						</label>
						<label
							class="checkbox-label"
							style="display: flex; gap: 0.5rem; align-items: flex-start; cursor: pointer;"
						>
							<input
								type="checkbox"
								required
								checked={consent()}
								onChange={(e) => setConsent(e.currentTarget.checked)}
							/>
							<span>
								I consent to festival staff accessing my contact information
								regarding waitlist placement.
							</span>
						</label>
						<div class="waitlist-actions" style="margin-top: 1rem;">
							<Button type="submit" disabled={isSubmitting() || !consent()}>
								{isSubmitting() ? "Joining waitlist…" : "Join waitlist ($0)"}
							</Button>
						</div>
					</form>
				</Show>
			</Show>
		</section>
	);
}
