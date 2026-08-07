import { afterEach, describe, expect, it } from "bun:test";
import {
	buttonByText,
	changeInput,
	changeSelect,
	inputByLabel,
	type RenderedApp,
	renderApp,
	selectByLabel,
	textContent,
} from "./dom-test-helpers.js";

let rendered: RenderedApp | null = null;

function mount(pathname = "/") {
	rendered?.dispose();
	rendered = renderApp(pathname);
	return rendered;
}

afterEach(() => {
	rendered?.dispose();
	rendered = null;
	document.body.replaceChildren();
});

describe("organization onboarding UI", () => {
	it("renders the landing page welcome content and primary CTA", () => {
		mount("/");

		expect(textContent()).toContain("Welcome to Festival");
		expect(textContent()).toContain("Sign up / Create Organization");
	});

	it("opens and closes the landing sign-up modal without leaving home", () => {
		mount("/");

		buttonByText("Sign up / Create Organization").click();

		expect(document.querySelector("[role='dialog']")).not.toBeNull();
		expect(textContent()).toContain("Continue with Google");
		expect(textContent()).toContain("Continue with Email");

		buttonByText("Cancel").click();

		expect(document.querySelector("[role='dialog']")).toBeNull();
		expect(window.location.pathname).toBe("/");
	});

	it("navigates from landing mock success to create organization", () => {
		mount("/");

		buttonByText("Sign up / Create Organization").click();
		buttonByText("Continue with Google").click();

		expect(window.location.pathname).toBe("/create-organization");
		expect(textContent()).toContain("Create Organization");
	});

	it("renders create organization fields and visual validation hints", () => {
		mount("/create-organization");

		expect(inputByLabel("Organization Name")).toBeInstanceOf(HTMLInputElement);
		expect(inputByLabel("Short Name")).toBeInstanceOf(HTMLInputElement);
		expect(textContent()).toContain("Name: max 255 chars");
		expect(textContent()).toContain("Short name: max 6 chars");
		expect(textContent()).toContain("Allowed: [A-Za-z0-9-]");
	});

	it("renders invite member controls and appends a visual invite", () => {
		mount("/create-organization");

		const emailInput = inputByLabel("Email");
		const roleSelect = selectByLabel("Role");

		expect(
			Array.from(roleSelect.options).map((option) => option.value),
		).toEqual([
			"Admin",
			"Division Chair",
			"Music Reviewer",
			"Concert Chair",
			"Read Only",
		]);

		changeInput(emailInput, "reviewer@example.com");
		changeSelect(roleSelect, "Music Reviewer");
		buttonByText("Add Invite").click();

		expect(textContent()).toContain("reviewer@example.com");
		expect(textContent()).toContain("Music Reviewer");
	});

	it("navigates from create organization submit to the canonical org path", () => {
		mount("/create-organization");

		buttonByText("Create Organization").click();

		expect(window.location.pathname).toBe("/org/second-festival");
		expect(textContent()).toContain(
			"Welcome to Second Festival, you are Admin role",
		);
	});

	it("renders invite landing placeholder organization and role data", () => {
		mount("/invite/anything");

		expect(textContent()).toContain("Organization Name:");
		expect(textContent()).toContain("Second Festival");
		expect(textContent()).toContain("Role:");
		expect(textContent()).toContain("Admin");
	});

	it("opens invite sign-up modal with auth options and full name input", () => {
		mount("/invite/abc-123");

		buttonByText("Accept Invite / Sign Up").click();

		expect(document.querySelector("[role='dialog']")).not.toBeNull();
		expect(textContent()).toContain("Continue with Google");
		expect(textContent()).toContain("Continue with Email");
		expect(inputByLabel("Full Name")).toBeInstanceOf(HTMLInputElement);
	});

	it("navigates from invite mock success to the canonical org path", () => {
		mount("/invite/abc-123");

		buttonByText("Accept Invite / Sign Up").click();
		changeInput(inputByLabel("Full Name"), "Pat Reviewer");
		buttonByText("Continue with Email").click();

		expect(window.location.pathname).toBe("/org/second-festival");
		expect(textContent()).toContain(
			"Welcome to Second Festival, you are Admin role",
		);
	});

	it("renders organization landing header, logout no-op, same-page title action, and welcome", () => {
		mount("/org/anything");

		expect(textContent()).toContain("Second Festival");
		expect(textContent()).toContain("Logout");
		expect(textContent()).toContain(
			"Welcome to Second Festival, you are Admin role",
		);

		buttonByText("Second Festival").click();
		expect(window.location.pathname).toBe("/org/anything");

		buttonByText("Logout").click();
		expect(window.location.pathname).toBe("/org/anything");
	});

	it("does not call network or auth-backed helpers during UI-only interactions", async () => {
		const source = await Bun.file("src/App.tsx").text();
		expect(source).not.toContain("./lib/api");
		expect(source).not.toContain("./lib/firebase-auth");
		expect(source).not.toContain("fetch(");

		let fetchCalls = 0;
		globalThis.fetch = (() => {
			fetchCalls += 1;
			return Promise.reject(new Error("Unexpected fetch call"));
		}) as typeof fetch;

		mount("/");
		buttonByText("Sign up / Create Organization").click();
		buttonByText("Continue with Google").click();
		buttonByText("Create Organization").click();

		expect(fetchCalls).toBe(0);
	});

	it("renders direct route entry smoke paths without console errors", () => {
		const errors: unknown[] = [];
		const originalError = console.error;
		console.error = (...args: unknown[]) => {
			errors.push(args);
		};

		try {
			for (const path of [
				"/create-organization",
				"/invite/anything",
				"/org/anything",
			]) {
				mount(path);
				expect(textContent().length).toBeGreaterThan(0);
			}
		} finally {
			console.error = originalError;
		}

		expect(errors).toEqual([]);
	});
});
