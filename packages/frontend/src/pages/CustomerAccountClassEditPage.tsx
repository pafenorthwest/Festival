import type {
	CustomerClassRegistrationItem,
	FestivalSummary,
	OrganizationDivision,
	RegistrationAccompanistSummary,
	RegistrationTeacherSummary,
	RepertoirePiece,
} from "@festival/common";
import { deriveFestivalMetadataCutoff } from "@festival/common";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
	getPublicDivisions,
	getPublicOrganizationLanding,
	listCustomerClassRegistrations,
	listRegistrationAccompanists,
	listRegistrationTeachers,
	updateRegistrationMetadata,
} from "../lib/api.js";
import {
	buildOrgCustomerAccountClassesPath,
} from "../lib/routes.js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import {
	formatCutoffFull,
	formatPieceTime,
	mapRepertoireToDrafts,
	type PieceDraft,
} from "./customerAccountClassEditHelpers.js";
import { CustomerAccountPageLayout } from "./CustomerAccountPageLayout.js";

export function CustomerAccountClassEditPage(props: {
	slug: string;
	registrationId: string;
	app?: FestivalAppController;
}) {
	const [reg, setReg] = createSignal<CustomerClassRegistrationItem | null>(null);
	const [fest, setFest] = createSignal<FestivalSummary | null>(null);
	const [div, setDiv] = createSignal<OrganizationDivision | null>(null);
	const [teachers, setTeachers] = createSignal<RegistrationTeacherSummary[]>([]);
	const [accompanists, setAccompanists] = createSignal<RegistrationAccompanistSummary[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal("");
	const [saving, setSaving] = createSignal(false);
	const [saveSuccess, setSaveSuccess] = createSignal(false);
	const [isDirty, setIsDirty] = createSignal(false);
	const [pieces, setPieces] = createSignal<PieceDraft[]>([]);
	const [accompanistId, setAccompanistId] = createSignal("");

	const cutoff = () => {
		const f = fest();
		if (!f?.startDate) return null;
		try {
			return deriveFestivalMetadataCutoff(
				f.startDate,
				props.app?.organization()?.timezone || "America/Los_Angeles",
			);
		} catch {
			return null;
		}
	};
	const isClosed = () => {
		const c = cutoff();
		return c ? Date.now() >= c.getTime() : false;
	};

	async function load() {
		setLoading(true);
		setError("");
		try {
			const [rRes, lRes, dRes] = await Promise.all([
				listCustomerClassRegistrations(props.slug),
				getPublicOrganizationLanding(props.slug).catch(() => ({ festivals: [] as FestivalSummary[] })),
				getPublicDivisions(props.slug).catch(() => ({ divisions: [] as OrganizationDivision[] })),
			]);
			const match = rRes.registrations.find(
				(r) =>
					r.entitlement.id === props.registrationId ||
					r.metadata?.id === props.registrationId,
			);
			if (!match) return setError("Registration not found.");
			setReg(match);

			const f = lRes.festivals.find((x) => x.id === match.entitlement.festivalId) ?? null;
			setFest(f);
			setDiv(dRes.divisions.find((d) => d.id === match.festivalClass?.divisionId) ?? null);
			setPieces(mapRepertoireToDrafts(match.metadata?.repertoireJson ?? []));
			setAccompanistId(match.metadata?.accompanistMembershipId ?? "");

			if (f?.shortName) {
				const [accRes, tRes] = await Promise.all([
					listRegistrationAccompanists(props.slug, f.shortName).catch(() => ({ accompanists: [] })),
					listRegistrationTeachers(props.slug, f.shortName, {
						childId: match.child?.id,
						divisionId: match.festivalClass?.divisionId,
					}).catch(() => ({ teachers: [] })),
				]);
				setAccompanists(accRes.accompanists ?? []);
				setTeachers(tRes.teachers ?? []);
			}
		} catch {
			setError("Failed to load registration details.");
		} finally {
			setLoading(false);
		}
	}

	onMount(() => {
		const onUnload = (e: BeforeUnloadEvent) => {
			if (isDirty()) {
				e.preventDefault();
				e.returnValue = "";
			}
		};
		window.addEventListener("beforeunload", onUnload);
		onCleanup(() => window.removeEventListener("beforeunload", onUnload));
	});

	function handleBack(e: MouseEvent) {
		if (isDirty() && !window.confirm("You have unsaved changes. Discard changes?")) {
			e.preventDefault();
		}
	}

	function updatePiece(i: number, f: keyof PieceDraft, v: string | number) {
		setPieces((prev) => {
			const n = [...prev];
			const target = n[i];
			if (target) n[i] = { ...target, [f]: v };
			return n;
		});
		setIsDirty(true);
		setSaveSuccess(false);
	}

	function addPiece() {
		const max = reg()?.festivalClass?.maximumPerformancePieces ?? 2;
		if (pieces().length >= max) return;
		setPieces((prev) => [
			...prev,
			{ title: "", composer: "", movement: "", minutes: 0, seconds: 0 },
		]);
		setIsDirty(true);
		setSaveSuccess(false);
	}

	const isValidPiece = (p: PieceDraft) =>
		Boolean(p.title.trim() && p.composer.trim()) &&
		p.minutes >= 0 &&
		Number.isInteger(p.minutes) &&
		p.seconds >= 0 &&
		p.seconds < 60 &&
		Number.isInteger(p.seconds) &&
		(p.minutes * 60 + p.seconds) > 0;

	async function save(csrfToken: string) {
		const r = reg();
		if (!r) return;
		setError("");
		setSaveSuccess(false);

		const validPieces = pieces().filter(isValidPiece);
		if (validPieces.length === 0) {
			setError("At least one valid repertoire piece is required.");
			return;
		}
		if (pieces().some((p) => (p.title.trim() || p.composer.trim()) && !isValidPiece(p))) {
			setError("Each piece must have a title, composer, and valid duration.");
			return;
		}

		setSaving(true);
		const pList: RepertoirePiece[] = validPieces.map((p) => ({
			title: p.title.trim(),
			composer: p.composer.trim(),
			movement: p.movement.trim() || null,
			durationSeconds: p.minutes * 60 + p.seconds,
			durationMinutes: p.minutes,
		}));

		try {
			const res = await updateRegistrationMetadata(
				props.slug,
				fest()?.shortName ?? "",
				r.entitlement.id,
				csrfToken,
				{ pieces: pList, accompanistId: accompanistId() || null },
			);
			const savedPieces = res?.metadata?.repertoireJson ?? pList;
			const savedAccompanist =
				res?.metadata?.accompanistMembershipId !== undefined
					? res.metadata.accompanistMembershipId
					: accompanistId() || null;

			setReg((prev) =>
				prev?.metadata
					? {
							...prev,
							metadata: {
								...prev.metadata,
								accompanistMembershipId: savedAccompanist,
								repertoireJson: savedPieces,
							},
						}
					: prev,
			);
			setPieces(mapRepertoireToDrafts(savedPieces));
			setAccompanistId(savedAccompanist ?? "");
			setIsDirty(false);
			setSaveSuccess(true);
		} catch (err) {
			setError((err as Error).message || "Failed to save registration.");
		} finally {
			setSaving(false);
		}
	}

	const teacherName = () => {
		const tid = reg()?.metadata?.teacherMembershipId;
		return teachers().find((t) => t.id === tid)?.name ?? "Historical name unavailable";
	};
	const ageRange = () => {
		const fc = reg()?.festivalClass;
		return fc?.minimumAge && fc?.maximumAge
			? `Ages ${fc.minimumAge}–${fc.maximumAge}`
			: "";
	};
	const maxP = () => reg()?.festivalClass?.maximumPerformancePieces ?? 2;
	const maxM = () => reg()?.festivalClass?.performanceMinutes ?? 8;

	return (
		<CustomerAccountPageLayout slug={props.slug} onAuthenticated={() => void load()}>
			{(session) => (
				<main id="main" class="main">
					<a
						class="breadcrumb"
						href={buildOrgCustomerAccountClassesPath(props.slug)}
						onClick={handleBack}
						data-confirm-discard
					>
						← My Registrations
					</a>
					<div class="page-heading">
						<p class="eyebrow">PURCHASED REGISTRATION</p>
						<h1>Repertoire &amp; accompanist</h1>
						<p class="muted">Update the performance details for this class.</p>
					</div>

					<Show when={loading()}><p role="status">Loading registration details…</p></Show>
					<Show when={error()}><p class="error-text" role="alert">{error()}</p></Show>
					<Show when={saveSuccess()}>
						<div class="note" role="status"><strong>Changes saved successfully.</strong></div>
					</Show>

					<Show when={!loading() && reg()}>
						<Show when={!isClosed()}>
							<div class="note" id="edit-open-note">
								<strong>
									Editing is open until{" "}
									{(() => {
										const c = cutoff();
										return c
											? formatCutoffFull(
													c,
													props.app?.organization()?.timezone ||
														"America/Los_Angeles",
												)
											: "cutoff date";
									})()}
									.
								</strong>
								<span> Your performer, class, division, and teacher stay fixed.</span>
							</div>
						</Show>
						<Show when={isClosed()}>
							<div class="warning" id="edit-closed-note" role="status">
								<strong>Editing is closed.</strong>
								<p>The repertoire and accompanist cutoff has passed. You can still view your registration details.</p>
							</div>
						</Show>

						<div class="content-grid">
							<div class="stack">
								<For each={pieces()}>
									{(p, idx) => (
										<section class="panel">
											<div class="panel-heading">
												<div>
													<p class="eyebrow">REPERTOIRE · PIECE {idx() + 1} OF {pieces().length}</p>
													<h2>Performance piece</h2>
												</div>
												<span class="badge status-neutral">{formatPieceTime(p.minutes, p.seconds)} total</span>
											</div>
											<form data-preview-form="edit">
												<fieldset id="editable-repertoire" class="plain-fieldset" disabled={isClosed()}>
													<div class="stack">
														<div class="field">
															<label for={`edit-title-${idx()}`}>Title</label>
															<input
																id={`edit-title-${idx()}`}
																value={p.title}
																onInput={(e) => updatePiece(idx(), "title", e.currentTarget.value)}
																required
																disabled={isClosed()}
															/>
														</div>
														<div class="field">
															<label for={`edit-composer-${idx()}`}>Composer</label>
															<input
																id={`edit-composer-${idx()}`}
																value={p.composer}
																onInput={(e) => updatePiece(idx(), "composer", e.currentTarget.value)}
																required
																disabled={isClosed()}
															/>
														</div>
														<div class="field">
															<label for={`edit-movement-${idx()}`}>Movement <span class="muted">(if applicable)</span></label>
															<input
																id={`edit-movement-${idx()}`}
																value={p.movement}
																onInput={(e) => updatePiece(idx(), "movement", e.currentTarget.value)}
																disabled={isClosed()}
															/>
														</div>
														<fieldset class="duration-field">
															<legend>Performance duration</legend>
															<div class="field-grid two-columns">
																<div class="field">
																	<label for={`edit-minutes-${idx()}`}>Minutes</label>
																	<input
																		id={`edit-minutes-${idx()}`}
																		type="number"
																		min="0"
																		max="60"
																		value={p.minutes}
																		onInput={(e) => updatePiece(idx(), "minutes", Number(e.currentTarget.value))}
																		required
																		disabled={isClosed()}
																	/>
																</div>
																<div class="field">
																	<label for={`edit-seconds-${idx()}`}>Seconds</label>
																	<input
																		id={`edit-seconds-${idx()}`}
																		type="number"
																		min="0"
																		max="59"
																		value={p.seconds}
																		onInput={(e) => updatePiece(idx(), "seconds", Number(e.currentTarget.value))}
																		required
																		disabled={isClosed()}
																	/>
																</div>
															</div>
														</fieldset>
													</div>
												</fieldset>
											</form>
										</section>
									)}
								</For>

								<Show when={pieces().length < maxP() && !isClosed()}>
									<div class="form-actions">
										<button class="text-link" type="button" data-preview-action="add-edit-piece" onClick={addPiece}>
											+ Add another piece
										</button>
										<span class="muted small-copy">Maximum {maxP()} pieces · {maxM()} minutes total</span>
									</div>
								</Show>

								<section class="panel">
									<div class="panel-heading"><h2>Accompanist</h2></div>
									<fieldset id="editable-accompanist" class="plain-fieldset" disabled={isClosed()}>
										<div class="field">
											<label for="edit-accompanist">Registered accompanist</label>
											<select
												id="edit-accompanist"
												value={accompanistId()}
												onChange={(e) => {
													setAccompanistId(e.currentTarget.value);
													setIsDirty(true);
												}}
												disabled={isClosed()}
											>
												<option value="">Not required</option>
												<For each={accompanists()}>
													{(acc) => <option value={acc.id} selected={acc.id === accompanistId()}>{acc.name}</option>}
												</For>
											</select>
											<span class="muted small-copy">Choose an active registered accompanist when your performance requires one.</span>
										</div>
									</fieldset>
								</section>

								<Show when={!isClosed()}>
									<div class="form-actions" id="edit-save-actions">
										<button
											class="button"
											type="button"
											data-preview-action="save-registration"
											disabled={saving()}
											onClick={() => void save(session.csrfToken)}
										>
											{saving() ? "Saving…" : "Save Changes"}
										</button>
										<a
											class="text-link"
											href={buildOrgCustomerAccountClassesPath(props.slug)}
											onClick={handleBack}
											data-confirm-discard
										>
											Cancel
										</a>
									</div>
								</Show>
							</div>

							<aside class="side-summary">
								<section class="panel">
									<p class="eyebrow">REGISTRATION DETAILS</p>
									<h2 data-edit-performer>{reg()?.child?.name ?? "Performer"}</h2>
									<span class="badge status-available">Confirmed</span>
									<dl class="summary-grid">
										<dt>Festival</dt>
										<dd data-edit-festival>{fest()?.name ?? "Festival"}</dd>
										<dt>Class</dt>
										<dd data-edit-class>{reg()?.festivalClass?.displayName ?? "Festival Class"}</dd>
										<dt>Division</dt>
										<dd>{div()?.displayName ?? "Division"}</dd>
										<dt>Age group</dt>
										<dd data-edit-age>{ageRange() || "All ages"}</dd>
										<dt>Teacher</dt>
										<dd data-edit-teacher>{teacherName()}</dd>
									</dl>
									<p class="muted small-copy">These registration details cannot be changed here.</p>
								</section>
								<p class="page-footnote">Your repertoire and accompanist updates apply to this class only.</p>
							</aside>
						</div>
					</Show>
				</main>
			)}
		</CustomerAccountPageLayout>
	);
}
