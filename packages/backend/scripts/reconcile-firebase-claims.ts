function privateApiOrigin(): string {
	const value = process.env.FESTIVAL_RECONCILIATION_ORIGIN?.trim();
	if (!value) throw new Error("FESTIVAL_RECONCILIATION_ORIGIN is required.");
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

const token = process.env.FESTIVAL_RECONCILIATION_TOKEN?.trim();
if (!token || token.length < 32) {
	throw new Error(
		"FESTIVAL_RECONCILIATION_TOKEN must contain at least 32 characters.",
	);
}

const response = await fetch(
	`${privateApiOrigin()}/api/internal/reconcile/firebase-claims`,
	{
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Festival-Reconciliation-Token": token,
		},
		body: "{}",
	},
);
if (!response.ok) {
	throw new Error("Firebase claims reconciliation request failed.");
}
const result = (await response.json()) as {
	discoveredCount?: unknown;
	processedCount?: unknown;
	failedCount?: unknown;
};
if (
	typeof result.discoveredCount !== "number" ||
	typeof result.processedCount !== "number" ||
	typeof result.failedCount !== "number"
) {
	throw new Error("Firebase claims reconciliation response was invalid.");
}
console.log(JSON.stringify(result));
