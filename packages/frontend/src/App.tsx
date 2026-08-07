import { type AppRoute, buildOrgPath, parseRoute } from "./lib/routes.js";

const MOCK_ORG_PATH = buildOrgPath("second-festival");
const MOCK_ORG_NAME = "Second Festival";
const MOCK_ROLE = "Admin";
const ORGANIZATION_ROLES = [
	"Admin",
	"Division Chair",
	"Music Reviewer",
	"Concert Chair",
	"Read Only",
];

interface InviteDraft {
	email: string;
	role: string;
}

function create<K extends keyof HTMLElementTagNameMap>(
	tagName: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const element = document.createElement(tagName);
	if (className) {
		element.className = className;
	}
	if (text !== undefined) {
		element.textContent = text;
	}
	return element;
}

function button(
	text: string,
	onClick: () => void,
	className?: string,
): HTMLButtonElement {
	const element = create("button", className, text);
	element.type = "button";
	element.addEventListener("click", onClick);
	return element;
}

function field(
	labelText: string,
	input: HTMLInputElement | HTMLSelectElement,
	...hints: string[]
): HTMLLabelElement {
	const label = create("label", "field");
	label.append(create("span", undefined, labelText), input);
	for (const hint of hints) {
		label.append(create("small", undefined, hint));
	}
	return label;
}

function textInput(
	type: string,
	placeholder: string,
	onInput?: (value: string) => void,
): HTMLInputElement {
	const input = create("input");
	input.type = type;
	input.placeholder = placeholder;
	if (onInput) {
		input.addEventListener("input", () => onInput(input.value));
	}
	return input;
}

function navigate(path: string) {
	if (window.location.pathname !== path) {
		window.history.pushState({}, "", path);
	}
	window.dispatchEvent(new PopStateEvent("popstate"));
}

