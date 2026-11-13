import type * as C from "@festival/common";
import { hc } from "hono/client";
import type {
	CommerceRoutesType,
	OrgAdminRoutesType,
} from "../../../../backend/dist/routes/api-router.js";
import {
	apiPrefix,
	createRpcFetch,
	type RpcRequestOptions,
	resolveAuthToken,
	rpcCall,
} from "./client.js";

export type {
	AdminCheckoutIntent,
	AdminCheckoutIntentListResponse,
	AdminCheckoutRecoveryResult,
	AdminCustomerSearchResponse,
	AdminEntitlementOperationsResponse,
	AdminEntitlementReconcileResponse,
	AdminResolveValidationDecisionInput,
	AdminResolveValidationDecisionResponse,
	AdminRevokeEntitlementInput,
	AdminRevokeEntitlementResponse,
	BillingAdjustment,
	BillingLedgerEntry,
	BillingMismatchRecord,
	CreateBillingAdjustmentPayload,
	CreateMembershipProductInput,
	CreateMembershipProductResponse,
	EntitlementReportFilters,
	EntitlementReportPageRequest,
	EntitlementReportResponse,
	MembershipProductsListResponse,
	MembershipPurchaseSelectionResponse,
	RecoveryCheckoutResult,
	RecoveryReviewDto,
	UpdateMembershipProductInput,
	UpdateMembershipProductResponse,
} from "@festival/common";

const commerceRpc = hc<CommerceRoutesType>("");
const orgCust = commerceRpc.organizations[":slug"].customer;
const orgAdmin = commerceRpc.organizations[":slug"].admin;
const enc = encodeURIComponent;
const sp = (slug: string) => ({ slug: enc(slug) });

function rpcGet<T>() {
	return <A>(
		ep: { $get: (a: A) => Promise<Response>; $path: (a: A) => string },
		args: A,
	) => rpcCall<T>(ep.$get(args), ep.$path(args));
}

function rpcPost<T>() {
	return <A>(
		ep: { $post: (a: A) => Promise<Response>; $path: (a: A) => string },
		args: A,
	) => rpcCall<T>(ep.$post(args), ep.$path(args));
}

function flexGet<T>(
	ep: { $get: (a: never) => Promise<Response>; $path: (a: never) => string },
	args: { param: Record<string, string>; query?: Record<string, string> },
): Promise<T> {
	return rpcCall<T>(ep.$get(args as never), ep.$path(args as never));
}

function commRpc(useApiBase: boolean, opts?: RpcRequestOptions) {
	return hc<CommerceRoutesType>(apiPrefix(useApiBase), {
		fetch: createRpcFetch(opts),
	}).organizations[":slug"];
}

function custRpc(opts?: RpcRequestOptions) {
	return commRpc(false, opts).customer;
}

function adminRpc(
	idToken: string | null,
	opts?: Omit<RpcRequestOptions, "idToken">,
) {
	return commRpc(true, { idToken, ...opts }).admin;
}

function adminCsrf(idToken: string | null) {
	return adminRpc(idToken, {
		extraHeaders: { "X-CSRF-Token": idToken || "admin-csrf" },
	});
}

async function resolvedAdmin(idToken?: string, withCsrf = false) {
	const token = await resolveAuthToken(idToken);
	return withCsrf ? adminCsrf(token) : adminRpc(token);
}

async function resolvedBilling(idToken?: string) {
	return commRpc(true, { idToken: await resolveAuthToken(idToken) }).billing;
}

function resolveDecisionRpc(opts: {
	idToken: string;
	slug: string;
	decisionId: string;
	approve: boolean;
	input: C.AdminResolveValidationDecisionInput;
}): Promise<C.AdminResolveValidationDecisionResponse> {
	const param = { slug: enc(opts.slug), decisionId: enc(opts.decisionId) };
	const dec = adminCsrf(opts.idToken).entitlements.decisions[":decisionId"];
	const json = { ...opts.input, confirmed: opts.input.confirmed as true };
	return rpcPost<C.AdminResolveValidationDecisionResponse>()(
		opts.approve ? dec.approve : dec.decline,
		{ param, json },
	);
}

