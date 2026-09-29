import {
	type BillingAdjustmentType,
	type CreateBillingAdjustmentInput,
	isBillingLedgerDirection,
	isBillingLedgerEntryType,
	validateCreateBillingAdjustmentInput,
} from "@festival/common";
import { type Context, Hono } from "hono";
import {
	type ApiVariables,
	getRequiredIdentity,
	getRequiredTenant,
	requireAuth,
	requireTenant,
	requireTenantRole,
	toJsonError,
} from "../auth/tenant-context.js";
import type { AuthVerifier } from "../auth/types.js";
import type { BillingReconciliationService } from "../billing/billing-reconciliation-service.js";
import {
	type CreateAdjustmentOptions,
	DuplicateAdjustmentError,
	InsufficientCreditBalanceError,
} from "../billing/billing-repository.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { OrganizationService } from "../services/organization-service.js";

export interface AdminBillingRoutesOptions {
	authVerifier: AuthVerifier;
	billingReconciliationService: BillingReconciliationService;
	repository?: OrganizationRepository;
	organizationService?: OrganizationService;
}

type BillingContext = Context<{ Variables: Partial<ApiVariables> }>;

function requireNonEmptyCustomerId(c: BillingContext): string {
	const customerId = c.req.param("customerId")?.trim();
	if (!customerId) {
		throw new AppError("Customer ID is required.", 400);
	}
	return customerId;
}

async function parseAdjustmentPayload(
	c: BillingContext,
	tenantOrganizationId: string,
	defaultAdminUserId: string,
): Promise<{
	input: CreateBillingAdjustmentInput;
	options: CreateAdjustmentOptions;
}> {
	let body: Record<string, unknown>;
	try {
		body = (await c.req.json()) as Record<string, unknown>;
	} catch {
		throw new AppError("Invalid JSON payload.", 400);
	}

	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw new AppError("Billing adjustment input must be an object.", 400);
	}

	if (
		typeof body.organizationId === "string" &&
		body.organizationId.trim() &&
		body.organizationId.trim() !== tenantOrganizationId
	) {
		throw new AppError("Organization mismatch.", 400);
	}

	const customerId =
		typeof body.customerId === "string" ? body.customerId.trim() : "";
	const adminUserId =
		typeof body.adminUserId === "string" && body.adminUserId.trim()
			? body.adminUserId.trim()
			: defaultAdminUserId;
	const adjustmentType =
		typeof body.adjustmentType === "string" ? body.adjustmentType.trim() : "";
	const reason = typeof body.reason === "string" ? body.reason.trim() : "";
	const amountCents = body.amountCents;

	const currencyCode =
		typeof body.currencyCode === "string" && body.currencyCode.trim()
			? body.currencyCode.trim().toUpperCase()
			: undefined;

	const referenceType =
		typeof body.referenceType === "string" &&
		body.referenceType.trim().length > 0
			? body.referenceType.trim()
			: null;

	const referenceId =
		typeof body.referenceId === "string" && body.referenceId.trim().length > 0
			? body.referenceId.trim()
			: null;

	const approvedDecisionId =
		typeof body.approvedDecisionId === "string" &&
		body.approvedDecisionId.trim().length > 0
			? body.approvedDecisionId.trim()
			: null;

	const input: CreateBillingAdjustmentInput = {
		organizationId: tenantOrganizationId,
		customerId,
		adminUserId,
		adjustmentType: adjustmentType as BillingAdjustmentType,
		amountCents: amountCents as number,
		currencyCode,
		reason,
		referenceType,
		referenceId,
		approvedDecisionId,
	};

	const validation = validateCreateBillingAdjustmentInput(input);
	if (!validation.valid || !validation.data) {
		throw new AppError(validation.errors.join("; "), 400);
	}

	const options: CreateAdjustmentOptions = {
		notes: typeof body.notes === "string" ? body.notes : null,
		entryType:
			typeof body.entryType === "string" &&
			isBillingLedgerEntryType(body.entryType)
				? body.entryType
				: undefined,
		direction:
			typeof body.direction === "string" &&
			isBillingLedgerDirection(body.direction)
				? body.direction
				: undefined,
	};

	return { input: validation.data, options };
}

async function handleApplyAdjustment(
	c: BillingContext,
	billingService: BillingReconciliationService,
) {
	try {
		const tenant = getRequiredTenant(c);
		const defaultAdminId = tenant.user?.id || getRequiredIdentity(c).uid;
		const { input, options } = await parseAdjustmentPayload(
			c,
			tenant.organization.id,
			defaultAdminId,
		);

		const outcome = await billingService.applyAdjustment(input, options);
		if (outcome.alreadyExisted) {
			throw new DuplicateAdjustmentError(
				"Adjustment with this reference already exists.",
				outcome.adjustment,
			);
		}

		return c.json(outcome, 201);
	} catch (error) {
		if (error instanceof InsufficientCreditBalanceError) {
			return toJsonError(
				c,
				new AppError(error.message, 409, "INSUFFICIENT_CREDIT_BALANCE"),
			);
		}
		if (error instanceof DuplicateAdjustmentError) {
			return toJsonError(c, error);
		}
		return toJsonError(c, error);
	}
}

export function buildAdminBillingRoutes(
	options: AdminBillingRoutesOptions,
): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();
	const repository =
		options.repository ?? options.organizationService?.repository;
	if (!repository) {
		throw new Error(
			"OrganizationRepository is required to build admin billing routes.",
		);
	}
	const { authVerifier, billingReconciliationService } = options;

	router.get(
		"/mismatches",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const mismatches = await billingReconciliationService.listMismatches(
					tenant.organization.id,
				);
				return c.json({ mismatches });
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/customers/:customerId/credit-balance",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const customerId = requireNonEmptyCustomerId(c);
				const existing = await billingReconciliationService.getCreditBalance(
					tenant.organization.id,
					customerId,
				);
				const creditBalance = existing ?? {
					organizationId: tenant.organization.id,
					customerId,
					balanceCents: 0,
					currencyCode: "USD",
				};
				return c.json({ creditBalance, ...creditBalance });
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/customers/:customerId/ledger",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const customerId = requireNonEmptyCustomerId(c);
				const ledger = await billingReconciliationService.listLedgerEntries(
					tenant.organization.id,
					customerId,
				);
				return c.json({ ledger, ledgerEntries: ledger });
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/adjustments",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const customerId = c.req.query("customerId")?.trim() || undefined;
				const adjustments = await billingReconciliationService.listAdjustments(
					tenant.organization.id,
					customerId,
				);
				return c.json({ adjustments });
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/adjustments",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => handleApplyAdjustment(c, billingReconciliationService),
	);

	return router;
}
