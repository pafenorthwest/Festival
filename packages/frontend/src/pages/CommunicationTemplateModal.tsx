import { createEffect, createSignal, Show } from "solid-js";
import { Button } from "../components/Button.js";
import {
	createCommunicationTemplate,
	extractTemplateVariables,
	type MessageChannel,
	type MessageTemplate,
	updateCommunicationTemplate,
} from "../lib/api.js";

interface CommunicationTemplateModalProps {
	isOpen: boolean;
	mode: "create" | "edit";
	template: MessageTemplate | null;
	slug: string;
	onClose: () => void;
	onSaved: (saved: MessageTemplate) => void;
}

export function CommunicationTemplateModal(
	props: CommunicationTemplateModalProps,
) {
	const [templateKey, setTemplateKey] = createSignal("");
	const [channel, setChannel] = createSignal<MessageChannel>("email");
	const [subject, setSubject] = createSignal("");
	const [body, setBody] = createSignal("");
	const [variablesInput, setVariablesInput] = createSignal("");
	const [isActive, setIsActive] = createSignal(true);
	const [pending, setPending] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	createEffect(() => {
		if (props.isOpen) {
			setError(null);
			if (props.mode === "edit" && props.template) {
				setTemplateKey(props.template.templateKey);
				setChannel(props.template.channel);
				setSubject(props.template.subject ?? "");
				setBody(props.template.body);
				setVariablesInput(props.template.variables.join(", "));
				setIsActive(props.template.isActive);
			} else {
				setTemplateKey("");
				setChannel("email");
				setSubject("");
				setBody("");
				setVariablesInput("");
				setIsActive(true);
			}
		}
	});

	function handleAutoExtractVariables() {
		const source = `${subject()} ${body()}`;
		const detected = extractTemplateVariables(source);
		if (detected.length > 0) {
			setVariablesInput(detected.join(", "));
		}
	}

	function parseVariablesList(): string[] {
		const raw = variablesInput()
			.split(",")
			.map((v) => v.trim())
			.filter(Boolean);
		return Array.from(new Set(raw));
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		setError(null);

		const key = templateKey().trim();
		const currentBody = body().trim();
		if (!key) {
			setError("Template key is required.");
			return;
		}
		if (!currentBody) {
			setError("Template body is required.");
			return;
		}

		let variables = parseVariablesList();
		if (variables.length === 0) {
			variables = extractTemplateVariables(`${subject()} ${currentBody}`);
		}

		setPending(true);
		try {
			const sub = subject().trim() || null;
			if (props.mode === "create") {
				const saved = await createCommunicationTemplate(props.slug, {
					templateKey: key,
					channel: channel(),
					subject: sub,
					body: currentBody,
					variables,
					isActive: isActive(),
				});
				props.onSaved(saved);
			} else if (props.template) {
				const saved = await updateCommunicationTemplate(
					props.slug,
					props.template.id,
					{
						templateKey: key,
						channel: channel(),
						subject: sub,
						body: currentBody,
						variables,
						isActive: isActive(),
					},
				);
				props.onSaved(saved);
			}
			props.onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save template.");
		} finally {
			setPending(false);
		}
	}

	return (
		<Show when={props.isOpen}>
			<div class="modal-backdrop" role="presentation">
				<section
					class="modal-card panel flow-panel"
					role="dialog"
					aria-modal="true"
					aria-labelledby="template-modal-title"
				>
					<header class="flow-header">
						<div>
							<h3 id="template-modal-title">
								{props.mode === "create" ? "Create Template" : "Edit Template"}
							</h3>
							<p class="muted">
								Configure automated notification message content and variables.
							</p>
						</div>
						<button
							type="button"
							class="close-button"
							aria-label="Close dialog"
							onClick={props.onClose}
						>
							&times;
						</button>
					</header>

					<Show when={error()}>
						<div class="banner banner-error" role="alert">
							{error()}
						</div>
					</Show>

					<form onSubmit={handleSubmit} class="flow-form">
						<label class="field">
							<span>Template Key</span>
							<input
								type="text"
								value={templateKey()}
								onInput={(e) => setTemplateKey(e.currentTarget.value)}
								placeholder="e.g. registration_confirmation"
								required
								disabled={pending()}
							/>
						</label>

						<label class="field">
							<span>Channel</span>
							<select
								value={channel()}
								onChange={(e) =>
									setChannel(e.currentTarget.value as MessageChannel)
								}
								disabled={pending()}
							>
								<option value="email">Email</option>
								<option value="sms">SMS</option>
							</select>
						</label>

						<Show when={channel() === "email"}>
							<label class="field">
								<span>Subject</span>
								<input
									type="text"
									value={subject()}
									onInput={(e) => setSubject(e.currentTarget.value)}
									placeholder="Notification subject line"
									disabled={pending()}
								/>
							</label>
						</Show>

						<label class="field">
							<span>Body</span>
							<textarea
								rows={5}
								value={body()}
								onInput={(e) => setBody(e.currentTarget.value)}
								placeholder="Use {{variable}} syntax for dynamic parameters"
								required
								disabled={pending()}
							/>
						</label>

						<div class="field">
							<div
								style={{
									display: "flex",
									"justify-content": "space-between",
									"align-items": "center",
								}}
							>
								<span>Variables (comma-separated)</span>
								<button
									type="button"
									class="button secondary compact-button"
									onClick={handleAutoExtractVariables}
									disabled={pending()}
								>
									Auto-detect from text
								</button>
							</div>
							<input
								type="text"
								value={variablesInput()}
								onInput={(e) => setVariablesInput(e.currentTarget.value)}
								placeholder="e.g. name, date, amount"
								disabled={pending()}
							/>
						</div>

						<label
							class="field"
							style={{
								display: "flex",
								"flex-direction": "row",
								"align-items": "center",
								gap: "0.5rem",
								cursor: "pointer",
							}}
						>
							<input
								type="checkbox"
								checked={isActive()}
								onChange={(e) => setIsActive(e.currentTarget.checked)}
								disabled={pending()}
							/>
							<span>Active</span>
						</label>

						<footer
							style={{
								display: "flex",
								"justify-content": "flex-end",
								gap: "0.75rem",
								"margin-top": "1rem",
							}}
						>
							<Button
								type="button"
								variant="secondary"
								onClick={props.onClose}
								disabled={pending()}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={pending()}>
								{pending()
									? "Saving..."
									: props.mode === "create"
										? "Create Template"
										: "Save Changes"}
							</Button>
						</footer>
					</form>
				</section>
			</div>
		</Show>
	);
}