function buildReportQuery(
	filters: C.EntitlementReportFilters,
	pageRequest: C.EntitlementReportPageRequest,
): Record<string, string> {
	const q: Record<string, string> = {};
	if (filters.search) q.search = filters.search;
	if (filters.entitlementClass) q.entitlementClass = filters.entitlementClass;
	if (filters.status) q.status = filters.status;
	if (filters.divisionId) q.divisionId = filters.divisionId;
	if (pageRequest.page !== undefined) q.page = String(pageRequest.page);
	if (pageRequest.pageSize !== undefined)
		q.pageSize = String(pageRequest.pageSize);
	return q;
}

export function acquireAccompanistMembership(
	slug: string,
	csrfToken: string,
	input: {
		name: string;
		email: string;
		city: string;
		phone: string;
		divisionIds: string[];
		staffAccessConsent: boolean;
	},
) {
	const ep = custRpc({ extraHeaders: { "X-CSRF-Token": csrfToken } })[
		"accompanist-membership"
	];
	return rpcPost<{
		membership: {
			id: string;
			startsOn: string;
			endsOn: string;
			status: string;
		};
	}>()(ep, {
		param: sp(slug),
		json: { ...input, staffAccessConsent: input.staffAccessConsent as true },
	});
}

export function getAccompanistMembershipForm(slug: string) {
	return rpcGet<{
		policy: { policy: "exactly_one" | "one_to_two" | "one_to_all" };
		divisions: C.OrganizationDivision[];
	}>()(custRpc()["accompanist-membership"], { param: sp(slug) });
}

export function resumeCustomerMembershipPurchase(
	slug: string,
	offeringId: string,
) {
	return rpcGet<C.MembershipPurchaseSelectionResponse>()(
		custRpc()["membership-purchase"][":offeringId"],
		{ param: { slug: enc(slug), offeringId: enc(offeringId) } },
	);
}

export function startCustomerCheckout(
	slug: string,
	csrfToken: string,
	offeringId: string,
	divisionId: string,
	staffAccessConsent: boolean,
	idempotencyKey: string,
) {
	const param = sp(slug);
	const ep = custRpc({
		extraHeaders: {
			"X-CSRF-Token": csrfToken,
			"Idempotency-Key": idempotencyKey,
		},
	}).checkout;
	return rpcCall<{ checkoutUrl: string }>(
		ep.$post({
			param,
			json: {
				offeringId,
				divisionId,
				staffAccessConsent: staffAccessConsent as true,
			},
		}),
		orgCust.checkout.$path({ param }),
	);
}

export function getAdminMembershipProducts(idToken: string, slug: string) {
	return rpcGet<C.MembershipProductsListResponse>()(
		adminRpc(idToken)["membership-products"],
		{ param: sp(slug) },
	);
}

export function createMembershipProduct(
	idToken: string,
	slug: string,
	input: C.CreateMembershipProductInput,
) {
	return rpcPost<C.CreateMembershipProductResponse>()(
		adminRpc(idToken)["membership-products"],
		{ param: sp(slug), json: input },
	);
}

export function updateAdminMembershipProduct(
	idToken: string,
	slug: string,
	offeringId: string,
	input: C.UpdateMembershipProductInput,
) {
	return rpcPost<C.UpdateMembershipProductResponse>()(
		adminRpc(idToken)["membership-products"][":offeringId"],
		{
			param: { slug: enc(slug), offeringId: enc(offeringId) },
			json: {
				name: input.name,
				description: input.description,
				price: input.price,
			},
		},
	);
}

export function retireAdminMembershipProduct(
	idToken: string,
	slug: string,
	offeringId: string,
) {
	const param = { slug: enc(slug), offeringId: enc(offeringId) };
	const ep = adminRpc(idToken)["membership-products"][":offeringId"].retire;
	return rpcCall<{ retired: true }>(
		ep.$post({ param, json: { confirmed: true } }),
		orgAdmin["membership-products"][":offeringId"].retire.$path({ param }),
	);
}

