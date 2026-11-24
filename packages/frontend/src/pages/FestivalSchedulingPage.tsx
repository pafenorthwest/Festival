import {
	evaluateSchedulingConfigPreview,
	type FestivalClassConfigurationDto,
	type OrganizationDivision,
	type Room,
	type SchedulingClassRule,
	type SchedulingConfiguration,
	type SchedulingConfigurationRevision,
	safeParse,
	UpdateSchedulingConfigurationSchema,
} from "@festival/common";
import {
	createMemo,
	createResource,
	createSignal,
	For,
	Match,
	Show,
	Switch,
} from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import { Button } from "../components/Button.js";
import {
	ApiError,
	getAdminDivisions,
	getAdminFestival,
	getSchedulingConfiguration,
	listFestivalClasses,
	listRooms,
	saveSchedulingConfiguration,
} from "../lib/api.js";
import { buildFestivalAdminPath } from "../lib/routes.js";
import { SchedulingAdjudicatorsSection } from "./SchedulingAdjudicatorsSection.js";
import { SchedulingCapacityPreviewPanel } from "./SchedulingCapacityPreviewPanel.js";
import { SchedulingClassRuleRow } from "./SchedulingClassRuleRow.js";
import { SchedulingCompatibilitySection } from "./SchedulingCompatibilitySection.js";
import { SchedulingDatesAndPoliciesSection } from "./SchedulingDatesAndPoliciesSection.js";
import { SchedulingRoomWindowsSection } from "./SchedulingRoomWindowsSection.js";

type SchedulingTab = "setup" | "review" | "generate" | "versions" | "export";

const SCHEDULING_TABS: ReadonlyArray<{ id: SchedulingTab; label: string }> = [
	{ id: "setup", label: "Setup" },
	{ id: "review", label: "Input review" },
	{ id: "generate", label: "Generate" },
	{ id: "versions", label: "Versions" },
	{ id: "export", label: "Export" },
];

function byClass(rules: SchedulingClassRule[]) {
	return new Map(rules.map((rule) => [rule.classId, rule]));
}

