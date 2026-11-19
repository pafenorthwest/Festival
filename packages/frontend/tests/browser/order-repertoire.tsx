// Open /tests/browser/order-repertoire.html on the frontend dev server.
import type { RepertoirePiece } from "@festival/common";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import type { FestivalAppController } from "../../src/app/useFestivalAppController.js";
import { FestivalPieceEditor } from "../../src/components/FestivalPieceEditor.js";
import { CustomerAccountOrdersPage } from "../../src/pages/CustomerAccountOrdersPage.js";
import "../../src/styles.css";
import "../../src/parent-registration.css";

const app = document.getElementById("app");
const results = document.getElementById("results");
if (!app || !results) throw new Error("Missing browser fixture elements");

const legacyPiece = {
	title: "Legacy title",
	composer: "Legacy composer",
	durationSeconds: 180,
};
const longCatalogTitle = "Long catalog title, ".repeat(13).trim();
const linkedPiece = {
	...legacyPiece,
	title: longCatalogTitle,
	catalogWorkId: "saved-work",
};
const catalogWork = {
	id: "new-concerto",
	title: "Concerto in A",
	composerName: "Example Composer",
	classifications: ["concerto"],
	isActive: true,
};
const sameTitleWork = {
	...catalogWork,
	id: "different-concerto",
	composerName: "Another Composer",
};
const missingComposerWork = {
	...catalogWork,
	id: "unknown-composer",
	title: longCatalogTitle,
	composerName: null,
};
const registrations = ["legacy", "linked", "solo", "closed", "two-pieces"].map(
	(id) => ({
		entitlement: {
			id,
			status: "confirmed",
			festivalId: "internal-festival-id",
			festivalShortName: "spring",
		},
		festivalClass: {
			displayName: id,
			requiresConcerto: id !== "solo",
			maximumPerformancePieces: 2,
			performanceMinutes: 10,
		},
		metadata: {
			id: `metadata-${id}`,
			repertoireJson:
				id === "two-pieces"
					? [
							legacyPiece,
							{ ...legacyPiece, title: "Second piece", composer: "" },
						]
					: [id === "linked" ? linkedPiece : legacyPiece],
			repertoireItems:
				id === "linked"
					? [{ displayOrder: 1, catalogWorkId: linkedPiece.catalogWorkId }]
					: [],
		},
		canEditMetadata: id !== "closed",
		metadataEditCutoffIso: id === "closed" ? "2000-01-01" : "2099-04-01",
	}),
);
const saves: Array<{ id: string; pieces: RepertoirePiece[] }> = [];
let failNextSave = true;
let queries = 0;

window.fetch = async (input, init) => {
	const url = new URL(String(input), window.location.href);
	const { pathname } = url;
	if (pathname.endsWith("/customer/session")) {
		return Response.json({
			session: { authenticated: true, csrfToken: "fixture" },
		});
	}
	if (pathname.endsWith("/customer/orders")) {
		return Response.json({ orders: [], pageInfo: { hasNextPage: false } });
	}
	if (pathname.endsWith("/customer/class-registrations")) {
		return Response.json({ registrations });
	}
	if (pathname.endsWith("/festivals/spring/registration/concerto-catalog")) {
		queries++;
		return Response.json({
			works:
				url.searchParams.get("q") === "Unknown"
					? [missingComposerWork]
					: [sameTitleWork, catalogWork],
		});
	}
	const registrationRoute =
		/\/festivals\/spring\/registration\/class-registrations\/(legacy|linked|solo|two-pieces)\/metadata$/;
	const id = pathname.match(registrationRoute)?.[1];
	if (id && init?.method === "PATCH") {
		assert(
			new Headers(init.headers).get("X-CSRF-Token") === "fixture",
			"CSRF header",
		);
		const { pieces } = JSON.parse(String(init.body));
		saves.push({ id, pieces });
		if (failNextSave) {
			failNextSave = false;
			return Response.json({ error: "Try again" }, { status: 400 });
		}
		return Response.json({
			metadata: { repertoireJson: pieces, repertoireItems: [] },
		});
	}
	throw new Error(`Unexpected fixture request: ${init?.method} ${pathname}`);
};

function assert(condition: unknown, message: string) {
	if (!condition) throw new Error(message);
}

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
	const found = document.querySelector<T>(selector);
	if (!found) throw new Error(`Missing element ${selector}`);
	return found;
}

async function waitFor(condition: () => unknown, message: string) {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (condition()) return;
		await new Promise((resolve) => setTimeout(resolve, 15));
	}
	throw new Error(message);
}