export function getAdminEntitlementReport(
	idToken: string,
	slug: string,
	filters: C.EntitlementReportFilters,
	pageRequest: C.EntitlementReportPageRequest,
	init?: { signal?: AbortSignal },
) {
	const param = sp(slug);
	const q = buildReportQuery(filters, pageRequest);
	const ep = hc<OrgAdminRoutesType>(apiPrefix(true), {
		fetch: createRpcFetch({ idToken, signal: init?.signal }),
	}).organizations[":slug"].admin.entitlements;
	return flexGet<C.EntitlementReportResponse>(
		ep,
		Object.keys(q).length > 0 ? { param, query: q } : { param },
	);
}

export function getAdminEntitlementOperations(
	idToken: string,
	slug: string,
	init?: { signal?: AbortSignal },
): Promise<C.AdminEntitlementOperationsResponse> {
	return rpcGet<C.AdminEntitlementOperationsResponse>()(
		adminRpc(idToken, { signal: init?.signal }).entitlements.operations,
		{ param: sp(slug) },
	);
}

export function triggerAdminEntitlementReconciliation(
	idToken: string,
	slug: string,
): Promise<C.AdminEntitlementReconcileResponse> {
	return rpcPost<C.AdminEntitlementReconcileResponse>()(
		adminCsrf(idToken).entitlements.reconcile,
		{ param: sp(slug) },
	);
}

export function declineAdminValidationDecision(
	idToken: string,
	slug: string,
	decisionId: string,
	input: C.AdminResolveValidationDecisionInput,
): Promise<C.AdminResolveValidationDecisionResponse> {
	return resolveDecisionRpc({
		idToken,
		slug,
		decisionId,
		approve: false,
		input,
	});
}

export function approveAdminValidationDecision(
	idToken: string,
	slug: string,
	decisionId: string,
	input: C.AdminResolveValidationDecisionInput,
): Promise<C.AdminResolveValidationDecisionResponse> {
	return resolveDecisionRpc({
		idToken,
		slug,
		decisionId,
		approve: true,
		input,
	});
}

export function revokeAdminEntitlement(
	idToken: string,
	slug: string,
	entitlementId: string,
	input: C.AdminRevokeEntitlementInput,
): Promise<C.AdminRevokeEntitlementResponse> {
	const ep = adminCsrf(idToken).entitlements[":entitlementId"].revoke;
	return rpcPost<C.AdminRevokeEntitlementResponse>()(ep, {
		param: { slug: enc(slug), entitlementId: enc(entitlementId) },
		json: { ...input, confirmed: input.confirmed as true | undefined },
	});
}

export async function listBillingMismatches(slug: string, idToken?: string) {
	return flexGet<{ mismatches: C.BillingMismatchRecord[] }>(
		(await resolvedBilling(idToken)).mismatches,
		{ param: sp(slug) },
	);
}

export async function getCustomerCreditBalance(
	slug: string,
	customerId: string,
	idToken?: string,
) {
	const ep = (await resolvedBilling(idToken)).customers[":customerId"][
		"credit-balance"
	];
	return flexGet<{
		organizationId?: string;
		customerId?: string;
		balanceCents?: number;
		currencyCode?: string;
		updatedAt?: string;
		updatedAtIso?: string;
		creditBalance: {
			organizationId: string;
			customerId: string;
			balanceCents: number;
			currencyCode: string;
			updatedAt?: string;
			updatedAtIso?: string;
		};
	}>(ep, { param: { slug: enc(slug), customerId: enc(customerId) } });
}

export async function getCustomerBillingLedger(
	slug: string,
	customerId: string,
	idToken?: string,
) {
	const ep = (await resolvedBilling(idToken)).customers[":customerId"].ledger;
	return flexGet<{
		ledger: C.BillingLedgerEntry[];
		ledgerEntries?: C.BillingLedgerEntry[];
	}>(ep, { param: { slug: enc(slug), customerId: enc(customerId) } });
}

