import {
	AdminDecisionResolutionPayloadSchema,
	type AdminEntitlementOperationsResponse,
	type AdminReconciliationRunSummary,
	type AdminUnresolvedValidationDecision,
	type AdminValidationDecisionResolutionAudit,
} from "@festival/common";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import {
	type ApiVariables,
	getRequiredTenant,
	requireAuth,
	requireTenant,
	requireTenantRole,
	toJsonError,
} from "../auth/tenant-context.js";
import type { AuthVerifier } from "../auth/types.js";
import type {
	CheckoutIntentRecord,
	CheckoutRepository,
} from "../checkout/checkout-repository.js";
import type {
	MembershipCommerceRepository,
	MembershipDecisionAuditRecord,
	MembershipReconciliationRun,
	MembershipValidationDecision,
} from "../commerce/membership-commerce-repository.js";
import type { ShopifyOrderProjectionService } from "../commerce/shopify-order-projection-service.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { AccompanistMembershipService } from "../services/accompanist-membership-service.js";
import { assertAllowedFields } from "./admin-shopify/admin-shopify.routes.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "./shared/route-security-metadata.js";
import {
	jsonValidator,
	preValidationGuard,
} from "./shared/schema-validator.js";

export const ADMIN_ENTITLEMENTS_ROUTE_SECURITY = [
	defineRouteSecurity({
		method: "GET",
		path: "/organizations/:slug/admin/entitlements/operations",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/organizations/:slug/admin/entitlements/reconcile",
		authenticationClass: "admin",
		csrfRequired: true,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/organizations/:slug/admin/entitlements/decisions/:decisionId/decline",
		authenticationClass: "admin",
		csrfRequired: true,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/organizations/:slug/admin/entitlements/decisions/:decisionId/approve",
		authenticationClass: "admin",
		csrfRequired: true,
		browserAllowed: true,
	}),
] as const satisfies readonly CoLocatedRouteSecurity[];

export interface AdminEntitlementsRoutesOptions {
	authVerifier: AuthVerifier;
	repository: OrganizationRepository;
	accompanistMembershipService?: AccompanistMembershipService;
	commerceRepository?: MembershipCommerceRepository;
	checkoutRepository?: CheckoutRepository;
	shopifyOrderProjectionService?: ShopifyOrderProjectionService;
}

type AdminContext = Context<{ Variables: Partial<ApiVariables> }>;

function requireAdminCsrf(): MiddlewareHandler<{
	Variables: Partial<ApiVariables>;
}> {
	return async (c, next) => {
		try {
			const token = c.req.header("X-CSRF-Token")?.trim();
			if (!token || token.length > 256) {
				throw new AppError("CSRF token is required.", 403);
			}
			await next();
		} catch (error) {
			return toJsonError(c, error);
		}
	};
}

function assertDecisionResolutionInput(payload: unknown): void {
	assertAllowedFields(
		payload,
		["confirmed", "note"],
		"Decision resolution request",
	);
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new AppError("Decision resolution request is invalid.", 400);
	}
	const { confirmed, note } = payload as {
		confirmed?: unknown;
		note?: unknown;
	};
	if (confirmed !== true) {
		throw new AppError("Decision resolution confirmation is required.", 400);
	}
	if (typeof note !== "string" || !note.trim() || note.trim().length > 500) {
		throw new AppError("A resolution note is required.", 400);
	}
}

function toRunSummary(
	run: MembershipReconciliationRun,
): AdminReconciliationRunSummary {
	return {
		id: run.id,
		organizationId: run.organizationId,
		status: run.status,
		discoveredCount: run.discoveredCount,
		processedCount: run.processedCount,
		startedAtIso: run.startedAtIso,
		finishedAtIso: run.finishedAtIso,
		...(run.failureCategory ? { failureCategory: run.failureCategory } : {}),
	};
}

