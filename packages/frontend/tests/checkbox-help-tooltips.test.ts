import { describe, expect, it } from "bun:test";
import * as helpTooltipModule from "../src/components/HelpTooltip.js";

const { CHECKBOX_HELP_TEXT, HelpTooltip } = helpTooltipModule;

async function readSource(relativePath: string): Promise<string> {
	return Bun.file(new URL(relativePath, import.meta.url)).text();
}

const helpTooltipSource = await readSource("../src/components/HelpTooltip.tsx");
const membershipPageSource = await readSource(
	"../src/pages/MembershipPage.tsx",
);
const accompanistPageSource = await readSource(
	"../src/pages/AccompanistMembershipPage.tsx",
);
const teacherDirectoryCardSource = await readSource(
	"../src/pages/CustomerTeacherDirectoryCard.tsx",
);
const waitlistCardSource = await readSource(
	"../src/components/FestivalWaitlistCard.tsx",
);
const dropModalSource = await readSource(
	"../src/pages/CustomerDropRegistrationModal.tsx",
);
const childrenPageSource = await readSource(
	"../src/pages/CustomerChildrenPage.tsx",
);
const registrationContextSource = await readSource(
	"../src/components/FestivalRegistrationContext.tsx",
);
const accountClassesPageSource = await readSource(
	"../src/pages/CustomerAccountClassesPage.tsx",
);
const concertoTitleFieldSource = await readSource(
	"../src/components/ConcertoTitleField.tsx",
);
const purchasedEditorSource = await readSource(
	"../src/pages/PurchasedRegistrationEditor.tsx",
);
const transferModalSource = await readSource(
	"../src/pages/CustomerTransferRegistrationModal.tsx",
);

function assertNoTooltipInsideLabel(source: string): void {
	const labels = source.match(/<label\b[^>]*>[\s\S]*?<\/label>/g) ?? [];
	expect(labels.length).toBeGreaterThan(0);
	for (const labelBlock of labels) {
		expect(labelBlock).not.toContain("<HelpTooltip");
	}
}

function assertCheckboxHelpRowHasTooltip(
	source: string,
	helpTextKey: keyof typeof CHECKBOX_HELP_TEXT,
): void {
	expect(source).toContain('class="checkbox-help-row"');
	const rowPattern = new RegExp(
		`class="checkbox-help-row"[\\s\\S]*?<\\/label>[\\s\\S]*?<HelpTooltip[\\s\\S]*?CHECKBOX_HELP_TEXT\\.${helpTextKey}`,
	);
	expect(source).toMatch(rowPattern);
	assertNoTooltipInsideLabel(source);
}

function assertCustomerHelpTooltipWired(
	source: string,
	importPath: string,
	helpTextKey: string,
): void {
	const escapedPath = importPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	expect(source).toMatch(
		new RegExp(
			`import\\s*\\{[\\s\\S]*\\bHelpTooltip\\b[\\s\\S]*\\}\\s*from\\s*"${escapedPath}"`,
		),
	);
	expect(source).toMatch(
		new RegExp(
			`import\\s*\\{[\\s\\S]*\\bCUSTOMER_HELP_TEXT\\b[\\s\\S]*\\}\\s*from\\s*"${escapedPath}"`,
		),
	);
	expect(source).toMatch(
		new RegExp(`<HelpTooltip[\\s\\S]*?CUSTOMER_HELP_TEXT\\.${helpTextKey}`),
	);
	assertNoTooltipInsideLabel(source);
}

