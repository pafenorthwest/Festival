import { Window } from "happy-dom";
import { render } from "solid-js/web/dist/web.js";
import App from "../src/App.js";

export interface RenderedApp {
	container: HTMLElement;
	dispose: () => void;
}

export function setupDom(pathname = "/") {
	const window = new Window({
		url: `http://localhost${pathname}`,
	});

	Object.assign(globalThis, {
		window,
		document: window.document,
		Event: window.Event,
		InputEvent: window.InputEvent,
		MouseEvent: window.MouseEvent,
		PopStateEvent: window.PopStateEvent,
		HTMLElement: window.HTMLElement,
		HTMLButtonElement: window.HTMLButtonElement,
		HTMLInputElement: window.HTMLInputElement,
		HTMLSelectElement: window.HTMLSelectElement,
		localStorage: window.localStorage,
	});
}

export function renderApp(pathname = "/"): RenderedApp {
	setupDom(pathname);
	const container = document.createElement("div");
	document.body.append(container);
	const dispose = render(() => App(), container);
	return { container, dispose };
}

export function textContent() {
	return document.body.textContent ?? "";
}

export function buttonByText(label: string): HTMLButtonElement {
	const button = Array.from(document.querySelectorAll("button")).find(
		(element) => element.textContent?.trim() === label,
	);

	if (!(button instanceof HTMLButtonElement)) {
		throw new Error(`Button not found: ${label}`);
	}

	return button;
}

export function inputByLabel(label: string): HTMLInputElement {
	const labelElement = Array.from(document.querySelectorAll("label")).find(
		(element) => element.textContent?.includes(label),
	);
	const input = labelElement?.querySelector("input");

	if (!(input instanceof HTMLInputElement)) {
		throw new Error(`Input not found: ${label}`);
	}

	return input;
}

export function selectByLabel(label: string): HTMLSelectElement {
	const labelElement = Array.from(document.querySelectorAll("label")).find(
		(element) => element.textContent?.includes(label),
	);
	const select = labelElement?.querySelector("select");

	if (!(select instanceof HTMLSelectElement)) {
		throw new Error(`Select not found: ${label}`);
	}

	return select;
}

export function changeInput(input: HTMLInputElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function changeSelect(select: HTMLSelectElement, value: string) {
	select.value = value;
	select.dispatchEvent(new Event("input", { bubbles: true }));
}