function toAuditDto(
	audit: MembershipDecisionAuditRecord,
): AdminValidationDecisionResolutionAudit {
	return {
		id: audit.id,
		organizationId: audit.organizationId,
		decisionId: audit.decisionId,
		priorStatus: audit.priorStatus,
		finalStatus: audit.finalStatus,
		actorUserId: audit.actorUserId,
		note: audit.note,
		resolvedAtIso: audit.resolvedAtIso,
	};
}

function toDecisionSummary(input: {
	decision: MembershipValidationDecision;
	intentsById: Map<string, CheckoutIntentRecord>;
	contacts: Map<string, { name?: string | null; email?: string | null }>;
	productNames: Map<string, string>;
}): AdminUnresolvedValidationDecision {
	const { decision, intentsById, contacts, productNames } = input;
	const intent = decision.checkoutIntentId
		? intentsById.get(decision.checkoutIntentId)
		: undefined;
	const customerId = decision.customerId ?? intent?.customerId;
	const contact = customerId ? contacts.get(customerId) : undefined;
	const offeringName = intent?.offeringId
		? (productNames.get(intent.offeringId) ?? "Teacher Membership")
		: undefined;
	const canApprove =
		decision.reasonCode !== "intent_expired" &&
		decision.reasonCode !== "correlation_missing" &&
		decision.reasonCode !== "correlation_invalid";
	return {
		id: decision.id,
		shopifyOrderGid: decision.shopifyOrderGid,
		...(decision.shopifyOrderLineGid
			? { shopifyOrderLineGid: decision.shopifyOrderLineGid }
			: {}),
		...(decision.checkoutIntentId
			? { checkoutIntentId: decision.checkoutIntentId }
			: {}),
		...(customerId ? { customerId } : {}),
		...(contact?.name ? { customerName: contact.name } : {}),
		...(contact?.email ? { customerEmail: contact.email } : {}),
		...(offeringName ? { offeringName } : {}),
		...(intent?.divisionNameSnapshot
			? { divisionName: intent.divisionNameSnapshot }
			: {}),
		status: decision.status as "pending_validation" | "needs_review",
		...(decision.reasonCode ? { reasonCode: decision.reasonCode } : {}),
		createdAtIso: decision.createdAtIso,
		updatedAtIso: decision.updatedAtIso,
		availableActions: canApprove ? ["approve", "decline"] : ["decline"],
	};
}

async function loadDecisionIntents(
	organizationId: string,
	decisions: MembershipValidationDecision[],
	checkoutRepository?: CheckoutRepository,
) {
	const intentsById = new Map<string, CheckoutIntentRecord>();
	if (!checkoutRepository?.findIntentById) return intentsById;
	for (const decision of decisions) {
		const intentId = decision.checkoutIntentId;
		if (intentId && !intentsById.has(intentId)) {
			const intent = await checkoutRepository.findIntentById(
				organizationId,
				intentId,
			);
			if (intent) intentsById.set(intent.id, intent);
		}
	}
	return intentsById;
}

async function enrichUnresolvedDecisions(input: {
	organizationId: string;
	decisions: MembershipValidationDecision[];
	repository: OrganizationRepository;
	checkoutRepository?: CheckoutRepository;
}): Promise<AdminUnresolvedValidationDecision[]> {
	const { organizationId, decisions, repository, checkoutRepository } = input;
	if (decisions.length === 0) return [];
	const intentsById = await loadDecisionIntents(
		organizationId,
		decisions,
		checkoutRepository,
	);
	const customerIds = [
		...new Set(
			decisions
				.map(
					(d) =>
						d.customerId ??
						(d.checkoutIntentId
							? intentsById.get(d.checkoutIntentId)?.customerId
							: undefined),
				)
				.filter((id): id is string => Boolean(id)),
		),
	];
	const [contacts, products] = await Promise.all([
		repository.findMembershipCustomerContacts(organizationId, customerIds),
		repository.listMembershipProductRecords(organizationId),
	]);
	const productNames = new Map(
		products.map((product) => [product.id, product.productNameSnapshot]),
	);
	return decisions.map((decision) =>
		toDecisionSummary({ decision, intentsById, contacts, productNames }),
	);
}