function SchedulingSetupForm(props: {
	festivalStartDate: string;
	festivalEndDate: string;
	classes: FestivalClassConfigurationDto[];
	rooms: Room[];
	divisions: OrganizationDivision[];
	initial: SchedulingConfigurationRevision;
	save: (
		expectedRevision: number,
		config: SchedulingConfiguration,
	) => Promise<SchedulingConfigurationRevision>;
	reload: () => void;
}) {
	const [saved, setSaved] = createSignal(props.initial);
	const [draft, setDraft] = createSignal<SchedulingConfiguration>(
		structuredClone(props.initial.config),
	);
	const [saving, setSaving] = createSignal(false);
	const [stale, setStale] = createSignal(false);
	const [notice, setNotice] = createSignal("");
	const [error, setError] = createSignal("");

	const savedByClass = createMemo(() => byClass(saved().config.classRules));
	const draftByClass = createMemo(() => byClass(draft().classRules));

	const changed = createMemo(
		() => JSON.stringify(draft()) !== JSON.stringify(saved().config),
	);

	const preview = createMemo(() =>
		evaluateSchedulingConfigPreview(draft(), {
			rooms: props.rooms,
			catalogClasses: props.classes,
			divisions: props.divisions,
		}),
	);

	function updateConfig(patch: Partial<SchedulingConfiguration>) {
		setDraft((prev) => ({ ...prev, ...patch }));
		setError("");
		setNotice("");
	}

	function editClassRule(classId: string, rule?: SchedulingClassRule) {
		const map = new Map(draftByClass());
		if (rule) map.set(classId, rule);
		else map.delete(classId);
		updateConfig({ classRules: [...map.values()] });
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (saving() || stale() || !changed()) return;
		const parsed = safeParse(UpdateSchedulingConfigurationSchema, {
			expectedRevision: saved().revision,
			config: draft(),
		});
		if (!parsed.success) {
			const issue = parsed.issues[0];
			setError(issue.message);
			return;
		}
		setSaving(true);
		setError("");
		setNotice("");
		try {
			const result = await props.save(
				parsed.output.expectedRevision,
				parsed.output.config,
			);
			setSaved(result);
			setDraft(structuredClone(result.config));
			setNotice(`Saved revision ${result.revision}.`);
		} catch (cause) {
			if (cause instanceof ApiError && cause.status === 409) {
				setStale(true);
				setError(
					"Another editor saved a newer revision. Reload the saved configuration to replace these unsaved edits.",
				);
			} else {
				setError(
					cause instanceof Error
						? cause.message
						: "Could not save the scheduling configuration.",
				);
			}
		} finally {
			setSaving(false);
		}
	}

	return (
		<>
			<p class="scheduling-meta-line">
				<span>Configuration revision {saved().revision}</span> ·{" "}
				<span>Active version: None published</span>
			</p>
			<form onSubmit={save}>
				<fieldset class="scheduling-fieldset" disabled={saving() || stale()}>
					<SchedulingDatesAndPoliciesSection
						config={draft()}
						festivalStartDate={props.festivalStartDate}
						festivalEndDate={props.festivalEndDate}
						onUpdate={updateConfig}
					/>

					<SchedulingAdjudicatorsSection
						adjudicators={draft().adjudicators}
						divisions={props.divisions}
						onChange={(adjudicators) => updateConfig({ adjudicators })}
					/>

					<SchedulingRoomWindowsSection
						windows={draft().roomWindows}
						windowSummaries={preview().windowSummaries}
						festivalDates={draft().festivalDates}
						rooms={props.rooms}
						adjudicators={draft().adjudicators}
						divisions={props.divisions}
						onChange={(roomWindows) => updateConfig({ roomWindows })}
					/>

					<section class="scheduling-section">
						<h3>Class rules</h3>
						<Show
							when={props.classes.length}
							fallback={<p>This festival has no catalog classes.</p>}
						>
							<p>
								Section durations include Playing, pooled Oral time and a
								90-second transition per entry. The preview shows the shortest
								and longest section allowed by each rule.
							</p>
							<div class="classes-table-scroll">
								<table class="scheduling-rules">
									<caption class="sr-only">
										Class timing, section size, and placement-group rules
									</caption>
									<thead>
										<tr>
											<th>Catalog class</th>
											<th>Scheduling code</th>
											<th>Published limit</th>
											<th>Playing (min)</th>
											<th>Oral (min)</th>
											<th>Section size</th>
											<th>Section duration</th>
											<th>Placement-group exception</th>
										</tr>
									</thead>
									<tbody>
										<For each={props.classes}>
											{(item) => (
												<SchedulingClassRuleRow
													item={item}
													rule={draftByClass().get(item.id)}
													saved={savedByClass().get(item.id)}
													onChange={(rule) => editClassRule(item.id, rule)}
												/>
											)}
										</For>
									</tbody>
								</table>
							</div>
						</Show>
					</section>

					<SchedulingCompatibilitySection
						rules={draft().roomCompatibilityRules}
						divisions={props.divisions}
						classRules={draft().classRules}
						adjudicators={draft().adjudicators}
						onChange={(roomCompatibilityRules) =>
							updateConfig({ roomCompatibilityRules })
						}
					/>

					<SchedulingCapacityPreviewPanel preview={preview()} />

					<div class="scheduling-actions-bar">
						<Button type="submit" disabled={!changed() || saving() || stale()}>
							{saving() ? "Saving…" : "Save scheduling setup"}
						</Button>
					</div>
				</fieldset>
				<Show when={error()}>
					<p role="alert">{error()}</p>
				</Show>
				<Show when={stale()}>
					<Button type="button" variant="secondary" onClick={props.reload}>
						Reload saved configuration
					</Button>
				</Show>
				<p role="status">{notice()}</p>
			</form>
		</>
	);
}