export async function listBillingAdjustments(
	slug: string,
	customerId?: string,
	idToken?: string,
) {
	const param = sp(slug);
	return flexGet<{ adjustments: C.BillingAdjustment[] }>(
		(await resolvedBilling(idToken)).adjustments,
		customerId ? { param, query: { customerId } } : { param },
	);
}

export async function createBillingAdjustment(
	slug: string,
	input: C.CreateBillingAdjustmentPayload,
	idToken?: string,
) {
	const param = sp(slug);
	const ep = (await resolvedBilling(idToken)).adjustments;
	const reqArgs: Parameters<typeof ep.$post>[0] & { param: { slug: string } } =
		{ param, json: input };
	return rpcCall<{
		adjustment: C.BillingAdjustment;
		ledgerEntry?: C.BillingLedgerEntry;
		creditBalance: {
			organizationId: string;
			customerId: string;
			balanceCents: number;
			currencyCode: string;
		};
		alreadyExisted: boolean;
	}>(
		ep.$post(reqArgs as Parameters<typeof ep.$post>[0]),
		ep.$path({ param } as never),
	);
}

export async function searchAdminCustomers(
	slug: string,
	query: string,
	idToken?: string,
): Promise<C.AdminCustomerSearchResponse> {
	const param = sp(slug);
	return flexGet<C.AdminCustomerSearchResponse>(
		(await resolvedAdmin(idToken)).customers,
		query ? { param, query: { query } } : { param },
	);
}

export async function getAdminCustomerCheckoutIntents(
	slug: string,
	customerId: string,
	idToken?: string,
): Promise<C.AdminCheckoutIntentListResponse> {
	const ep = (await resolvedAdmin(idToken)).customers[":customerId"][
		"checkout-intents"
	];
	return rpcGet<C.AdminCheckoutIntentListResponse>()(ep, {
		param: { slug: enc(slug), customerId: enc(customerId) },
	});
}

export async function invalidateAdminCheckoutIntent(
	slug: string,
	intentId: string,
	idToken?: string,
	reason?: string,
): Promise<{ success: boolean; intentId: string }> {
	const ep = (await resolvedAdmin(idToken, true))["checkout-intents"][
		":intentId"
	].invalidate;
	return rpcPost<{ success: boolean; intentId: string }>()(ep, {
		param: { slug: enc(slug), intentId: enc(intentId) },
		json: reason ? { reason } : {},
	});
}

export async function recoverAdminCheckoutIntent(
	slug: string,
	intentId: string,
	idToken?: string,
	options?: { customerId?: string; expiresInHours?: number },
): Promise<C.AdminCheckoutRecoveryResult> {
	const ep = (await resolvedAdmin(idToken, true))["checkout-intents"][
		":intentId"
	].recover;
	return rpcPost<C.AdminCheckoutRecoveryResult>()(ep, {
		param: { slug: enc(slug), intentId: enc(intentId) },
		json: options ?? {},
	});
}

export function getCustomerCheckoutRecoveryReview(
	slug: string,
	token: string,
): Promise<C.RecoveryReviewDto> {
	return rpcGet<C.RecoveryReviewDto>()(
		custRpc()["checkout-recovery"][":token"],
		{ param: { slug: enc(slug), token: enc(token) } },
	);
}

export function resumeCustomerCheckoutRecovery(
	slug: string,
	token: string,
	csrfToken?: string,
): Promise<C.RecoveryCheckoutResult> {
	const ep = custRpc(
		csrfToken ? { extraHeaders: { "X-CSRF-Token": csrfToken } } : undefined,
	)["checkout-recovery"][":token"].checkout;
	return rpcPost<C.RecoveryCheckoutResult>()(ep, {
		param: { slug: enc(slug), token: enc(token) },
	});
}