function enter(selector: string, value: string) {
	const input = element<HTMLInputElement>(selector);
	input.focus();
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function openSuggestions(
	titleSelector: string,
	composerSelector: string,
) {
	const title = element<HTMLInputElement>(titleSelector);
	const composer = element<HTMLInputElement>(composerSelector);
	const composerTop = composer.getBoundingClientRect().top;
	enter(titleSelector, "Con");
	await waitFor(
		() => document.querySelector('[role="listbox"] [role="option"]'),
		"Missing concerto suggestion",
	);
	const popup = element('[role="listbox"]');
	const inputBounds = title.getBoundingClientRect();
	const popupBounds = popup.getBoundingClientRect();
	assert(
		popup === title.nextElementSibling &&
			title.getAttribute("aria-controls") === popup.id &&
			title.getAttribute("aria-expanded") === "true",
		"The title input immediately precedes and controls the suggestion popup",
	);
	assert(
		Math.abs(popupBounds.top - inputBounds.bottom) <= 1 &&
			Math.abs(popupBounds.left - inputBounds.left) <= 1 &&
			Math.abs(popupBounds.width - inputBounds.width) <= 1,
		"The suggestion popup starts at the bottom of the textbox and matches its full width",
	);
	assert(
		Math.abs(composer.getBoundingClientRect().top - composerTop) <= 1,
		"Showing the popup does not move the composer input",
	);
	const options = popup.querySelectorAll<HTMLElement>('[role="option"]');
	assert(options.length === 2, "Both works appear in the same popup");
	const option = options[1];
	assert(
		option.textContent?.includes(catalogWork.composerName),
		"Composer distinguishes suggestions with the same title",
	);
	return { title, composer, popup, option };
}

function clickVisible(target: HTMLElement, description: string) {
	const bounds = target.getBoundingClientRect();
	const hit = document.elementFromPoint(
		bounds.left + bounds.width / 2,
		bounds.top + bounds.height / 2,
	);
	if (!(hit instanceof HTMLElement) || !target.contains(hit)) {
		throw new Error(`${description} cannot be reached by a pointer`);
	}
	hit.click();
}

function assertSelected(
	suggestion: Awaited<ReturnType<typeof openSuggestions>>,
) {
	const { title, composer, popup } = suggestion;
	assert(
		!popup.isConnected && title.getAttribute("aria-expanded") !== "true",
		"Selecting a suggestion closes the popup",
	);
	assert(
		title.value === catalogWork.title &&
			composer.value === catalogWork.composerName,
		"Selection retains both the title and composer",
	);
}

async function verifyOrderHistory() {
	const editButtons = () =>
		document.querySelectorAll<HTMLButtonElement>(
			".customer-registration-list li button",
		);
	await waitFor(() => editButtons().length === 5, "Orders did not load");
	assert(
		editButtons()[3].disabled,
		"The passed cutoff leaves the order read-only",
	);
	editButtons()[0].click();
	const title = "#repertoire-piece-0-title";
	const save = '[data-testid="btn-save-repertoire"]';
	const dialog = '[role="dialog"]';
	const suggestion = await openSuggestions(
		title,
		"#repertoire-piece-0-composer",
	);
	clickVisible(suggestion.option, "The overlay option");
	assertSelected(suggestion);
	element(save).click();
	await waitFor(
		() => document.querySelector('[role="alert"]'),
		"Failed save did not surface in the modal",
	);
	assert(
		element<HTMLInputElement>(title).value === catalogWork.title,
		"Failed save keeps the draft",
	);
	element(save).click();
	await waitFor(
		() => !document.querySelector(dialog),
		"Successful retry should close the modal",
	);
	assert(
		saves[1]?.pieces[0].catalogWorkId === catalogWork.id,
		"Legacy piece saved with selected link",
	);

	editButtons()[1].click();
	enter("#repertoire-piece-0-minutes", "4");
	element(save).click();
	await waitFor(
		() => !document.querySelector(dialog),
		"Linked duration edit did not save",
	);
	assert(
		saves[2]?.pieces[0].catalogWorkId === "saved-work",
		"Duration edit preserved a saved link outside search results",
	);
	assert(
		saves[2]?.pieces[0].durationSeconds === 240,
		"Duration edit reached the save request",
	);
	assert(
		saves[2]?.pieces[0].title === longCatalogTitle,
		"Duration edit preserved a linked title over 200 characters",
	);

	editButtons()[2].click();
	assert(
		element(title).getAttribute("role") !== "combobox",
		"Ordinary class uses free text",
	);
	enter(title, "Manually edited solo");
	element(save).click();
	await waitFor(
		() => !document.querySelector(dialog),
		"Free-text edit did not save",
	);
	assert(
		saves[3]?.pieces[0].title === "Manually edited solo",
		"Ordinary class persisted the title",
	);
	assert(
		!saves[3]?.pieces[0].catalogWorkId,
		"Ordinary class left the work unlinked",
	);
	assert(
		queries === 1,
		"Persisted links and ordinary pieces should not query the catalog",
	);

	editButtons()[4].click();
	const manualEntryButton = () =>
		Array.from(
			document.querySelectorAll<HTMLButtonElement>(`${dialog} button`),
		).find((button) => button.textContent?.trim() === "Enter my own piece");
	manualEntryButton()?.click();
	assert(
		element(title).getAttribute("role") !== "combobox",
		"First piece is in manual entry mode",
	);
	element('[data-testid="btn-remove-piece-0"]').click();
	assert(
		element(title).getAttribute("role") === "combobox",
		"Removing the first piece starts the second piece in catalog search",
	);
	assert(
		element<HTMLInputElement>(title).value === "Second piece",
		"The remaining piece keeps its own title",
	);
	enter(title, "Unknown");
	await waitFor(
		() => document.querySelector('[role="option"]'),
		"Missing suggestion without a composer",
	);
	element('[role="option"]').click();
	const composer = "#repertoire-piece-0-composer";
	enter(composer, "E");
	assert(
		!element<HTMLInputElement>(composer).readOnly,
		"A linked work without a composer accepts a complete composer name",
	);
	enter(composer, "Example Composer");
	manualEntryButton()?.click();
	assert(
		!element<HTMLInputElement>(title).readOnly,
		"Manual entry unlocks a linked work title",
	);
	assert(
		element<HTMLInputElement>(title).value === longCatalogTitle,
		"Manual entry keeps the title",
	);
	element(save).click();
	assert(
		document.querySelector(`${dialog} [role="alert"]`)?.textContent?.trim() ===
			"Title cannot exceed 200 characters.",
		"Unlinking reapplies the manual title limit",
	);
	assert(saves.length === 4, "An overlong manual title is not submitted");
	const shorterTitle = "Manually edited concerto";
	enter(title, shorterTitle);
	element(save).click();
	await waitFor(
		() => !document.querySelector(dialog),
		"Manual concerto edit did not save",
	);
	assert(
		saves[4]?.pieces[0].title === shorterTitle,
		"Manual entry saves after shortening the title",
	);
	assert(
		!saves[4]?.pieces[0].catalogWorkId,
		"Manual entry removes the catalog link",
	);
}

async function verifySignup(root: HTMLElement) {
	const [savedPieces, setSavedPieces] = createSignal<RepertoirePiece[]>([]);
	render(
		() => (
			<main class="parent-shell">
				<FestivalPieceEditor
					pieces={savedPieces()}
					onChange={setSavedPieces}
					maxPieces={1}
					performanceMinutes={10}
					catalogScope={{ organizationSlug: "pafe", festivalSlug: "spring" }}
				/>
			</main>
		),
		root,
	);
	assert(
		document.querySelector("#registration-piece-catalog") === null,
		"Signup offers a single title box",
	);
	const titleSelector = "#registration-piece-title";
	const composerSelector = "#registration-piece-composer";
	const { title, popup } = await openSuggestions(
		titleSelector,
		composerSelector,
	);
	clickVisible(element(".concerto-title-mode"), "Enter my own piece");
	assert(
		!popup.isConnected &&
			title.getAttribute("role") !== "combobox" &&
			title.value === "Con",
		"Manual entry remains reachable while suggestions are open and keeps the typed title",
	);
	element(".concerto-title-mode").click();

	const press = (key: string) =>
		title.dispatchEvent(
			new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
		);
	const reopened = await openSuggestions(titleSelector, composerSelector);
	press("Escape");
	assert(
		!reopened.popup.isConnected && title.value === "Con",
		"Escape dismisses suggestions without changing the title",
	);
	const suggestion = await openSuggestions(titleSelector, composerSelector);
	press("ArrowUp");
	assert(
		title.getAttribute("aria-activedescendant") === suggestion.option.id,
		"ArrowUp highlights the last suggestion",
	);
	press("Enter");
	assertSelected(suggestion);
	enter("#registration-piece-minutes", "3");
	element('.parent-piece-form button[type="submit"]').click();
	assert(
		savedPieces()[0]?.catalogWorkId === catalogWork.id,
		"Signup preserves the selected catalog work",
	);
}

const controller = {
	isDropTransferEnabled: () => false,
} as FestivalAppController;
const dispose = render(
	() => <CustomerAccountOrdersPage app={controller} slug="pafe" />,
	app,
);
void verifyOrderHistory()
	.then(() => {
		dispose();
		window.scrollTo(0, 0);
		return verifySignup(app);
	})
	.then(
		() => {
			results.textContent = `PASS: Order repertoire and signup suggestions at ${window.innerWidth}px`;
		},
		(error) => {
			results.textContent = `FAIL: ${String(error)}`;
		},
	);
