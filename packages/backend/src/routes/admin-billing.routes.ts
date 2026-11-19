import {
	type BillingAdjustmentType,
	type CreateBillingAdjustmentInput,
	type CreateBillingAdjustmentPayload,
	CreateBillingAdjustmentPayloadSchema,
	CustomerIdQuerySchema,
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
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "./shared/route-security-metadata.js";
import { jsonValidator, queryValidator } from "./shared/schema-validator.js";

export const ADMIN_BILLING_ROUTE_SECURITY = [
	defineRouteSecurity({
		method: "GET",
		path: "/mismatches",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "GET",
		path: "/customers/:customerId/credit-balance",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "GET",
		path: "/customers/:customerId/ledger",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "GET",
		path: "/adjustments",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "POST",
		path: "/adjustments",
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	}),
] as const satisfies readonly CoLocatedRouteSecurity[];

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

function optionalTrimmed(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: null;
}

function assertMatchingOrganization(
	body: CreateBillingAdjustmentPayload,
	tenantOrganizationId: string,
): void {
	if (
		typeof body.organizationId === "string" &&
		body.organizationId.trim() &&
		body.organizationId.trim() !== tenantOrganizationId
	) {
		throw new AppError("Organization mismatch.", 400);
	}
}

function buildAdjustmentInput(
	body: CreateBillingAdjustmentPayload,
	tenantOrganizationId: string,
	defaultAdminUserId: string,
): CreateBillingAdjustmentInput {
	return {
		organizationId: tenantOrganizationId,
		customerId: body.customerId.trim(),
		adminUserId: optionalTrimmed(body.adminUserId) ?? defaultAdminUserId,
		adjustmentType: body.adjustmentType.trim() as BillingAdjustmentType,
		amountCents: body.amountCents,
		currencyCode: optionalTrimmed(body.currencyCode)?.toUpperCase(),
		reason: body.reason.trim(),
		referenceType: optionalTrimmed(body.referenceType),
		referenceId: optionalTrimmed(body.referenceId),
		approvedDecisionId: optionalTrimmed(body.approvedDecisionId),
	};
}

function parseAdjustmentPayload(
	body: CreateBillingAdjustmentPayload,
	tenantOrganizationId: string,
	defaultAdminUserId: string,
): {
	input: CreateBillingAdjustmentInput;
	options: CreateAdjustmentOptions;
} {
	assertMatchingOrganization(body, tenantOrganizationId);
	const input = buildAdjustmentInput(
		body,
		tenantOrganizationId,
		defaultAdminUserId,
	);
	const validation = validateCreateBillingAdjustmentInput(input);
	if (!validation.valid || !validation.data) {
		throw new AppError(validation.errors.join("; "), 400);
	}
	const options: CreateAdjustmentOptions = {
		notes: typeof body.notes === "string" ? body.notes : null,
		entryType: body.entryType,
		direction: body.direction,
	};
	return { input: validation.data, options };
}

async function listMismatchesHandler(
	c: BillingContext,
	billingService: BillingReconciliationService,
) {
	try {
		const tenant = getRequiredTenant(c);
		const mismatches = await billingService.listMismatches(
			tenant.organization.id,
		);
		return c.json({ mismatches });
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function getCreditBalanceHandler(
	c: BillingContext,
	billingService: BillingReconciliationService,
) {
	try {
		const tenant = getRequiredTenant(c);
		const customerId = requireNonEmptyCustomerId(c);
		const existing = await billingService.getCreditBalance(
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
}

async function getLedgerHandler(
	c: BillingContext,
	billingService: BillingReconciliationService,
) {
	try {
		const tenant = getRequiredTenant(c);
		const customerId = requireNonEmptyCustomerId(c);
		const ledger = await billingService.listLedgerEntries(
			tenant.organization.id,
			customerId,
		);
		return c.json({ ledger, ledgerEntries: ledger });
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function listAdjustmentsHandler(
	c: BillingContext,
	billingService: BillingReconciliationService,
	customerIdQuery?: string,
) {
	try {
		const tenant = getRequiredTenant(c);
		const customerId = customerIdQuery?.trim() || undefined;
		const adjustments = await billingService.listAdjustments(
			tenant.organization.id,
			customerId,
		);
		return c.json({ adjustments });
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handleApplyAdjustment(
	c: BillingContext,
	billingService: BillingReconciliationService,
	body: CreateBillingAdjustmentPayload,
) {
	try {
		const tenant = getRequiredTenant(c);
		const defaultAdminId = tenant.user?.id || getRequiredIdentity(c).uid;
		const { input, options } = parseAdjustmentPayload(
			body,
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
		return toJsonError(c, error);
	}
}

export function buildAdminBillingRoutes(options: AdminBillingRoutesOptions) {
	const repository =
		options.repository ?? options.organizationService?.repository;
	if (!repository) {
		throw new Error(
			"OrganizationRepository is required to build admin billing routes.",
		);
	}
	const { authVerifier, billingReconciliationService } = options;
	const admin = [
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
	] as const;

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get("/mismatches", ...admin, (c) =>
			listMismatchesHandler(c, billingReconciliationService),
		)
		.get("/customers/:customerId/credit-balance", ...admin, (c) =>
			getCreditBalanceHandler(c, billingReconciliationService),
		)
		.get("/customers/:customerId/ledger", ...admin, (c) =>
			getLedgerHandler(c, billingReconciliationService),
		)
		.get("/adjustments", ...admin, queryValidator(CustomerIdQuerySchema), (c) =>
			listAdjustmentsHandler(
				c,
				billingReconciliationService,
				c.req.valid("query").customerId,
			),
		)
		.post(
			"/adjustments",
			...admin,
			jsonValidator(CreateBillingAdjustmentPayloadSchema, {
				invalidJsonMessage: "Invalid JSON payload.",
			}),
			(c) =>
				handleApplyAdjustment(
					c,
					billingReconciliationService,
					c.req.valid("json"),
				),
		);
}

export type AdminBillingRoutesType = ReturnType<typeof buildAdminBillingRoutes>;