async function executeManualApprove(input: {
	organizationId: string;
	decisionId: string;
	actorUserId: string;
	note: string;
	resolvedAtIso: string;
	commerceRepository: MembershipCommerceRepository;
	shopifyOrderProjectionService: ShopifyOrderProjectionService;
}) {
	const existing = await input.commerceRepository.getDecisionById(
		input.organizationId,
		input.decisionId,
	);
	if (!existing) {
		throw new AppError("Validation decision was not found.", 404);
	}
	if (
		existing.status !== "pending_validation" &&
		existing.status !== "needs_review"
	) {
		throw new AppError("Validation decision is already resolved.", 409);
	}
	const prepared =
		await input.shopifyOrderProjectionService.prepareManualApproval(
			input.organizationId,
			existing.shopifyOrderGid,
		);
	const resolved = await input.commerceRepository.resolveDecisionManually({
		organizationId: input.organizationId,
		decisionId: input.decisionId,
		finalStatus: "approved",
		actorUserId: input.actorUserId,
		note: input.note,
		resolvedAtIso: input.resolvedAtIso,
		customerId: prepared.customerId,
		checkoutIntentId: prepared.checkoutIntentId,
		shopifyOrderLineGid: prepared.shopifyOrderLineGid,
		projection: prepared.projection,
		grant: prepared.grant,
	});
	return {
		decision: resolved.decision,
		...(resolved.grant ? { grant: resolved.grant } : {}),
		audit: toAuditDto(resolved.audit),
	};
}

function getEntitlementOperationsHandler(
	c: AdminContext,
	options: AdminEntitlementsRoutesOptions,
) {
	return respondNoStoreJson(c, async () => {
		const { accompanistMembershipService, commerceRepository, repository } =
			options;
		assertOperationsAvailable(accompanistMembershipService);
		assertOperationsAvailable(commerceRepository);
		const organizationId = getRequiredTenant(c).organization.id;
		const [summaryCounts, rawRuns, rawDecisions] = await Promise.all([
			accompanistMembershipService.getSummaryCounts(organizationId),
			commerceRepository.listReconciliationRuns(organizationId, 10),
			commerceRepository.listUnresolvedDecisions(organizationId),
		]);
		const reconciliationRuns = rawRuns.map(toRunSummary);
		const unresolvedDecisions = await enrichUnresolvedDecisions({
			organizationId,
			decisions: rawDecisions,
			repository,
			checkoutRepository: options.checkoutRepository,
		});
		const response: AdminEntitlementOperationsResponse = {
			summaryCounts,
			latestReconciliationRun: reconciliationRuns[0] ?? null,
			reconciliationRuns,
			unresolvedDecisions,
		};
		return response;
	});
}

function reconcileEntitlementsHandler(
	c: AdminContext,
	options: AdminEntitlementsRoutesOptions,
) {
	return respondNoStoreJson(c, async () => {
		const { shopifyOrderProjectionService, commerceRepository } = options;
		if (!shopifyOrderProjectionService || !commerceRepository) {
			throw new AppError("Shopify order reconciliation is unavailable.", 503);
		}
		const organizationId = getRequiredTenant(c).organization.id;
		let counts: { discoveredCount: number; processedCount: number };
		try {
			counts = await shopifyOrderProjectionService.reconcile(organizationId);
		} catch {
			throw new AppError("Shopify order reconciliation failed.", 503);
		}
		const latest = (
			await commerceRepository.listReconciliationRuns(organizationId, 1)
		)[0];
		if (!latest) {
			throw new AppError("Shopify order reconciliation failed.", 503);
		}
		return {
			discoveredCount: counts.discoveredCount,
			processedCount: counts.processedCount,
			run: toRunSummary(latest),
		};
	});
}

function requireDecisionId(c: AdminContext): string {
	const decisionId = c.req.param("decisionId");
	if (!decisionId) {
		throw new AppError("Decision ID is required.", 400);
	}
	return decisionId;
}

