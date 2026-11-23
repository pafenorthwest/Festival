import { describe, expect, it } from "bun:test";

const policy = await Bun.file(
	new URL("../src/pages/PrivacyPolicyPage.tsx", import.meta.url),
).text();

// JSX line breaks split sentences across lines, so compare on single spaces.
const text = policy.replace(/\s+/g, " ");

describe("privacy policy", () => {
	it("discloses usage metrics used for performance and capacity planning", () => {
		expect(text).toContain("<h2>Usage metrics</h2>");
		expect(text).toContain("monitor performance and plan capacity");
		expect(text).toContain("We do not use it for advertising");
	});

	it("describes the public directory, who is listed, and what it never shows", () => {
		expect(text).toContain("<h2>Public teacher and accompanist directory</h2>");
		expect(text).toContain(
			"your role (teacher or accompanist), and your approved divisions while your membership is active",
		);
		expect(text).toContain(
			"never shows your email address, phone number, city, or mailing address",
		);
		// Expired or revoked members are not listed, so the policy must not imply
		// that an inactive membership stays visible.
		expect(text).not.toContain("whether your membership is active");
	});

	it("says the listing box is checked by default and when it can be changed", () => {
		expect(text).toContain("Listing is optional");
		expect(text).toContain("checked by default when you sign up");
		expect(text).toContain("during sign-up or at any time in your account");
	});

	it("explains staff access to contact details from both Festival forms and Shopify", () => {
		expect(text).toContain("Festival staff who manage memberships");
		expect(text).toContain(
			"contact details you submit on Festival forms or agree to share from Shopify",
		);
		// $0 accompanist sign-up has no consent checkbox, so consent cannot be assumed.
		expect(text).not.toContain("when you agree to share them");
		expect(text).toContain(
			"The record does not include the contact details themselves",
		);
	});
});
