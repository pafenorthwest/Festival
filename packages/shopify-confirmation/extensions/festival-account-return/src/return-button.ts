export const RETURN_BUTTON_LABEL = "Return to Festival account";
const DEFAULT_ORIGIN = "https://festival.passmore.xyz";

export function festivalAccountReturnUrl(
	settings: Record<string, unknown>,
): string | null {
	const slug = settings.organization_slug;
	if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
		return null;
	const origin = settings.festival_origin || DEFAULT_ORIGIN;
	if (typeof origin !== "string") return null;
	try {
		const url = new URL(origin);
		if (
			url.protocol !== "https:" ||
			url.username ||
			url.password ||
			url.pathname !== "/" ||
			url.search ||
			url.hash
		)
			return null;
		return `${url.origin}/org/${slug}/account?checkout=processing`;
	} catch {
		return null;
	}
}

interface SettingsSignal {
	readonly value: Record<string, unknown>;
	subscribe(callback: (value: Record<string, unknown>) => void): () => void;
}

export function mountReturnButton(
	document: Document,
	settings: SettingsSignal,
	isEditor: boolean,
): () => void {
	const container = document.createElement("s-stack");
	document.body.appendChild(container);
	const update = () => {
		const href = festivalAccountReturnUrl(settings.value);
		if (!href) {
			container.replaceChildren();
			if (isEditor) {
				const message = document.createElement("s-text");
				message.textContent =
					"Set a valid Festival HTTPS origin and organization slug to enable the return button.";
				container.appendChild(message);
			}
			return;
		}
		const button = document.createElement("s-button");
		button.setAttribute("href", href);
		button.setAttribute("variant", "primary");
		button.textContent = RETURN_BUTTON_LABEL;
		container.replaceChildren(button);
	};
	update();
	const unsubscribe = settings.subscribe(update);
	return () => {
		unsubscribe();
		container.remove();
	};
}
