import type * as C from "@festival/common";
import { hc } from "hono/client";
import type { RegistrationRoutesType } from "../../../../backend/dist/routes/api-router.js";
import {
	apiPrefix,
	createRpcFetch,
	type RpcRequestOptions,
	resolveAuthToken,
	rpcCall,
} from "./client.js";

export type {
	AdminWaitlistRosterEntryDto,
	CanonicalWork,
	ClassCheckoutRecoveryStatusDto,
	ClassCheckoutRestartDto,
	ClassCheckoutRestartRegistration,
	ClassRegistrationMetadata,
	CustomerClassEntitlementSummary,
	CustomerClassRegistrationItem,
	CustomerClassRegistrationMetadataSummary,
	CustomerClassRegistrationsResponse,
	CustomerFestivalClassSummary,
	CustomerWaitlistEntryDto,
	DropRegistrationInput,
	DropRegistrationResult,
	EvaluateRegistrationEligibilityInput,
	EvaluateRegistrationEligibilityResponse,
	JoinWaitlistInput,
	ProposedPurchaseLineItem,
	RegistrationAccompanistSummary,
	RegistrationChangeLog,
	RegistrationEligibleClass,
	RegistrationTeacherSummary,
	RepertoirePiece,
	StartClassCheckoutInput,
	StartClassCheckoutResponse,
	TransferRegistrationInput,
	TransferRegistrationResult,
	UpdateRegistrationMetadataInput,
	WaitlistJoinResponse,
	WaitlistPromotionResult,
	WaitlistWithdrawResponse,
	WithdrawWaitlistInput,
} from "@festival/common";

const enc = encodeURIComponent;
const fp = (s: string, f: string) => ({
	slug: enc(s),
	festivalShortName: enc(f),
});
const rp = (s: string, r: string) => ({ slug: enc(s), registrationId: enc(r) });
type Args = Record<string, unknown>;
type Ep<M extends "$get" | "$post" | "$patch"> = {
	$path: (a: never) => string;
} & Record<M, (a: never) => Promise<Response>>;
const rGet = <T>(ep: Ep<"$get">, a: Args) =>
	rpcCall<T>(ep.$get(a as never), ep.$path(a as never));
const rPost = <T>(ep: Ep<"$post">, a: Args) =>
	rpcCall<T>(ep.$post(a as never), ep.$path(a as never));
const rPatch = <T>(ep: Ep<"$patch">, a: Args) =>
	rpcCall<T>(ep.$patch(a as never), ep.$path(a as never));

function rpc(
	useApiBase: boolean,
	o?: RpcRequestOptions & { csrf?: string; idem?: string },
) {
	const h: Record<string, string> = {};
	if (o?.csrf) h["X-CSRF-Token"] = o.csrf;
	if (o?.idem) h["Idempotency-Key"] = o.idem;
	return hc<RegistrationRoutesType>(apiPrefix(useApiBase), {
		fetch: createRpcFetch({
			...o,
			extraHeaders: Object.keys(h).length ? h : undefined,
		}),
	}).organizations[":slug"];
}

const cust = (o?: Parameters<typeof rpc>[1]) => rpc(false, o).customer;
const reg = (o?: Parameters<typeof rpc>[1]) =>
	cust(o).festivals[":festivalShortName"].registration;
const adm = (idToken: string | null) =>
	rpc(true, { idToken }).festivals[":festivalShortName"];

function filterArgs(
	param: Record<string, string>,
	childOrParams?: string | Record<string, string | undefined>,
	extra?: Record<string, string | undefined>,
): Args {
	const entries =
		typeof childOrParams === "object" && childOrParams !== null
			? childOrParams
			: { childId: childOrParams, ...extra };
	const query: Record<string, string> = {};
	for (const [k, v] of Object.entries(entries)) if (v) query[k] = v;
	return Object.keys(query).length ? { param, query } : { param };
}

type CheckoutObj = C.StartClassCheckoutInput & {
	csrfToken?: string;
	idempotencyKey?: string;
	items?: C.ProposedPurchaseLineItem[];
};