export default function App(): HTMLElement {
	const root = create("main", "shell");
	const routeHost = create("div");
	let route: AppRoute = parseRoute(window.location.pathname);
	let modalKind: "landing" | "invite" | null = null;
	let inviteDraft: InviteDraft = {
		email: "",
		role: ORGANIZATION_ROLES[0] ?? "Admin",
	};
	let invites: InviteDraft[] = [];

	function syncRoute() {
		route = parseRoute(window.location.pathname);
		renderPage();
	}

	function renderHeader() {
		const header = create("header", "masthead");
		const copy = create("div");
		copy.append(
			create("p", "eyebrow", "Festival Organization Onboarding"),
			create("h1", undefined, "Set up your festival organization workspace."),
			create(
				"p",
				"lede",
				"Create an organization, invite team members, or accept an invite using mock UI-only flows.",
			),
		);
		header.append(copy);
		root.append(header, routeHost);
	}

	function closeModal() {
		modalKind = null;
		if (route.kind === "home") {
			navigate("/");
			return;
		}
		renderPage();
	}

	function renderModal() {
		if (!modalKind) {
			return;
		}

		const backdrop = create("div", "modal-backdrop");
		backdrop.setAttribute("role", "presentation");
		const modal = create("section", "modal-card");
		modal.setAttribute("role", "dialog");
		modal.setAttribute("aria-modal", "true");
		modal.append(
			create(
				"h3",
				undefined,
				modalKind === "invite"
					? "Accept Invite / Sign Up"
					: "Sign up / Create Organization",
			),
		);

		if (modalKind === "invite") {
			modal.append(field("Full Name", textInput("text", "Your full name")));
		}

		const continuePath =
			modalKind === "invite" ? MOCK_ORG_PATH : "/create-organization";
		const actions = create("div", "modal-actions");
		actions.append(
			button("Continue with Google", () => {
				modalKind = null;
				navigate(continuePath);
			}),
			button(
				"Continue with Email",
				() => {
					modalKind = null;
					navigate(continuePath);
				},
				"secondary-button",
			),
		);
		modal.append(actions, button("Cancel", closeModal, "link-button"));
		backdrop.append(modal);
		routeHost.append(backdrop);
	}

	function renderLanding() {
		const panel = create("section", "panel hero-panel");
		panel.setAttribute("aria-label", "No organization landing");
		panel.append(
			create("h2", undefined, "Welcome to Festival"),
			create(
				"p",
				undefined,
				"Start by creating an organization for your festival administration team.",
			),
		);
		const actions = create("div", "hero-actions");
		actions.append(
			button("Sign up / Create Organization", () => {
				modalKind = "landing";
				renderPage();
			}),
		);
		panel.append(actions);
		routeHost.append(panel);
	}

	function renderCreateOrganization() {
		const formPanel = create("section", "panel flow-panel");
		formPanel.setAttribute("aria-label", "Create organization");
		formPanel.append(
			create("h2", undefined, "Create Organization"),
			field(
				"Organization Name",
				textInput("text", MOCK_ORG_NAME),
				"Name: max 255 chars",
			),
			field(
				"Short Name",
				textInput("text", "second-festival"),
				"Short name: max 6 chars",
				"Allowed: [A-Za-z0-9-]",
			),
		);

		const invitePanel = create("section", "panel flow-panel");
		invitePanel.setAttribute("aria-label", "Invite Members");
		const roleSelect = create("select");
		for (const role of ORGANIZATION_ROLES) {
			const option = create("option");
			option.value = role;
			option.textContent = role;
			roleSelect.append(option);
		}
		roleSelect.value = inviteDraft.role;
		roleSelect.addEventListener("input", () => {
			inviteDraft = { ...inviteDraft, role: roleSelect.value };
		});

		const stackActions = create("div", "stack-actions");
		stackActions.append(
			button("Add Invite", () => {
				invites = [
					...invites,
					{
						email: inviteDraft.email || "member@example.com",
						role: inviteDraft.role,
					},
				];
				inviteDraft = {
					email: "",
					role: ORGANIZATION_ROLES[0] ?? "Admin",
				};
				renderPage();
			}),
			button("Create Organization", () => navigate(MOCK_ORG_PATH)),
		);

		invitePanel.append(
			create("h3", undefined, "Invite Members"),
			field(
				"Email",
				textInput("email", "member@example.com", (value) => {
					inviteDraft = { ...inviteDraft, email: value };
				}),
			),
			field("Role", roleSelect),
			stackActions,
		);

		if (invites.length > 0) {
			const list = create("ul", "invite-list");
			list.setAttribute("aria-label", "Added invites");
			for (const invite of invites) {
				const item = create("li");
				item.append(
					create("strong", undefined, invite.email),
					create("span", undefined, invite.role),
				);
				list.append(item);
			}
			invitePanel.append(list);
		}

		routeHost.append(formPanel, invitePanel);
	}

	function renderInvite() {
		const panel = create("section", "panel flow-panel");
		panel.setAttribute("aria-label", "Invite landing");
		const summary = create("div", "invite-summary");
		const orgLine = create("div");
		orgLine.append(
			create("strong", undefined, "Organization Name:"),
			document.createTextNode(` ${MOCK_ORG_NAME}`),
		);
		const roleLine = create("div");
		roleLine.append(
			create("strong", undefined, "Role:"),
			document.createTextNode(` ${MOCK_ROLE}`),
		);
		summary.append(orgLine, roleLine);
		panel.append(
			create("h2", undefined, "Accept Organization Invite"),
			summary,
			button("Accept Invite / Sign Up", () => {
				modalKind = "invite";
				renderPage();
			}),
		);
		routeHost.append(panel);
	}

	function renderOrganization() {
		const slug = route.kind === "org" ? route.slug : "second-festival";
		const panel = create("section", "panel org-shell");
		panel.setAttribute("aria-label", "Organization landing");
		const header = create("header", "org-header");
		header.append(
			button(MOCK_ORG_NAME, () => navigate(buildOrgPath(slug)), "org-title"),
			button("Logout", () => undefined, "secondary-button"),
		);
		panel.append(
			header,
			create(
				"p",
				"org-copy",
				`Welcome to ${MOCK_ORG_NAME}, you are ${MOCK_ROLE} role`,
			),
		);
		routeHost.append(panel);
	}

	function renderPage() {
		routeHost.replaceChildren();
		switch (route.kind) {
			case "create-org":
				renderCreateOrganization();
				break;
			case "invite":
				renderInvite();
				break;
			case "org":
				renderOrganization();
				break;
			case "home":
				renderLanding();
				break;
		}
		renderModal();
	}

	window.addEventListener("popstate", syncRoute);
	renderHeader();
	renderPage();

	return root;
}
