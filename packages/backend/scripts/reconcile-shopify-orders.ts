function organizationIdFromArgs(args: string[]): string {
	if (args.length !== 2 || args[0] !== "--organization") {
		throw new Error(
			"Usage: bun run reconcile:shopify-orders -- --organization <organization-id>",
		);
	}
	const organizationId = args[1]?.trim() ?? "";
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			organizationId,
		)
	) {
		throw new Error("The reconciliation organization ID is invalid.");
	}
	return organizationId;
}

function privateApiOrigin(): string {
	const value = process.env.FESTIVAL_RECONCILIATION_ORIGIN?.trim();
	if (!value) {
		throw new Error("FESTIVAL_RECONCILIATION_ORIGIN is required.");
	}
	const url = new URL(value);
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.pathname !== "/" ||
		url.search ||
		url.hash ||
		!new Set(["localhost", "127.0.0.1", "backend"]).has(url.hostname)
	) {
		throw new Error(
			"FESTIVAL_RECONCILIATION_ORIGIN must be a private backend origin.",
		);
	}
	return url.origin;
}

const organizationId = organizationIdFromArgs(Bun.argv.slice(2));
const token = process.env.FESTIVAL_RECONCILIATION_TOKEN?.trim();
if (!token || token.length < 32) {
	throw new Error(
		"FESTIVAL_RECONCILIATION_TOKEN must contain at least 32 characters.",
	);
}

const response = await fetch(
	`${privateApiOrigin()}/api/internal/reconcile/shopify-orders`,
	{
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Festival-Reconciliation-Token": token,
		},
		body: JSON.stringify({ organizationId }),
	},
);
if (!response.ok) {
	throw new Error("Shopify order reconciliation request failed.");
}
const result = (await response.json()) as {
	discoveredCount?: unknown;
	processedCount?: unknown;
};
if (
	typeof result.discoveredCount !== "number" ||
	typeof result.processedCount !== "number"
) {
	throw new Error("Shopify order reconciliation response was invalid.");
}
console.log(
	JSON.stringify({
		organizationId,
		discoveredCount: result.discoveredCount,
		processedCount: result.processedCount,
	}),
);
