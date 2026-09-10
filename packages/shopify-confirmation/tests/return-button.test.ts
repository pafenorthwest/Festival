import { describe, expect, it } from "bun:test";
import {
	festivalAccountReturnUrl,
	mountReturnButton,
} from "../extensions/festival-account-return/src/return-button.js";

// Minimal host DOM: tests execute the actual renderer, including editor updates.
class Element {
	children: Element[] = [];
	attributes: Record<string, string> = {};
	textContent = "";
	removed = false;
	constructor(readonly tagName: string) {}
	appendChild(child: Element) {
		this.children.push(child);
	}
	replaceChildren(...children: Element[]) {
		this.children = children;
	}
	setAttribute(key: string, value: string) {
		this.attributes[key] = value;
	}
	remove() {
		this.removed = true;
	}
}
function fixture(value: Record<string, unknown>, editor = false) {
	const body = new Element("body");
	let subscriber: (() => void) | undefined;
	let unsubscribed = false;
	const settings = {
		value,
		subscribe(callback: () => void) {
			subscriber = callback;
			return () => {
				unsubscribed = true;
			};
		},
	};
	const dispose = mountReturnButton(
		{
			body,
			createElement: (tag: string) => new Element(tag),
		} as unknown as Document,
		settings,
		editor,
	);
	return {
		body,
		dispose,
		unsubscribed: () => unsubscribed,
		update(next: Record<string, unknown>) {
			settings.value = next;
			subscriber?.();
		},
	};
}

describe("Shopify confirmation return", () => {
	it("renders the exact label and tenant account handoff, without customer selectors", () => {
		const f = fixture({ organization_slug: "pafe" });
		const button = f.body.children[0].children[0];
		expect(button.tagName).toBe("s-button");
		expect(button.textContent).toBe("Return to Festival account");
		expect(button.attributes).toEqual({
			href: "https://festival.passmore.xyz/org/pafe/account?checkout=processing",
			variant: "primary",
		});
	});
	it("uses the configured deployment and organization without leaking another tenant", () => {
		expect(
			festivalAccountReturnUrl({
				festival_origin: "https://festival.example.com/",
				organization_slug: "north-west",
			}),
		).toBe(
			"https://festival.example.com/org/north-west/account?checkout=processing",
		);
	});
	it.each([
		undefined,
		"",
		"../other",
		"pafe/account",
		"pafe?admin=1",
		"pafe#other",
		"pafe%2Fother",
		" pafe ",
		7,
	])("does not render for invalid organization %p", (slug) => {
		expect(
			fixture({ organization_slug: slug }).body.children[0].children,
		).toEqual([]);
	});
	it.each([
		"http://festival.example.com",
		"javascript:alert(1)",
		"https://user:pass@festival.example.com",
		"https://festival.example.com/path",
		"https://festival.example.com/?token=secret",
		"https://festival.example.com/#other",
		"not a URL",
	])("rejects invalid origin %s", (origin) => {
		expect(
			festivalAccountReturnUrl({
				organization_slug: "pafe",
				festival_origin: origin,
			}),
		).toBeNull();
	});
	it("shows configuration guidance only to the editor and updates the button as settings change", () => {
		const f = fixture({}, true);
		expect(f.body.children[0].children[0].tagName).toBe("s-text");
		f.update({ organization_slug: "pafe" });
		expect(f.body.children[0].children).toHaveLength(1);
		expect(f.body.children[0].children[0].tagName).toBe("s-button");
		f.update({ organization_slug: "north" });
		expect(f.body.children[0].children[0].attributes.href).toContain(
			"/org/north/account",
		);
		f.dispose();
		expect(f.unsubscribed()).toBe(true);
		expect(f.body.children[0].removed).toBe(true);
	});
	it("configures only the Thank you and Order status targets with no network or API access", async () => {
		const config = Bun.TOML.parse(
			await Bun.file(
				new URL(
					"../extensions/festival-account-return/shopify.extension.toml",
					import.meta.url,
				),
			).text(),
		) as {
			api_version: string;
			extensions: Array<{
				targeting: Array<{ target: string; module: string }>;
				capabilities: Record<string, boolean>;
			}>;
		};
		expect(config.api_version).toBe("2026-07");
		expect(config.extensions[0].targeting.map((entry) => entry.target)).toEqual(
			[
				"purchase.thank-you.block.render",
				"customer-account.order-status.block.render",
			],
		);
		expect(config.extensions[0].capabilities).toEqual({
			api_access: false,
			network_access: false,
		});
	});
});
