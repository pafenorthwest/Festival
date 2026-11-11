import {
	type CustomerClassRegistrationItem,
	doesClassRequireConcerto,
	type FestivalSummary,
	type RepertoirePiece,
} from "@festival/common";
import { useBeforeLeave } from "@solidjs/router";
import {
	createResource,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { Button } from "../components/Button.js";
import { FestivalPieceEditor } from "../components/FestivalPieceEditor.js";
import {
	listRegistrationAccompanists,
	updateRegistrationMetadata,
} from "../lib/api.js";
import { useConcertoCatalogSearch } from "./festivalRegistrationHooks.js";
import {
	canEditPurchasedRegistration,
	formatPurchasedCutoff,
	KEEP_CURRENT_ACCOMPANIST,
	purchasedRegistrationReadOnlyReason,
	purchasedRegistrationUpdate,
	validatePurchasedRegistrationPieces,
} from "./PurchasedRegistrationHelpers.js";

export function PurchasedRegistrationEditor(props: {
	slug: string;
	registration: CustomerClassRegistrationItem;
	festival?: FestivalSummary;
	divisionName: string;
	csrfToken: string;
	onClose: () => void;
	onSaved: () => Promise<void>;
	onRefresh: () => Promise<void>;
}) {
	const initialPieces = props.registration.metadata?.repertoireJson ?? [];
	const [pieces, setPieces] = createSignal<RepertoirePiece[]>(
		initialPieces.map((piece) => ({ ...piece })),
	);
	const initialAccompanist = props.registration.metadata
		?.accompanistMembershipId
		? KEEP_CURRENT_ACCOMPANIST
		: "";
	const [accompanist, setAccompanist] = createSignal(initialAccompanist);
	const [unsavedPiece, setUnsavedPiece] = createSignal(false);
	const [saving, setSaving] = createSignal(false);
	const [error, setError] = createSignal("");
	const [now, setNow] = createSignal(Date.now());
	const [saved, setSaved] = createSignal(false);
	const [catalogRequested, setCatalogRequested] = createSignal(false);
	let allowSignOut = false;
	const canEdit = () =>
		Boolean(props.festival) &&
		canEditPurchasedRegistration(props.registration, now());
	const dirty = () =>
		!saved() &&
		(unsavedPiece() ||
			JSON.stringify(pieces()) !== JSON.stringify(initialPieces) ||
			accompanist() !== initialAccompanist);
	const requiresConcerto = () =>
		doesClassRequireConcerto(props.registration.festivalClass);
	const showCatalog = () =>
		requiresConcerto() ||
		initialPieces.some((piece) => Boolean(piece.catalogWorkId)) ||
		catalogRequested();
	const catalog = useConcertoCatalogSearch(
		() => props.slug,
		() => props.festival?.shortName ?? "",
		() => canEdit() && showCatalog(),
	);
	const [accompanistOptions] = createResource(
		() => (canEdit() ? props.festival?.shortName : undefined),
		async (festivalSlug) => {
			try {
				const response = await listRegistrationAccompanists(
					props.slug,
					festivalSlug,
				);
				return { options: response.accompanists, error: "" };
			} catch {
				return {
					options: [],
					error:
						"Accompanist choices could not be loaded. Keep the current selection or try again later.",
				};
			}
		},
	);

	function confirmLeave() {
		return !dirty() || window.confirm("Discard changes to this registration?");
	}
	useBeforeLeave((event) => {
		if (saving()) {
			event.preventDefault();
			setError("Please wait for your registration changes to finish saving.");
			return;
		}
		if (!confirmLeave()) event.preventDefault();
	});
	onMount(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		const beforeUnload = (event: BeforeUnloadEvent) => {
			if (allowSignOut) {
				allowSignOut = false;
				return;
			}
			if (!dirty() && !saving()) return;
			event.preventDefault();
			event.returnValue = "";
		};
		const requestSignOut = (event: Event) => {
			if (event.defaultPrevented) return;
			if (saving()) {
				event.preventDefault();
				setError(
					"Please wait for your registration changes to finish saving before signing out.",
				);
				return;
			}
			if (!confirmLeave()) {
				event.preventDefault();
				return;
			}
			allowSignOut = true;
		};
		window.addEventListener("beforeunload", beforeUnload);
		window.addEventListener("festival:request-sign-out", requestSignOut);
		onCleanup(() => {
			window.clearInterval(timer);
			window.removeEventListener("beforeunload", beforeUnload);
			window.removeEventListener("festival:request-sign-out", requestSignOut);
		});
	});

	async function save() {
		setError("");
		setNow(Date.now());
		if (!canEdit() || !props.festival || !props.registration.festivalClass) {
			setError("Editing is no longer available for this registration.");
			return;
		}
		if (unsavedPiece()) {
			setError(
				"Save or discard the piece you are editing before saving changes.",
			);
			return;
		}
		const pieceError = validatePurchasedRegistrationPieces(
			pieces(),
			props.registration.festivalClass,
		);
		if (pieceError) {
			setError(pieceError);
			return;
		}
		setSaving(true);
		try {
			await updateRegistrationMetadata(
				props.slug,
				props.festival.shortName,
				props.registration.entitlement.id,
				props.csrfToken,
				purchasedRegistrationUpdate(pieces(), accompanist()),
			);
			setSaved(true);
			await props.onSaved();
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Changes could not be saved. Please try again.",
			);
			try {
				await props.onRefresh();
			} catch {
				// Preserve the original save error and draft if a status refresh also fails.
			}
		} finally {
			setSaving(false);
		}
	}

	return (
		<div class="purchased-registration-editor">
			<Button
				type="button"
				variant="secondary"
				onClick={() => {
					if (confirmLeave()) props.onClose();
				}}
				disabled={saving()}
			>
				← My Registrations
			</Button>
			<header class="parent-page-heading">
				<p class="eyebrow">Purchased registration</p>
				<h1>Repertoire &amp; accompanist</h1>
				<p class="muted">Update the performance details for this class.</p>
			</header>
			<Show
				when={canEdit()}
				fallback={
					<p class="parent-note" role="status">
						{purchasedRegistrationReadOnlyReason(props.registration, now())}
					</p>
				}
			>
				<p class="parent-note">
					Editing closes{" "}
					{formatPurchasedCutoff(props.registration.metadataEditCutoffIso)}.
					Your performer, class, division, and teacher stay fixed.
				</p>
			</Show>
			<div class="parent-content-grid">
				<div class="flow-panel">
					<Show when={canEdit() && !showCatalog()}>
						<Button
							type="button"
							variant="secondary"
							onClick={() => setCatalogRequested(true)}
						>
							Choose a catalog work
						</Button>
					</Show>
					<FestivalPieceEditor
						pieces={pieces()}
						onChange={setPieces}
						maxPieces={
							props.registration.festivalClass?.maximumPerformancePieces ?? 1
						}
						performanceMinutes={
							props.registration.festivalClass?.performanceMinutes ?? 0
						}
						requiresConcerto={requiresConcerto()}
						showCatalog={showCatalog()}
						catalogSearch={catalog}
						catalogWorks={catalog.catalogWorks()}
						onDirtyChange={(value) =>
							setUnsavedPiece((current) => value || (!canEdit() && current))
						}
						readOnly={!canEdit() || saving()}
						idPrefix="purchased-repertoire"
						initialIndex={0}
					/>
					<section class="panel flow-panel">
						<h2>Accompanist</h2>
						<label class="field" for="purchased-accompanist">
							<span>Registered accompanist</span>
							<select
								id="purchased-accompanist"
								value={accompanist()}
								onChange={(event) => setAccompanist(event.currentTarget.value)}
								disabled={!canEdit() || saving() || accompanistOptions.loading}
							>
								<Show when={initialAccompanist === KEEP_CURRENT_ACCOMPANIST}>
									<option value={KEEP_CURRENT_ACCOMPANIST}>
										Keep current accompanist
									</option>
								</Show>
								<option value="">Not required</option>
								<For each={accompanistOptions()?.options ?? []}>
									{(option) => <option value={option.id}>{option.name}</option>}
								</For>
							</select>
						</label>
						<Show when={accompanistOptions()?.error}>
							<p class="muted" role="status">
								{accompanistOptions()?.error}
							</p>
						</Show>
						<p class="muted">
							Choose an active registered accompanist when needed.
						</p>
					</section>
					<Show when={error()}>
						<p class="error-text" role="alert">
							{error()}
						</p>
					</Show>
					<Show when={canEdit() && unsavedPiece()}>
						<p class="muted">
							Save or discard the current piece before saving registration
							changes.
						</p>
					</Show>
					<Show when={canEdit()}>
						<div class="division-actions">
							<Button
								type="button"
								onClick={() => void save()}
								disabled={saving() || unsavedPiece()}
							>
								{saving() ? "Saving…" : "Save Changes"}
							</Button>
							<Button
								type="button"
								variant="secondary"
								disabled={saving()}
								onClick={() => {
									if (confirmLeave()) props.onClose();
								}}
							>
								Cancel
							</Button>
						</div>
					</Show>
				</div>
				<aside class="parent-side-summary panel flow-panel">
					<p class="eyebrow">Registration details</p>
					<h2>
						{props.registration.child?.name ?? "Performer name unavailable"}
					</h2>
					<dl class="summary-grid">
						<dt>Festival</dt>
						<dd>{props.festival?.name ?? "Festival details unavailable"}</dd>
						<dt>Class</dt>
						<dd>
							{props.registration.festivalClass?.displayName ??
								"Festival Class"}
						</dd>
						<dt>Division</dt>
						<dd>{props.divisionName}</dd>
						<dt>Age group</dt>
						<dd>
							{props.registration.festivalClass
								? `${props.registration.festivalClass.minimumAge}–${props.registration.festivalClass.maximumAge}`
								: "Unavailable"}
						</dd>
						<dt>Teacher</dt>
						<dd>
							{props.registration.metadata?.teacherName ??
								"Historical name unavailable"}
						</dd>
					</dl>
					<p class="muted">
						These registration details cannot be changed here.
					</p>
				</aside>
			</div>
		</div>
	);
}