function parseCheckoutArgs(
	first: string | CheckoutObj,
	second?: string | C.StartClassCheckoutInput,
	third?: string | C.StartClassCheckoutInput,
) {
	const obj = typeof first === "object";
	const raw = (
		obj ? first : typeof second === "string" ? (third ?? {}) : (second ?? {})
	) as CheckoutObj;
	const csrf = obj
		? (raw.csrfToken ?? (typeof second === "string" ? second : ""))
		: first;
	let idem = obj
		? (raw.idempotencyKey ?? (typeof third === "string" ? third : ""))
		: typeof second === "string"
			? second
			: (raw.idempotencyKey ?? "");
	if (!idem.trim() && typeof crypto?.randomUUID === "function")
		idem = crypto.randomUUID();
	const { csrfToken: _c, idempotencyKey: _i, items, ...cleaned } = raw;
	const hasLines = "lineItems" in cleaned;
	return {
		csrf,
		idem,
		body:
			items !== undefined && !hasLines
				? { ...cleaned, lineItems: items }
				: cleaned,
	};
}

function parseEligibilityArgs(
	arg:
		| C.ProposedPurchaseLineItem[]
		| C.EvaluateRegistrationEligibilityInput
		| string,
	second?: C.ProposedPurchaseLineItem[] | string,
) {
	const s = typeof second === "string" ? second : undefined;
	if (typeof arg === "string")
		return { csrf: arg, items: Array.isArray(second) ? second : [] };
	return Array.isArray(arg)
		? { items: arg, csrf: s }
		: { items: arg.items, csrf: arg.csrfToken ?? s };
}

async function runAdminAction<TInput, TResult>(
	action: "drop" | "transfer" | "promote",
	args: [string, string, string, (TInput | string)?, (string | TInput)?],
): Promise<TResult> {
	const [a1, a2, a3, a4, a5] = args;
	const legacy = typeof a4 === "string";
	const raw = legacy ? a5 : a4;
	const token = await resolveAuthToken(
		legacy ? a1 : typeof a5 === "string" ? a5 : undefined,
	);
	return rPost<TResult>(adm(token).registrations[":id"][action], {
		param: {
			...fp(legacy ? a2 : a1, legacy ? a3 : a2),
			id: enc(legacy ? a4 : a3),
		},
		json: typeof raw === "object" && raw !== null ? raw : {},
	});
}

const cp = (s: string, f: string, c: string) => ({
	...fp(s, f),
	classId: enc(c),
});
const wl = (csrf?: string) =>
	cust(csrf ? { csrf } : undefined).festivals[":festivalShortName"].classes[
		":classId"
	].waitlist;
function wlPath(o: {
	slug: string;
	festivalSlug: string;
	classId: string;
	withdraw?: boolean;
}) {
	const param = cp(o.slug, o.festivalSlug, o.classId);
	return (o.withdraw ? wl().withdraw : wl()).$path({ param } as never);
}

export function listRegistrationTeachers(
	slug: string,
	festivalSlug: string,
	childIdOrParams?: string | { childId?: string; divisionId?: string },
	divisionId?: string,
) {
	return rGet<{ teachers: C.RegistrationTeacherSummary[] }>(
		reg().teachers,
		filterArgs(fp(slug, festivalSlug), childIdOrParams, { divisionId }),
	);
}

export function listRegistrationEligibleClasses(
	slug: string,
	festivalSlug: string,
	childIdOrParams?:
		| string
		| { childId?: string; divisionId?: string; teacherId?: string },
	divisionId?: string,
	teacherId?: string,
) {
	return rGet<{ classes: C.RegistrationEligibleClass[] }>(
		reg()["eligible-classes"],
		filterArgs(fp(slug, festivalSlug), childIdOrParams, {
			divisionId,
			teacherId,
		}),
	);
}

export function searchRegistrationConcertoCatalog(
	slug: string,
	festivalSlug: string,
	query: string,
) {
	return rGet<{ works: C.CanonicalWork[] }>(
		reg()["concerto-catalog"],
		filterArgs(fp(slug, festivalSlug), { q: query || undefined }),
	);
}

export function listRegistrationAccompanists(
	slug: string,
	festivalSlug: string,
) {
	return rGet<{ accompanists: C.RegistrationAccompanistSummary[] }>(
		reg().accompanists,
		{ param: fp(slug, festivalSlug) },
	);
}

