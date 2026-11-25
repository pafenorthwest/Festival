import {
	authHeaders,
	computeMetricStats,
	computeScenarioIndexRanges,
	countStepErrors,
	renderScenarioSummary,
	type ScenarioConfig,
	type ScenarioResult,
	type StepResult,
	statsFromResults,
} from "./perf-scenario-helpers.js";

const STEP_LABELS = [
	"Step 1: GET /organizations",
	"Step 2: GET /landing",
	"Step 3: GET /directory/profiles",
	"Step 4: GET /membership-products",
	"Step 5: Session & Membership",
	"Step 6: POST /customer/children",
	"Step 7: GET /registration/teachers",
	"Step 8: Catalog & Eligible Classes",
	"Step 9: POST /registration/eligibility",
	"Step 10: Registration & Checkout State",
] as const;

type HeadersMap = Record<string, string>;

async function sendExpected(
	url: string,
	opts: { method?: string; headers?: HeadersMap; body?: string },
	label: string,
	expectedStatus: number,
	parseJson = false,
): Promise<{ step: StepResult; json?: unknown }> {
	const t0 = performance.now();
	try {
		const res = await fetch(url, {
			method: opts.method ?? "GET",
			headers: opts.headers,
			body: opts.body,
		});
		let json: unknown;
		let errorSnippet: string | undefined;
		if (res.status !== expectedStatus) {
			const text = await res.text().catch(() => "");
			errorSnippet = text.trim().slice(0, 160).replace(/\r?\n/g, " ");
		} else if (parseJson) {
			json = await res.json().catch(() => null);
		} else {
			await res.body?.cancel().catch(() => undefined);
		}
		return {
			step: {
				label,
				status: res.status,
				expectedStatus,
				latencyMs: performance.now() - t0,
				errorSnippet,
			},
			json,
		};
	} catch (err) {
		return {
			step: {
				label,
				status: 0,
				expectedStatus,
				latencyMs: performance.now() - t0,
				errorSnippet: err instanceof Error ? err.message : String(err),
			},
		};
	}
}

async function runUserJourney(
	cfg: ScenarioConfig,
	idx: number,
	buckets: StepResult[][],
): Promise<{ durationMs: number; finalStatus: number }> {
	const id = String(idx).padStart(4, "0");
	const pub: HeadersMap = { Origin: cfg.origin, Accept: "application/json" };
	const sess: HeadersMap = {
		...pub,
		Cookie: `festival_customer_session=perf-sess-${id}`,
	};
	const mut = authHeaders(cfg, idx);
	const org = `${cfg.baseUrl}/api/organizations/${cfg.slug}`;
	const reg = `${org}/customer/festivals/${cfg.festival}/registration`;
	const get = async (
		b: number,
		url: string,
		headers: HeadersMap,
		label: string,
		parseJson = false,
	) => {
		const res = await sendExpected(url, { headers }, label, 200, parseJson);
		buckets[b]?.push(res.step);
		return res;
	};
	const post = async (
		b: number,
		url: string,
		body: unknown,
		label: string,
		expected: number,
		parseJson = false,
	) => {
		const opts = { method: "POST", headers: mut, body: JSON.stringify(body) };
		const res = await sendExpected(url, opts, label, expected, parseJson);
		buckets[b]?.push(res.step);
		return res;
	};

	const t0 = performance.now();
	await get(0, `${cfg.baseUrl}/api/organizations`, pub, "GET /organizations");
	await get(1, `${org}/landing`, pub, "GET /landing");
	const dirUrl = `${cfg.baseUrl}/api/org-info/${cfg.slug}/directory/profiles`;
	await get(2, dirUrl, pub, "GET /directory/profiles");
	await get(3, `${org}/membership-products`, pub, "GET /membership-products");

	await get(4, `${org}/customer/session`, sess, "GET /customer/session");
	const memUrl = `${org}/customer/membership-status`;
	await get(4, memUrl, sess, "GET /customer/membership-status");

	const childBody = {
		displayName: `Perf Venue Child ${idx}`,
		birthday: "2015-05-15",
	};
	const childRes = await post(
		5,
		`${org}/customer/children`,
		childBody,
		"POST /customer/children",
		201,
		true,
	);
	const childId =
		(childRes.json as { child?: { id?: string } } | null)?.child?.id ||
		`perf-child-${id}`;

	const cQ = encodeURIComponent(childId);
	const dQ = encodeURIComponent(cfg.divisionId);
	const tUrl = `${reg}/teachers?childId=${cQ}&divisionId=${dQ}`;
	const teacherRes = await get(6, tUrl, sess, "GET /teachers", true);
	const teacherId =
		(teacherRes.json as { teachers?: Array<{ id?: string }> } | null)
			?.teachers?.[0]?.id || "perf-cust-teacher-01";
	const tQ = encodeURIComponent(teacherId);

	const elUrl = `${reg}/eligible-classes?childId=${cQ}&divisionId=${dQ}&teacherId=${tQ}`;
	await get(7, elUrl, sess, "GET /eligible-classes");
	await get(7, `${reg}/concerto-catalog?q=Mozart`, sess, "GET /concerto");
	await get(7, `${reg}/accompanists`, sess, "GET /accompanists");

	const eligBody = {
		items: [{ childId, festivalClassId: cfg.openClassId, teacherId }],
	};
	await post(8, `${reg}/eligibility`, eligBody, "POST /eligibility", 200);

	await get(9, `${reg}/class-registrations`, sess, "GET /class-registrations");
	await get(9, `${org}/customer/pending-checkout`, sess, "GET /pending");
	const restart = await get(9, `${reg}/checkout/restart`, sess, "GET /restart");

	return {
		durationMs: performance.now() - t0,
		finalStatus: restart.step.status,
	};
}

export async function runScenario5VenueE2E(
	config: ScenarioConfig,
): Promise<ScenarioResult> {
	const { s5 } = computeScenarioIndexRanges(config.concurrency);
	console.log(
		`\n--- Scenario 5: Venue & Registration E2E Journey (Indices ${s5.start}..${s5.end}) ---`,
	);
	const users = Array.from(
		{ length: config.concurrency },
		(_, i) => s5.start + i,
	);
	const buckets: StepResult[][] = STEP_LABELS.map(() => []);
	const t0 = performance.now();
	const journeys = await Promise.all(
		users.map((idx) => runUserJourney(config, idx, buckets)),
	);
	const totalDurMs = performance.now() - t0;
	const allResults = buckets.flat();
	const sections = [
		...STEP_LABELS.map((name, i) => ({
			name,
			stats: statsFromResults(buckets[i] ?? [], totalDurMs),
		})),
		{
			name: `Overall Venue E2E (${config.concurrency} users)`,
			stats: computeMetricStats(
				journeys.map((j) => j.durationMs),
				journeys.map((j) => j.finalStatus),
				totalDurMs,
			),
		},
	];
	return {
		summary: renderScenarioSummary(
			`Scenario 5: Venue & Registration E2E Journey (${config.concurrency} concurrent)`,
			sections,
			allResults,
		),
		errorCount: countStepErrors(allResults),
	};
}