describe("HelpTooltip component and CHECKBOX_HELP_TEXT", () => {
	it("exports HelpTooltip component function", () => {
		expect(typeof HelpTooltip).toBe("function");
	});

	it("defines accurate privacy copy in CHECKBOX_HELP_TEXT", () => {
		const membershipText = CHECKBOX_HELP_TEXT.membershipDataConsent;
		expect(membershipText.trim().length).toBeGreaterThan(0);
		expect(membershipText).toMatch(/shopify/i);
		expect(membershipText).toMatch(/contact/i);
		expect(membershipText).toMatch(/staff/i);
		expect(membershipText).toMatch(/payment|card/i);
		expect(membershipText).toMatch(/never|not/i);

		const waitlistText = CHECKBOX_HELP_TEXT.waitlistDataConsent;
		expect(waitlistText.trim().length).toBeGreaterThan(0);
		expect(waitlistText).toMatch(/staff/i);
		expect(waitlistText).toMatch(/contact/i);
		expect(waitlistText).toMatch(/waitlist/i);

		const directoryText = CHECKBOX_HELP_TEXT.publicDirectoryPublishing;
		expect(directoryText.trim().length).toBeGreaterThan(0);
		expect(directoryText).toMatch(/optional/i);
		expect(directoryText).toMatch(/display name|name/i);
		expect(directoryText).toMatch(/\bdivision\b/i);
		expect(directoryText).not.toMatch(/approved divisions/i);
		expect(directoryText).toMatch(/email/i);
		expect(directoryText).toMatch(/phone/i);
		expect(directoryText).toMatch(/never|not/i);
		expect(directoryText).toMatch(/anytime|any time|change|account/i);
	});

	it("exports CUSTOMER_HELP_TEXT with accurate copy for all 6 customer help tooltips", () => {
		const customerHelpText = (
			helpTooltipModule as { CUSTOMER_HELP_TEXT?: Record<string, string> }
		).CUSTOMER_HELP_TEXT;
		expect(customerHelpText).toBeDefined();

		const dropRefund = customerHelpText?.dropRefundRequest ?? "";
		expect(dropRefund).toMatch(/refund request/i);
		expect(dropRefund).toMatch(/review/i);
		expect(dropRefund).toMatch(/not automatic/i);

		const ageVerification = customerHelpText?.ageVerification ?? "";
		expect(ageVerification).toMatch(/privacy/i);
		expect(ageVerification).toMatch(/cutoff date/i);
		expect(ageVerification).toMatch(/without storing/i);
		expect(ageVerification).toMatch(/birth date/i);
		expect(ageVerification).toMatch(/permanently/i);

		const paidWaitlist = customerHelpText?.paidWaitlist ?? "";
		expect(paidWaitlist).toMatch(/payment succeeded/i);
		expect(paidWaitlist).toMatch(/paid waitlist/i);
		expect(paidWaitlist).toMatch(/promote/i);
		expect(paidWaitlist).toMatch(/refund/i);

		const accompanistDivisions = customerHelpText?.accompanistDivisions ?? "";
		expect(accompanistDivisions).toMatch(/divisions/i);
		expect(accompanistDivisions).toMatch(/available to accompany/i);
		expect(accompanistDivisions).toMatch(/choose[\s\S]*accompanist/i);

		const concertoCatalog = customerHelpText?.concertoCatalog ?? "";
		expect(concertoCatalog).toMatch(/concerto/i);
		expect(concertoCatalog).toMatch(/approved work/i);
		expect(concertoCatalog).toMatch(/catalog/i);
		expect(concertoCatalog).toMatch(/contact[\s\S]*festival office/i);

		const transferClass = customerHelpText?.transferClass ?? "";
		expect(transferClass).toMatch(/eligible class/i);
		expect(transferClass).toMatch(/repertoire/i);
		expect(transferClass).toMatch(/accompanist/i);
		expect(transferClass).toMatch(/fee difference/i);
	});

	it("implements accessible tooltip semantics and dismissal handlers in HelpTooltip.tsx", () => {
		expect(helpTooltipSource).toContain('role="tooltip"');
		expect(helpTooltipSource).toContain("aria-describedby");
		expect(helpTooltipSource).toContain("aria-label");
		expect(helpTooltipSource).toContain("Escape");
		expect(helpTooltipSource).toContain("pointerdown");
	});
});