export function evaluateRegistrationEligibility(
	slug: string,
	festivalSlug: string,
	itemsOrInputOrCsrf:
		| C.ProposedPurchaseLineItem[]
		| C.EvaluateRegistrationEligibilityInput
		| string,
	itemsOrCsrf?: C.ProposedPurchaseLineItem[] | string,
) {
	const { items, csrf } = parseEligibilityArgs(itemsOrInputOrCsrf, itemsOrCsrf);
	return rPost<C.EvaluateRegistrationEligibilityResponse>(
		reg({ csrf }).eligibility,
		{ param: fp(slug, festivalSlug), json: { items } },
	);
}

export function getClassCheckoutRecoveryStatus(
	slug: string,
	festivalSlug: string,
	recoveryReference: string,
	csrfToken: string,
	idempotencyKey: string,
) {
	return rPost<C.ClassCheckoutRecoveryStatusDto>(
		reg({ csrf: csrfToken, idem: idempotencyKey }).checkout.status,
		{
			param: fp(slug, festivalSlug),
			json: { recoveryReference },
		},
	);
}

export function discoverClassCheckoutRestart(
	slug: string,
	festivalSlug: string,
) {
	return rGet<{ recoveryReference: string | null }>(reg().checkout.restart, {
		param: fp(slug, festivalSlug),
	});
}

export function restartClassCheckout(
	slug: string,
	festivalSlug: string,
	recoveryReference: string,
	csrfToken: string,
) {
	return rPost<C.ClassCheckoutRestartDto>(
		reg({ csrf: csrfToken }).checkout.restart,
		{
			param: fp(slug, festivalSlug),
			json: { recoveryReference },
		},
	);
}

export function startClassCheckout(
	slug: string,
	festivalSlug: string,
	csrfTokenOrInput: string | CheckoutObj,
	inputOrToken?: string | C.StartClassCheckoutInput,
	idempotencyKeyOrInput?: string | C.StartClassCheckoutInput,
) {
	const param = fp(slug, festivalSlug);
	const { csrf, idem, body } = parseCheckoutArgs(
		csrfTokenOrInput,
		inputOrToken,
		idempotencyKeyOrInput,
	);
	const ep = reg({ csrf, idem }).checkout;
	return rpcCall<C.StartClassCheckoutResponse>(
		ep.$post({ param } as never, { init: { body: JSON.stringify(body) } }),
		ep.$path({ param } as never),
	);
}

export function listCustomerClassRegistrations(
	slug: string,
	festivalSlug?: string,
	init?: { signal?: AbortSignal },
) {
	return rGet<C.CustomerClassRegistrationsResponse>(
		festivalSlug
			? reg(init)["class-registrations"]
			: cust(init)["class-registrations"],
		{ param: festivalSlug ? fp(slug, festivalSlug) : { slug: enc(slug) } },
	);
}

export function updateRegistrationMetadata(
	slug: string,
	festivalSlug: string,
	registrationId: string,
	csrfTokenOrInput: string | C.UpdateRegistrationMetadataInput,
	inputOrCsrfToken?: C.UpdateRegistrationMetadataInput | string,
) {
	const [csrf, json] =
		typeof csrfTokenOrInput === "string"
			? [
					csrfTokenOrInput,
					(inputOrCsrfToken ?? {}) as C.UpdateRegistrationMetadataInput,
				]
			: [
					typeof inputOrCsrfToken === "string" ? inputOrCsrfToken : undefined,
					csrfTokenOrInput,
				];
	return rPatch<{ metadata: C.ClassRegistrationMetadata }>(
		reg({ csrf })["class-registrations"][":registrationId"].metadata,
		{ param: { ...fp(slug, festivalSlug), ...rp(slug, registrationId) }, json },
	);
}

export function dropCustomerRegistration(
	slug: string,
	registrationId: string,
	input?: Partial<C.DropRegistrationInput>,
) {
	return rPost<C.DropRegistrationResult>(
		cust()["class-registrations"][":registrationId"].drop,
		{ param: rp(slug, registrationId), json: input ?? {} },
	);
}

export function transferCustomerRegistration(
	slug: string,
	registrationId: string,
	input:
		| C.TransferRegistrationInput
		| { targetFestivalClassId: string; reason?: string },
) {
	return rPost<C.TransferRegistrationResult>(
		cust()["class-registrations"][":registrationId"].transfer,
		{ param: rp(slug, registrationId), json: input },
	);
}