function assertOperationsAvailable(ready: unknown): asserts ready {
	if (!ready) {
		throw new AppError("Entitlement operations service is unavailable.", 503);
	}
}

async function respondNoStoreJson<T>(c: AdminContext, work: () => Promise<T>) {
	try {
		const payload = await work();
		c.header("Cache-Control", "no-store");
		return c.json(payload);
	} catch (error) {
		return toJsonError(c, error);
	}
}

const decisionResolutionValidator = jsonValidator(
	AdminDecisionResolutionPayloadSchema,
	{
		preCheck: assertDecisionResolutionInput,
	},
);

interface DecisionResolutionHandlerInput {
	options: AdminEntitlementsRoutesOptions;
	nowFn: () => Date;
	input: { confirmed: true; note: string };
}

function declineDecisionHandler(
	c: AdminContext,
	params: DecisionResolutionHandlerInput,
) {
	return respondNoStoreJson(c, async () => {
		const { commerceRepository } = params.options;
		assertOperationsAvailable(commerceRepository);
		const tenant = getRequiredTenant(c);
		const resolved = await commerceRepository.resolveDecisionManually({
			organizationId: tenant.organization.id,
			decisionId: requireDecisionId(c),
			finalStatus: "rejected",
			actorUserId: tenant.user.id,
			note: params.input.note.trim(),
			resolvedAtIso: params.nowFn().toISOString(),
		});
		return { decision: resolved.decision, audit: toAuditDto(resolved.audit) };
	});
}

function approveDecisionHandler(
	c: AdminContext,
	params: DecisionResolutionHandlerInput,
) {
	return respondNoStoreJson(c, async () => {
		const { commerceRepository, shopifyOrderProjectionService } =
			params.options;
		assertOperationsAvailable(commerceRepository);
		assertOperationsAvailable(shopifyOrderProjectionService);
		const tenant = getRequiredTenant(c);
		return executeManualApprove({
			organizationId: tenant.organization.id,
			decisionId: requireDecisionId(c),
			actorUserId: tenant.user.id,
			note: params.input.note.trim(),
			resolvedAtIso: params.nowFn().toISOString(),
			commerceRepository,
			shopifyOrderProjectionService,
		});
	});
}

export function buildAdminEntitlementsRoutes(
	options: AdminEntitlementsRoutesOptions,
) {
	const { authVerifier, repository } = options;
	const nowFn = (repository as { now?: () => Date }).now ?? (() => new Date());
	const admin = [
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
	] as const;
	const adminCsrf = [...admin, requireAdminCsrf()] as const;
	const requireDeclineGuard = preValidationGuard(() => {
		assertOperationsAvailable(options.commerceRepository);
	});
	const requireApproveGuard = preValidationGuard(() => {
		assertOperationsAvailable(options.commerceRepository);
		assertOperationsAvailable(options.shopifyOrderProjectionService);
	});

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get("/organizations/:slug/admin/entitlements/operations", ...admin, (c) =>
			getEntitlementOperationsHandler(c, options),
		)
		.post(
			"/organizations/:slug/admin/entitlements/reconcile",
			...adminCsrf,
			(c) => reconcileEntitlementsHandler(c, options),
		)
		.post(
			"/organizations/:slug/admin/entitlements/decisions/:decisionId/decline",
			...adminCsrf,
			requireDeclineGuard,
			decisionResolutionValidator,
			(c) =>
				declineDecisionHandler(c, {
					options,
					nowFn,
					input: c.req.valid("json"),
				}),
		)
		.post(
			"/organizations/:slug/admin/entitlements/decisions/:decisionId/approve",
			...adminCsrf,
			requireApproveGuard,
			decisionResolutionValidator,
			(c) =>
				approveDecisionHandler(c, {
					options,
					nowFn,
					input: c.req.valid("json"),
				}),
		);
}

export type AdminEntitlementsRoutesType = ReturnType<
	typeof buildAdminEntitlementsRoutes
>;