export function FestivalSchedulingPage(props: {
	app: FestivalAppController;
	slug: string;
	festivalSlug: string;
}) {
	const [activeTab, setActiveTab] = createSignal<SchedulingTab>("setup");
	const [data, { refetch }] = createResource(
		() => {
			const user = props.app.firebaseUser();
			return props.app.isAdminMember() && user
				? { user, slug: props.slug, festivalSlug: props.festivalSlug }
				: null;
		},
		async ({ user, slug, festivalSlug }) => {
			const token = await user.getIdToken();
			const [{ festival }, classes, { rooms }, { divisions }, configRevision] =
				await Promise.all([
					getAdminFestival(token, slug, festivalSlug),
					listFestivalClasses(token, slug, festivalSlug),
					listRooms(token, slug, festivalSlug),
					getAdminDivisions(token, slug),
					getSchedulingConfiguration(token, slug, festivalSlug),
				]);
			return {
				user,
				slug,
				festivalSlug,
				festival,
				classes,
				rooms,
				divisions,
				configRevision,
			};
		},
	);

	return (
		<Show
			when={props.app.isAdminMember()}
			fallback={
				<AccessDeniedPanel message="Only Admin members can manage scheduling." />
			}
		>
			<section class="panel flow-panel">
				<a href={buildFestivalAdminPath(props.slug, props.festivalSlug)}>
					Festival dashboard
				</a>
				<h2>Scheduling</h2>
				<div
					class="scheduling-tabs"
					role="tablist"
					aria-label="Scheduling views"
				>
					<For each={SCHEDULING_TABS}>
						{(tab) => (
							<button
								type="button"
								role="tab"
								aria-selected={activeTab() === tab.id}
								class={`scheduling-tab ${activeTab() === tab.id ? "is-active" : ""}`}
								onClick={() => setActiveTab(tab.id)}
							>
								{tab.label}
							</button>
						)}
					</For>
				</div>
				<Switch>
					<Match when={data.loading}>
						<p role="status">Loading scheduling configuration…</p>
					</Match>
					<Match when={data.error}>
						<p role="alert">
							{data.error instanceof Error
								? data.error.message
								: "Could not load the scheduling setup."}
						</p>
						<Button
							type="button"
							variant="secondary"
							onClick={() => void refetch()}
						>
							Retry
						</Button>
					</Match>
					<Match when={data()} keyed>
						{(loaded) => (
							<>
								<p>
									<strong>{loaded.festival.name}</strong> ·{" "}
									{loaded.festival.startDate} – {loaded.festival.endDate}
									<Show when={props.app.organization()?.timezone}>
										{(zone) => <> · {zone()}</>}
									</Show>
								</p>
								<Show
									when={activeTab() === "setup"}
									fallback={
										<div class="scheduling-card">
											<p class="scheduling-meta-line">
												<span>
													Configuration revision{" "}
													{loaded.configRevision.revision}
												</span>{" "}
												· <span>Active version: None published</span>
											</p>
											<p class="muted">
												This view is planned in the next scheduling milestone
												once Setup inputs are finalized.
											</p>
										</div>
									}
								>
									<SchedulingSetupForm
										festivalStartDate={loaded.festival.startDate}
										festivalEndDate={loaded.festival.endDate}
										classes={loaded.classes}
										rooms={loaded.rooms}
										divisions={loaded.divisions}
										initial={loaded.configRevision}
										reload={() => void refetch()}
										save={async (expectedRevision, config) =>
											saveSchedulingConfiguration(
												await loaded.user.getIdToken(),
												loaded.slug,
												loaded.festivalSlug,
												{ expectedRevision, config },
											)
										}
									/>
								</Show>
							</>
						)}
					</Match>
				</Switch>
			</section>
		</Show>
	);
}