export function dropAdminRegistration(
	slugOrToken: string,
	festivalOrSlug: string,
	regIdOrFestival: string,
	inputOrRegId?: Partial<C.DropRegistrationInput> | string,
	tokenOrInput?: string | Partial<C.DropRegistrationInput>,
): Promise<C.DropRegistrationResult> {
	return runAdminAction("drop", [
		slugOrToken,
		festivalOrSlug,
		regIdOrFestival,
		inputOrRegId,
		tokenOrInput,
	]);
}

export function transferAdminRegistration(
	slugOrToken: string,
	festivalOrSlug: string,
	regIdOrFestival: string,
	inputOrRegId?: Partial<C.TransferRegistrationInput> | string,
	tokenOrInput?: string | Partial<C.TransferRegistrationInput>,
): Promise<C.TransferRegistrationResult> {
	return runAdminAction("transfer", [
		slugOrToken,
		festivalOrSlug,
		regIdOrFestival,
		inputOrRegId,
		tokenOrInput,
	]);
}

export function promoteAdminRegistration(
	slugOrToken: string,
	festivalOrSlug: string,
	regIdOrFestival: string,
	inputOrRegId?: { reason?: string } | string,
	tokenOrInput?: string | { reason?: string },
): Promise<C.WaitlistPromotionResult> {
	return runAdminAction("promote", [
		slugOrToken,
		festivalOrSlug,
		regIdOrFestival,
		inputOrRegId,
		tokenOrInput,
	]);
}

export async function getRegistrationChangeLog(
	slugOrToken: string,
	festivalOrSlug: string,
	regIdOrFestival: string,
	idToken?: string,
): Promise<{ changeLogs: C.RegistrationChangeLog[] }> {
	const isLegacy =
		slugOrToken.includes(".") ||
		(Boolean(idToken) && regIdOrFestival.length > 0 && slugOrToken.length > 40);
	const [slug, fest, regId] = isLegacy
		? [festivalOrSlug, regIdOrFestival, idToken ?? ""]
		: [slugOrToken, festivalOrSlug, regIdOrFestival];
	const token = await resolveAuthToken(isLegacy ? slugOrToken : idToken);
	return rGet<{ changeLogs: C.RegistrationChangeLog[] }>(
		adm(token).registrations[":id"]["change-log"],
		{ param: { ...fp(slug, fest), id: enc(regId) } },
	);
}

export function joinClassWaitlist(
	slug: string,
	festivalSlug: string,
	classId: string,
	csrfToken: string,
	input: C.JoinWaitlistInput,
) {
	return rPost<C.WaitlistJoinResponse>(wl(csrfToken), {
		param: cp(slug, festivalSlug, classId),
		json: { ...input, staffAccessConsent: input.staffAccessConsent as true },
	});
}

export function withdrawClassWaitlist(
	slug: string,
	festivalSlug: string,
	classId: string,
	csrfToken: string,
	input: C.WithdrawWaitlistInput,
) {
	return rPost<C.WaitlistWithdrawResponse>(wl(csrfToken).withdraw, {
		param: cp(slug, festivalSlug, classId),
		json: input,
	});
}

export function listClassWaitlistEntries(
	slug: string,
	festivalSlug: string,
	classId: string,
) {
	const param = cp(slug, festivalSlug, classId);
	return rpcCall<{ entries: C.CustomerWaitlistEntryDto[] }>(
		wl().$get({ param } as never, { init: { method: undefined } }),
		wlPath({ slug, festivalSlug, classId }),
	);
}

export function listFestivalWaitlistEntries(
	slug: string,
	festivalSlug: string,
) {
	return rGet<{ entries: C.CustomerWaitlistEntryDto[] }>(
		cust().festivals[":festivalShortName"].waitlist,
		{ param: fp(slug, festivalSlug) },
	);
}

export function getClassWaitlistRoster(
	idToken: string,
	slug: string,
	festivalSlug: string,
	classId: string,
) {
	return rGet<{ roster: C.AdminWaitlistRosterEntryDto[] }>(
		adm(idToken).classes[":classId"].waitlist,
		{ param: cp(slug, festivalSlug, classId) },
	);
}
