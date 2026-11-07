import type {
	AdminEntitlementOperationsResponse,
	AdminReconciliationRunSummary,
	AdminUnresolvedValidationDecision,
	AdminValidationDecisionResolutionAudit,
} from "@festival/common";
import { Hono, type MiddlewareHandler } from "hono";
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

export interface AdminEntitlementsRoutesOptions {
	authVerifier: AuthVerifier;
	repository: OrganizationRepository;
	accompanistMembershipService?: AccompanistMembershipService;
	commerceRepository?: MembershipCommerceRepository;
	checkoutRepository?: CheckoutRepository;
	shopifyOrderProjectionService?: ShopifyOrderProjectionService;
}

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

function parseDecisionResolutionInput(payload: unknown): {
	confirmed: true;
	note: string;
} {
	assertAllowedFields(
		payload,
		["confirmed", "note"],
		"Decision resolution request",
	);
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new AppError("Decision resolution request is invalid.", 400);
	}
	const record = payload as { confirmed?: unknown; note?: unknown };
	if (record.confirmed !== true) {
		throw new AppError("Decision resolution confirmation is required.", 400);
	}
	if (
		typeof record.note !== "string" ||
		!record.note.trim() ||
		record.note.trim().length > 500
	) {
		throw new AppError("A resolution note is required.", 400);
	}
	return { confirmed: true, note: record.note.trim() };
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

function toDecisionSummary(
	decision: MembershipValidationDecision,
	intentsById: Map<string, CheckoutIntentRecord>,
	contacts: Map<string, { name?: string | null; email?: string | null }>,
	productNames: Map<string, string>,
): AdminUnresolvedValidationDecision {
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

async function enrichUnresolvedDecisions(input: {
	organizationId: string;
	decisions: MembershipValidationDecision[];
	repository: OrganizationRepository;
	checkoutRepository?: CheckoutRepository;
}): Promise<AdminUnresolvedValidationDecision[]> {
	const { organizationId, decisions, repository, checkoutRepository } = input;
	if (decisions.length === 0) return [];
	const intentsById = new Map<string, CheckoutIntentRecord>();
	if (checkoutRepository?.findIntentById) {
		for (const decision of decisions) {
			if (
				decision.checkoutIntentId &&
				!intentsById.has(decision.checkoutIntentId)
			) {
				const intent = await checkoutRepository.findIntentById(
					organizationId,
					decision.checkoutIntentId,
				);
				if (intent) intentsById.set(intent.id, intent);
			}
		}
	}
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
		toDecisionSummary(decision, intentsById, contacts, productNames),
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

function registerDecisionRoutes(
	router: Hono<{ Variables: Partial<ApiVariables> }>,
	options: AdminEntitlementsRoutesOptions,
	nowFn: () => Date,
) {
	const {
		authVerifier,
		repository,
		commerceRepository,
		shopifyOrderProjectionService,
	} = options;
	const guards = [
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		requireAdminCsrf(),
	] as const;

	router.post(
		"/organizations/:slug/admin/entitlements/decisions/:decisionId/decline",
		...guards,
		async (c) => {
			try {
				if (!commerceRepository) {
					throw new AppError(
						"Entitlement operations service is unavailable.",
						503,
					);
				}
				const input = parseDecisionResolutionInput(await c.req.json());
				const tenant = getRequiredTenant(c);
				const resolved = await commerceRepository.resolveDecisionManually({
					organizationId: tenant.organization.id,
					decisionId: c.req.param("decisionId"),
					finalStatus: "rejected",
					actorUserId: tenant.user.id,
					note: input.note,
					resolvedAtIso: nowFn().toISOString(),
				});
				c.header("Cache-Control", "no-store");
				return c.json({
					decision: resolved.decision,
					audit: toAuditDto(resolved.audit),
				});
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/entitlements/decisions/:decisionId/approve",
		...guards,
		async (c) => {
			try {
				if (!commerceRepository || !shopifyOrderProjectionService) {
					throw new AppError(
						"Entitlement operations service is unavailable.",
						503,
					);
				}
				const input = parseDecisionResolutionInput(await c.req.json());
				const tenant = getRequiredTenant(c);
				const body = await executeManualApprove({
					organizationId: tenant.organization.id,
					decisionId: c.req.param("decisionId"),
					actorUserId: tenant.user.id,
					note: input.note,
					resolvedAtIso: nowFn().toISOString(),
					commerceRepository,
					shopifyOrderProjectionService,
				});
				c.header("Cache-Control", "no-store");
				return c.json(body);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);
}

export function buildAdminEntitlementsRoutes(
	options: AdminEntitlementsRoutesOptions,
): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();
	const {
		authVerifier,
		repository,
		accompanistMembershipService,
		commerceRepository,
		checkoutRepository,
		shopifyOrderProjectionService,
	} = options;
	const nowFn = (repository as { now?: () => Date }).now ?? (() => new Date());

	router.get(
		"/organizations/:slug/admin/entitlements/operations",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				if (!accompanistMembershipService || !commerceRepository) {
					throw new AppError(
						"Entitlement operations service is unavailable.",
						503,
					);
				}
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
					checkoutRepository,
				});
				const response: AdminEntitlementOperationsResponse = {
					summaryCounts,
					latestReconciliationRun: reconciliationRuns[0] ?? null,
					reconciliationRuns,
					unresolvedDecisions,
				};
				c.header("Cache-Control", "no-store");
				return c.json(response);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/entitlements/reconcile",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		requireAdminCsrf(),
		async (c) => {
			try {
				if (!shopifyOrderProjectionService || !commerceRepository) {
					throw new AppError(
						"Shopify order reconciliation is unavailable.",
						503,
					);
				}
				const organizationId = getRequiredTenant(c).organization.id;
				let counts: { discoveredCount: number; processedCount: number };
				try {
					counts =
						await shopifyOrderProjectionService.reconcile(organizationId);
				} catch {
					throw new AppError("Shopify order reconciliation failed.", 503);
				}
				const runs = await commerceRepository.listReconciliationRuns(
					organizationId,
					1,
				);
				const latest = runs[0];
				if (!latest) {
					throw new AppError("Shopify order reconciliation failed.", 503);
				}
				c.header("Cache-Control", "no-store");
				return c.json({
					discoveredCount: counts.discoveredCount,
					processedCount: counts.processedCount,
					run: toRunSummary(latest),
				});
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	registerDecisionRoutes(router, options, nowFn);
	return router;
}
