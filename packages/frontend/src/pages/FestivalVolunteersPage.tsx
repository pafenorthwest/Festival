import {
	createEffect,
	createMemo,
	createResource,
	createSignal,
	onCleanup,
	Show,
} from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { Button } from "../components/Button.js";
import { VolunteerAvailableShiftsSection } from "../components/VolunteerAvailableShiftsSection.js";
import { VolunteerEnrollmentForm } from "../components/VolunteerEnrollmentForm.js";
import { VolunteerMyShiftsSection } from "../components/VolunteerMyShiftsSection.js";
import {
	ApiError,
	bookVolunteerShifts,
	cancelVolunteerAssignment,
	enrollVolunteer,
	getMyVolunteerSchedule,
	getPublicFestival,
	listVolunteerShifts,
	type VolunteerRole,
	type VolunteerShiftListing,
} from "../lib/api.js";
import { subscribeToAuthChanges } from "../lib/firebase-auth.js";

interface FestivalVolunteersPageProps {
	app: FestivalAppController;
	slug: string;
	festivalSlug: string;
}

export function FestivalVolunteersPage(props: FestivalVolunteersPageProps) {
	const [festival] = createResource(
		() => [props.slug, props.festivalSlug] as const,
		([slug, festivalSlug]) => getPublicFestival(slug, festivalSlug),
	);

	const [idToken, setIdToken] = createSignal<string | null>(null);
	const unsubscribe = subscribeToAuthChanges(async (user) => {
		setIdToken(user ? await user.getIdToken() : null);
	});
	onCleanup(unsubscribe);

	const [isEnrolled, setIsEnrolled] = createSignal(false);
	const [enrollmentError, setEnrollmentError] = createSignal<string | null>(
		null,
	);
	const [isEnrolling, setIsEnrolling] = createSignal(false);
	const [successMessage, setSuccessMessage] = createSignal<string | null>(null);
	const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
	const [selectedShiftIds, setSelectedShiftIds] = createSignal<string[]>([]);
	const [isBooking, setIsBooking] = createSignal(false);
	const [cancelingId, setCancelingId] = createSignal<string | null>(null);

	const enrollmentStorageKey = () => {
		const u = props.app.firebaseUser();
		return u
			? `volunteer_enrolled_${props.slug}_${props.festivalSlug}_${u.uid}`
			: null;
	};

	const [schedule, { refetch: refetchSchedule }] = createResource(
		() => {
			const token = idToken();
			return token
				? ([props.slug, props.festivalSlug, token] as const)
				: undefined;
		},
		([slug, festivalSlug, token]) =>
			getMyVolunteerSchedule(slug, festivalSlug, token),
	);

	const [availableShifts, { refetch: refetchAvailableShifts }] = createResource(
		() => {
			const token = idToken();
			return token
				? ([props.slug, props.festivalSlug, token] as const)
				: undefined;
		},
		([slug, festivalSlug, token]) =>
			listVolunteerShifts(slug, festivalSlug, {
				availableOnly: true,
				idToken: token,
			}),
	);

	createEffect(() => {
		const key = enrollmentStorageKey();
		if (key && localStorage.getItem(key) === "true") {
			setIsEnrolled(true);
			return;
		}
		const sched = schedule();
		if (sched && sched.length > 0) {
			setIsEnrolled(true);
			if (key) localStorage.setItem(key, "true");
		}
	});

	const shiftsByRole = createMemo(() => {
		const list = availableShifts() ?? [];
		const map = new Map<
			string,
			{ role: VolunteerRole; shifts: VolunteerShiftListing[] }
		>();
		for (const item of list) {
			if (!item.available) continue;
			const roleId = item.roleId;
			if (!map.has(roleId)) {
				map.set(roleId, { role: item.role, shifts: [] });
			}
			map.get(roleId)?.shifts.push(item);
		}
		return Array.from(map.values());
	});

	function toggleShiftSelection(shiftId: string) {
		setSelectedShiftIds((current) =>
			current.includes(shiftId)
				? current.filter((id) => id !== shiftId)
				: [...current, shiftId],
		);
	}

	async function handleEnroll(data: { name: string; phone: string }) {
		const token = idToken();
		if (!token) return;
		setEnrollmentError(null);
		setIsEnrolling(true);
		try {
			await enrollVolunteer(props.slug, props.festivalSlug, data, token);
			setIsEnrolled(true);
			const key = enrollmentStorageKey();
			if (key) localStorage.setItem(key, "true");
			setSuccessMessage(
				"Enrolled successfully! You can now choose your shifts below.",
			);
			await Promise.all([refetchSchedule(), refetchAvailableShifts()]);
		} catch (error) {
			setEnrollmentError(
				error instanceof Error ? error.message : "Failed to enroll.",
			);
		} finally {
			setIsEnrolling(false);
		}
	}

	async function handleCancelShift(assignmentId: string) {
		const token = idToken();
		if (!token) return;
		setErrorMessage(null);
		setSuccessMessage(null);
		setCancelingId(assignmentId);
		try {
			await cancelVolunteerAssignment(
				props.slug,
				props.festivalSlug,
				assignmentId,
				token,
			);
			setSuccessMessage("Shift cancelled successfully.");
			await Promise.all([refetchSchedule(), refetchAvailableShifts()]);
		} catch (error) {
			setErrorMessage(
				error instanceof Error ? error.message : "Failed to cancel shift.",
			);
		} finally {
			setCancelingId(null);
		}
	}

	async function handleBookShifts() {
		const token = idToken();
		const ids = selectedShiftIds();
		if (!token || ids.length === 0) return;
		setErrorMessage(null);
		setSuccessMessage(null);
		setIsBooking(true);
		try {
			const outcome = await bookVolunteerShifts(
				props.slug,
				props.festivalSlug,
				ids,
				token,
			);
			if (outcome.kind === "booked") {
				setSelectedShiftIds([]);
				setSuccessMessage(
					`Successfully signed up for ${outcome.assignments.length} shift(s)!`,
				);
				await Promise.all([refetchSchedule(), refetchAvailableShifts()]);
			} else {
				setErrorMessage(
					"Shift booking conflict: Selected shifts conflict with your schedule or another shift selected.",
				);
			}
		} catch (error) {
			if (error instanceof ApiError && error.status === 409) {
				setErrorMessage(
					"Shift booking conflict: One or more selected shifts conflict with your schedule or are already filled.",
				);
			} else if (error instanceof ApiError && error.status === 404) {
				setIsEnrolled(false);
				setErrorMessage(
					"Volunteer enrollment not found. Please complete enrollment first.",
				);
			} else {
				setErrorMessage(
					error instanceof Error
						? error.message
						: "Failed to sign up for shifts.",
				);
			}
		} finally {
			setIsBooking(false);
		}
	}

	return (
		<>
			<Show when={festival.state === "pending"}>
				<section class="org-landing">
					<p class="muted">Loading festival.</p>
				</section>
			</Show>
			<Show when={festival.state === "errored"}>
				<section class="org-landing">
					<p role="alert">Festival not found.</p>
				</section>
			</Show>
			<Show when={festival.state === "ready" && festival()}>
				<section class="org-landing">
					<h2>Volunteer for {festival()?.festival.name}</h2>
					<Show
						when={props.app.firebaseUser()}
						fallback={
							<>
								<p>Sign in to choose volunteer roles and shifts.</p>
								<Button
									type="button"
									onClick={() => props.app.openSignInModal("volunteer")}
								>
									Sign in to volunteer
								</Button>
							</>
						}
					>
						{(user) => (
							<div class="flow-panel">
								<div class="welcome-box">
									<p>Signed in as {user().email}.</p>
									<Button
										type="button"
										variant="secondary"
										onClick={props.app.handleLogout}
										disabled={props.app.isBusy()}
									>
										Sign out
									</Button>
								</div>

								<Show when={successMessage()}>
									<section class="banner success-banner">
										{successMessage()}
									</section>
								</Show>
								<Show when={errorMessage()}>
									<section class="banner error-banner">
										{errorMessage()}
									</section>
								</Show>

								<Show
									when={isEnrolled()}
									fallback={
										<VolunteerEnrollmentForm
											userEmail={user().email ?? ""}
											onEnroll={handleEnroll}
											isEnrolling={isEnrolling()}
											error={enrollmentError()}
										/>
									}
								>
									<VolunteerMyShiftsSection
										schedule={schedule()}
										loading={schedule.loading}
										onCancelShift={handleCancelShift}
										cancelingId={cancelingId()}
									/>
									<VolunteerAvailableShiftsSection
										shiftsByRole={shiftsByRole()}
										loading={availableShifts.loading}
										selectedShiftIds={selectedShiftIds()}
										onToggleShift={toggleShiftSelection}
										onBookShifts={handleBookShifts}
										isBooking={isBooking()}
									/>
								</Show>
							</div>
						)}
					</Show>
				</section>
			</Show>
		</>
	);
}
