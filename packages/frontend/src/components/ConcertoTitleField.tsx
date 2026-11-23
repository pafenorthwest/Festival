import type { CanonicalWork } from "@festival/common";
import { createSignal, For, Show } from "solid-js";
import { useConcertoCatalogSearch } from "../pages/festivalRegistrationHooks.js";
import { Button } from "./Button.js";
import "./ConcertoTitleField.css";
import { CUSTOMER_HELP_TEXT, HelpTooltip } from "./HelpTooltip.js";

interface ConcertoTitleFieldProps {
	id: string;
	name?: string;
	testId?: string;
	organizationSlug: string;
	festivalSlug: string;
	title: string;
	catalogWorkId?: string | null;
	onTitleInput: (title: string) => void;
	onSelect: (work: CanonicalWork) => void;
	onManual: () => void;
}

export function ConcertoTitleField(props: ConcertoTitleFieldProps) {
	const [manualEntry, setManualEntry] = createSignal(false);
	const [searchOpen, setSearchOpen] = createSignal(false);
	const [activeIndex, setActiveIndex] = createSignal(-1);
	let input: HTMLInputElement | undefined;
	let anchor: HTMLDivElement | undefined;
	const canSearch = () => !manualEntry() && !props.catalogWorkId;
	const query = () => (canSearch() && searchOpen() ? props.title.trim() : "");
	const search = useConcertoCatalogSearch(
		() => props.organizationSlug,
		() => props.festivalSlug,
		query,
	);
	const suggestions = () => (query() ? search.results() : []);
	const listId = () => `${props.id}-suggestions`;
	const optionId = (index: number) => `${listId()}-${index}`;
	const helpId = () => `${props.id}-help`;
	const status = () => {
		if (!query()) return "";
		if (search.loading()) return "Searching the concerto catalog…";
		return (
			search.error() ??
			(suggestions().length
				? `${suggestions().length} concerto suggestions available.`
				: "No concertos match this title.")
		);
	};

	function closeSearch() {
		setSearchOpen(false);
		setActiveIndex(-1);
	}

	function selectWork(work: CanonicalWork) {
		closeSearch();
		props.onSelect(work);
		input?.focus();
	}

	function enterManually() {
		setManualEntry(true);
		closeSearch();
		props.onManual();
		input?.focus();
	}

	function searchAgain() {
		setManualEntry(false);
		setSearchOpen(true);
		input?.focus();
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (!canSearch() || event.isComposing) return;
		if (event.key === "Escape" && searchOpen()) {
			event.preventDefault();
			event.stopPropagation();
			closeSearch();
			return;
		}
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			setSearchOpen(true);
			const last = suggestions().length - 1;
			if (last < 0) return;
			const direction = event.key === "ArrowDown" ? 1 : -1;
			const next =
				activeIndex() < 0
					? direction > 0
						? 0
						: last
					: (activeIndex() + direction + last + 1) % (last + 1);
			setActiveIndex(next);
			input?.ownerDocument.getElementById(optionId(next))?.scrollIntoView({
				block: "nearest",
			});
			return;
		}
		const activeWork = suggestions()[activeIndex()];
		if (event.key === "Enter" && activeWork) {
			event.preventDefault();
			selectWork(activeWork);
		}
	}

	return (
		<div
			class="field concerto-title-field"
			onFocusOut={(event) => {
				const target = event.relatedTarget as Node | null;
				if (
					!event.currentTarget.contains(target) ||
					(query() && !anchor?.contains(target))
				) {
					closeSearch();
				}
			}}
		>
			<div class="field-help-header concerto-title-label">
				<label for={props.id}>Title</label>
				<HelpTooltip
					id={`${props.id}-concerto-catalog-help`}
					label="About concerto catalog works"
					text={CUSTOMER_HELP_TEXT.concertoCatalog}
				/>
			</div>
			<div
				class="concerto-title-anchor"
				classList={{ "concerto-title-anchor-open": Boolean(query()) }}
				ref={anchor}
			>
				{/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-expanded is set only while the input has the combobox role. */}
				<input
					ref={input}
					id={props.id}
					name={props.name}
					data-testid={props.testId}
					type="text"
					value={props.title}
					readOnly={Boolean(props.catalogWorkId)}
					required
					autocomplete="off"
					role={canSearch() ? "combobox" : undefined}
					aria-autocomplete={canSearch() ? "list" : undefined}
					aria-controls={suggestions().length ? listId() : undefined}
					aria-expanded={canSearch() ? suggestions().length > 0 : undefined}
					aria-activedescendant={
						suggestions()[activeIndex()] ? optionId(activeIndex()) : undefined
					}
					aria-describedby={manualEntry() ? undefined : helpId()}
					onFocus={() => {
						if (canSearch()) setSearchOpen(true);
					}}
					onInput={(event) => {
						props.onTitleInput(event.currentTarget.value);
						setActiveIndex(-1);
						if (canSearch()) setSearchOpen(true);
					}}
					onKeyDown={handleKeyDown}
				/>
				<Show when={suggestions().length > 0}>
					<div
						class="concerto-title-popup concerto-title-suggestions"
						id={listId()}
						role="listbox"
						aria-label="Concerto suggestions"
					>
						<For each={suggestions()}>
							{(work, index) => (
								<button
									type="button"
									tabIndex={-1}
									id={optionId(index())}
									role="option"
									aria-selected={index() === activeIndex()}
									onMouseDown={(event) => event.preventDefault()}
									onClick={() => selectWork(work)}
								>
									{work.title}
									{work.composerName ? ` — ${work.composerName}` : ""}
								</button>
							)}
						</For>
					</div>
				</Show>
				<Show when={query() && !suggestions().length}>
					<div class="concerto-title-popup concerto-title-feedback">
						<span aria-hidden="true">{status()}</span>
						<Show when={search.error()}>
							<Button
								type="button"
								variant="secondary"
								onClick={() => {
									input?.focus();
									search.retry();
								}}
							>
								Retry search
							</Button>
						</Show>
					</div>
				</Show>
			</div>
			<Show
				when={!manualEntry()}
				fallback={
					<Button
						type="button"
						class="link-button concerto-title-mode"
						onClick={searchAgain}
					>
						Search catalog
					</Button>
				}
			>
				<Button
					type="button"
					class="link-button concerto-title-mode"
					onClick={enterManually}
				>
					Enter my own piece
				</Button>
			</Show>
			<Show when={!manualEntry()}>
				<div id={helpId()} class="muted concerto-title-help">
					{props.catalogWorkId
						? "Linked to a concerto catalog work."
						: "Start typing to look for your concerto."}
				</div>
			</Show>
			<div class="sr-only" role="status">
				{status()}
			</div>
		</div>
	);
}
