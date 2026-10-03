import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onMount,
	Show,
} from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import { Button } from "../components/Button.js";
import {
	listCommunicationLogs,
	listCommunicationTemplates,
	type MessageChannel,
	type MessageLog,
	type MessageLogStatus,
	type MessageTemplate,
	updateCommunicationTemplate,
} from "../lib/api.js";
import { CommunicationTemplateModal } from "./CommunicationTemplateModal.js";
import {
	formatChannel,
	formatDeliveryStatus,
	formatIsoDate,
	formatVariables,
	statusBadgeClass,
} from "./communicationHelpers.js";

interface CommunicationTemplatesPageProps {
	app: FestivalAppController;
	slug?: string;
}

type TabId = "templates" | "logs";

export function CommunicationTemplatesPage(
	props: CommunicationTemplatesPageProps,
) {
	const orgSlug = () =>
		props.slug ||
		props.app.organization()?.slug ||
		(props.app.route() as { slug?: string }).slug ||
		"";

	const [activeTab, setActiveTab] = createSignal<TabId>("templates");

	// Templates state
	const [templates, setTemplates] = createSignal<MessageTemplate[]>([]);
	const [templatesLoading, setTemplatesLoading] = createSignal(true);
	const [templatesError, setTemplatesError] = createSignal<string | null>(null);
	const [templateChannelFilter, setTemplateChannelFilter] = createSignal<
		MessageChannel | "all"
	>("all");
	const [templateActiveFilter, setTemplateActiveFilter] = createSignal<
		"all" | "active" | "inactive"
	>("all");

	// Delivery logs state
	const [logs, setLogs] = createSignal<MessageLog[]>([]);
	const [logsLoading, setLogsLoading] = createSignal(false);
	const [logsError, setLogsError] = createSignal<string | null>(null);
	const [logChannelFilter, setLogChannelFilter] = createSignal<
		MessageChannel | "all"
	>("all");
	const [logStatusFilter, setLogStatusFilter] = createSignal<
		MessageLogStatus | "all"
	>("all");

	// Modal state
	const [modalOpen, setModalOpen] = createSignal(false);
	const [modalMode, setModalMode] = createSignal<"create" | "edit">("create");
	const [selectedTemplate, setSelectedTemplate] =
		createSignal<MessageTemplate | null>(null);

	async function loadTemplates() {
		const slug = orgSlug();
		if (!slug) return;
		setTemplatesLoading(true);
		setTemplatesError(null);
		try {
			const channel =
				templateChannelFilter() !== "all" ? templateChannelFilter() : undefined;
			const isActive =
				templateActiveFilter() === "all"
					? undefined
					: templateActiveFilter() === "active";
			const data = await listCommunicationTemplates(slug, {
				channel: channel as MessageChannel | undefined,
				isActive,
			});
			setTemplates(data);
		} catch (err) {
			setTemplatesError(
				err instanceof Error ? err.message : "Failed to load templates.",
			);
		} finally {
			setTemplatesLoading(false);
		}
	}

	async function loadLogs() {
		const slug = orgSlug();
		if (!slug) return;
		setLogsLoading(true);
		setLogsError(null);
		try {
			const channel =
				logChannelFilter() !== "all" ? logChannelFilter() : undefined;
			const status =
				logStatusFilter() !== "all" ? logStatusFilter() : undefined;
			const data = await listCommunicationLogs(slug, {
				channel: channel as MessageChannel | undefined,
				status: status as MessageLogStatus | undefined,
			});
			setLogs(data);
		} catch (err) {
			setLogsError(err instanceof Error ? err.message : "Failed to load logs.");
		} finally {
			setLogsLoading(false);
		}
	}

	onMount(() => {
		void loadTemplates();
	});

	createEffect(() => {
		const slug = orgSlug();
		if (!slug) return;
		if (activeTab() === "templates") {
			void loadTemplates();
		} else {
			void loadLogs();
		}
	});

	async function handleToggleActive(template: MessageTemplate) {
		const slug = orgSlug();
		if (!slug) return;
		try {
			const updated = await updateCommunicationTemplate(slug, template.id, {
				isActive: !template.isActive,
			});
			setTemplates((prev) =>
				prev.map((t) => (t.id === updated.id ? updated : t)),
			);
		} catch (err) {
			setTemplatesError(
				err instanceof Error
					? err.message
					: "Failed to toggle template status.",
			);
		}
	}

	function handleCreateClick() {
		setSelectedTemplate(null);
		setModalMode("create");
		setModalOpen(true);
	}

	function handleEditClick(template: MessageTemplate) {
		setSelectedTemplate(template);
		setModalMode("edit");
		setModalOpen(true);
	}

	function handleTemplateSaved(saved: MessageTemplate) {
		setTemplates((prev) => {
			const exists = prev.some((t) => t.id === saved.id);
			if (exists) {
				return prev.map((t) => (t.id === saved.id ? saved : t));
			}
			return [saved, ...prev];
		});
	}

	const filteredTemplates = createMemo(() => {
		return templates().filter((t) => {
			if (
				templateChannelFilter() !== "all" &&
				t.channel !== templateChannelFilter()
			) {
				return false;
			}
			if (templateActiveFilter() === "active" && !t.isActive) return false;
			if (templateActiveFilter() === "inactive" && t.isActive) return false;
			return true;
		});
	});

	const filteredLogs = createMemo(() => {
		return logs().filter((l) => {
			if (logChannelFilter() !== "all" && l.channel !== logChannelFilter()) {
				return false;
			}
			if (logStatusFilter() !== "all" && l.status !== logStatusFilter()) {
				return false;
			}
			return true;
		});
	});

	return (
		<Show
			when={props.app.isAdminMember()}
			fallback={
				<AccessDeniedPanel message="Only administrative members can access communications automation." />
			}
		>
			<section class="panel flow-panel communication-page-shell">
				<header class="music-review-header">
					<div>
						<h2>Communications Automation</h2>
						<p class="muted">
							Manage notification templates and monitor delivery attempts.
						</p>
					</div>
					<div style={{ display: "flex", gap: "0.5rem" }}>
						<Show when={activeTab() === "templates"}>
							<Button type="button" onClick={handleCreateClick}>
								Create Template
							</Button>
						</Show>
						<Button
							type="button"
							variant="secondary"
							onClick={() => {
								if (activeTab() === "templates") void loadTemplates();
								else void loadLogs();
							}}
							disabled={templatesLoading() || logsLoading()}
						>
							{templatesLoading() || logsLoading()
								? "Refreshing..."
								: "Refresh"}
						</Button>
					</div>
				</header>

				{/* Tab Navigation */}
				<div class="music-review-filter-bar">
					<nav
						class="music-review-status-tabs"
						aria-label="Communication navigation tabs"
					>
						<button
							type="button"
							class={`button ${activeTab() === "templates" ? "primary" : "secondary"}`}
							aria-pressed={activeTab() === "templates"}
							onClick={() => setActiveTab("templates")}
						>
							Templates
						</button>
						<button
							type="button"
							class={`button ${activeTab() === "logs" ? "primary" : "secondary"}`}
							aria-pressed={activeTab() === "logs"}
							onClick={() => setActiveTab("logs")}
						>
							Delivery Logs
						</button>
					</nav>

					{/* Tab Filters */}
					<Show when={activeTab() === "templates"}>
						<div class="music-review-filter-options">
							<label class="field" style={{ margin: "0" }}>
								<span class="raw-label">Channel</span>
								<select
									value={templateChannelFilter()}
									onChange={(e) =>
										setTemplateChannelFilter(
											e.currentTarget.value as MessageChannel | "all",
										)
									}
								>
									<option value="all">All Channels</option>
									<option value="email">Email</option>
									<option value="sms">SMS</option>
								</select>
							</label>

							<label class="field" style={{ margin: "0" }}>
								<span class="raw-label">Status</span>
								<select
									value={templateActiveFilter()}
									onChange={(e) =>
										setTemplateActiveFilter(
											e.currentTarget.value as "all" | "active" | "inactive",
										)
									}
								>
									<option value="all">All Statuses</option>
									<option value="active">Active</option>
									<option value="inactive">Inactive</option>
								</select>
							</label>
						</div>
					</Show>

					<Show when={activeTab() === "logs"}>
						<div class="music-review-filter-options">
							<label class="field" style={{ margin: "0" }}>
								<span class="raw-label">Channel</span>
								<select
									value={logChannelFilter()}
									onChange={(e) =>
										setLogChannelFilter(
											e.currentTarget.value as MessageChannel | "all",
										)
									}
								>
									<option value="all">All Channels</option>
									<option value="email">Email</option>
									<option value="sms">SMS</option>
								</select>
							</label>

							<label class="field" style={{ margin: "0" }}>
								<span class="raw-label">Status</span>
								<select
									value={logStatusFilter()}
									onChange={(e) =>
										setLogStatusFilter(
											e.currentTarget.value as MessageLogStatus | "all",
										)
									}
								>
									<option value="all">All Statuses</option>
									<option value="delivered">Delivered</option>
									<option value="failed">Failed</option>
									<option value="retry">Retry</option>
								</select>
							</label>
						</div>
					</Show>
				</div>

				{/* Error Banners */}
				<Show when={activeTab() === "templates" && templatesError()}>
					<div class="banner banner-error" role="alert">
						{templatesError()}
					</div>
				</Show>
				<Show when={activeTab() === "logs" && logsError()}>
					<div class="banner banner-error" role="alert">
						{logsError()}
					</div>
				</Show>

				{/* Templates Content */}
				<Show when={activeTab() === "templates"}>
					<div class="listing-table communication-templates-table">
						<div class="listing-table-header">
							<span>Key</span>
							<span>Channel</span>
							<span>Subject</span>
							<span>Variables</span>
							<span>Active</span>
							<span>Actions</span>
						</div>

						<Show when={templatesLoading() && templates().length === 0}>
							<div class="listing-table-empty">Loading templates...</div>
						</Show>

						<Show
							when={!templatesLoading() && filteredTemplates().length === 0}
						>
							<div class="listing-table-empty">
								No templates match current filters.
							</div>
						</Show>

						<For each={filteredTemplates()}>
							{(template) => (
								<div class="listing-table-row">
									<span class="cell-title">
										<strong>{template.templateKey}</strong>
									</span>
									<span class="listing-table-badges">
										<span class="badge badge-neutral">
											{formatChannel(template.channel)}
										</span>
									</span>
									<span class="cell-movement">{template.subject || "—"}</span>
									<span
										class="cell-duration"
										title={template.variables.join(", ")}
									>
										{formatVariables(template.variables)}
									</span>
									<span class="listing-table-badges">
										<button
											type="button"
											class={`badge ${template.isActive ? "badge-active" : "badge-inactive"}`}
											onClick={() => void handleToggleActive(template)}
											title="Toggle active status"
											style={{ cursor: "pointer", border: "none" }}
										>
											{template.isActive ? "Active" : "Inactive"}
										</button>
									</span>
									<span class="listing-table-actions">
										<button
											type="button"
											class="button secondary compact-button"
											onClick={() => handleEditClick(template)}
										>
											Edit
										</button>
									</span>
								</div>
							)}
						</For>
					</div>
				</Show>

				{/* Delivery Logs Content */}
				<Show when={activeTab() === "logs"}>
					<div class="listing-table communication-logs-table">
						<div class="listing-table-header">
							<span>Channel</span>
							<span>Provider</span>
							<span>Status</span>
							<span>Attempts</span>
							<span>Error</span>
							<span>Time</span>
						</div>

						<Show when={logsLoading() && logs().length === 0}>
							<div class="listing-table-empty">Loading delivery logs...</div>
						</Show>

						<Show when={!logsLoading() && filteredLogs().length === 0}>
							<div class="listing-table-empty">
								No delivery logs match current filters.
							</div>
						</Show>

						<For each={filteredLogs()}>
							{(log) => (
								<div class="listing-table-row">
									<span class="listing-table-badges">
										<span class="badge badge-neutral">
											{formatChannel(log.channel)}
										</span>
									</span>
									<span class="cell-title">{log.provider}</span>
									<span class="listing-table-badges">
										<span class={`badge ${statusBadgeClass(log.status)}`}>
											{formatDeliveryStatus(log.status)}
										</span>
									</span>
									<span class="cell-duration">{log.attempts}</span>
									<span
										class="cell-movement"
										style={{
											color: log.errorMessage
												? "var(--bullet-error)"
												: undefined,
										}}
										title={log.errorMessage ?? undefined}
									>
										{log.errorMessage || "—"}
									</span>
									<span class="cell-claimed">
										{formatIsoDate(log.createdAtIso)}
									</span>
								</div>
							)}
						</For>
					</div>
				</Show>
			</section>

			{/* Template Create / Edit Modal */}
			<CommunicationTemplateModal
				isOpen={modalOpen()}
				mode={modalMode()}
				template={selectedTemplate()}
				slug={orgSlug()}
				onClose={() => setModalOpen(false)}
				onSaved={handleTemplateSaved}
			/>
		</Show>
	);
}