describe("customer checkbox help tooltip wiring", () => {
	it("wires HelpTooltip into MembershipPage for both consent and public directory checkboxes", () => {
		expect(membershipPageSource).toMatch(
			/import\s*\{[\s\S]*\bHelpTooltip\b[\s\S]*\}\s*from\s*"\.\.\/components\/HelpTooltip\.js"/,
		);
		expect(membershipPageSource).toContain("CHECKBOX_HELP_TEXT");
		assertCheckboxHelpRowHasTooltip(
			membershipPageSource,
			"membershipDataConsent",
		);
		assertCheckboxHelpRowHasTooltip(
			membershipPageSource,
			"publicDirectoryPublishing",
		);
		expect(membershipPageSource).toMatch(
			/List my name and division in the Public Teacher\s+Directory/,
		);
		expect(membershipPageSource).not.toMatch(/approved divisions/i);
	});

	it("wires HelpTooltip into AccompanistMembershipPage for public directory checkbox and divisions", () => {
		expect(accompanistPageSource).toMatch(
			/import\s*\{[\s\S]*\bHelpTooltip\b[\s\S]*\}\s*from\s*"\.\.\/components\/HelpTooltip\.js"/,
		);
		expect(accompanistPageSource).toContain("CHECKBOX_HELP_TEXT");
		assertCheckboxHelpRowHasTooltip(
			accompanistPageSource,
			"publicDirectoryPublishing",
		);
		assertCustomerHelpTooltipWired(
			accompanistPageSource,
			"../components/HelpTooltip.js",
			"accompanistDivisions",
		);
	});

	it("wires HelpTooltip into CustomerTeacherDirectoryCard for public directory checkbox", () => {
		expect(teacherDirectoryCardSource).toMatch(
			/import\s*\{[\s\S]*\bHelpTooltip\b[\s\S]*\}\s*from\s*"\.\.\/components\/HelpTooltip\.js"/,
		);
		expect(teacherDirectoryCardSource).toContain("CHECKBOX_HELP_TEXT");
		assertCheckboxHelpRowHasTooltip(
			teacherDirectoryCardSource,
			"publicDirectoryPublishing",
		);
	});

	it("wires HelpTooltip into FestivalWaitlistCard for waitlist consent checkbox", () => {
		expect(waitlistCardSource).toMatch(
			/import\s*\{[\s\S]*\bHelpTooltip\b[\s\S]*\}\s*from\s*"\.\/HelpTooltip\.js"/,
		);
		expect(waitlistCardSource).toContain("CHECKBOX_HELP_TEXT");
		assertCheckboxHelpRowHasTooltip(waitlistCardSource, "waitlistDataConsent");
	});
});

describe("customer help tooltip wiring", () => {
	it("wires dropRefundRequest tooltip in CustomerDropRegistrationModal", () => {
		assertCustomerHelpTooltipWired(
			dropModalSource,
			"../components/HelpTooltip.js",
			"dropRefundRequest",
		);
	});

	it("wires ageVerification tooltip in CustomerChildrenPage and FestivalRegistrationContext", () => {
		assertCustomerHelpTooltipWired(
			childrenPageSource,
			"../components/HelpTooltip.js",
			"ageVerification",
		);
		assertCustomerHelpTooltipWired(
			registrationContextSource,
			"./HelpTooltip.js",
			"ageVerification",
		);
	});

	it("wires paidWaitlist tooltip in CustomerAccountClassesPage", () => {
		assertCustomerHelpTooltipWired(
			accountClassesPageSource,
			"../components/HelpTooltip.js",
			"paidWaitlist",
		);
	});

	it("wires concertoCatalog tooltip in ConcertoTitleField and PurchasedRegistrationEditor", () => {
		assertCustomerHelpTooltipWired(
			concertoTitleFieldSource,
			"./HelpTooltip.js",
			"concertoCatalog",
		);
		assertCustomerHelpTooltipWired(
			purchasedEditorSource,
			"../components/HelpTooltip.js",
			"concertoCatalog",
		);
	});

	it("wires transferClass tooltip in CustomerTransferRegistrationModal", () => {
		assertCustomerHelpTooltipWired(
			transferModalSource,
			"../components/HelpTooltip.js",
			"transferClass",
		);
	});
});
