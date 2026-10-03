import { randomUUID } from "node:crypto";
import type {
	BillingAdjustment,
	BillingAdjustmentType,
	BillingLedgerDirection,
	BillingLedgerEntry,
	BillingLedgerEntryType,
	BillingMismatchRecord,
	CreateBillingAdjustmentInput,
	CreditBalance,
} from "@festival/common";
import { AppError } from "../errors/app-error.js";

export class DuplicateAdjustmentError extends AppError {
	constructor(
		message = "Adjustment with this reference already exists.",
		readonly existingAdjustment?: BillingAdjustment,
	) {
		super(message, 409, "DUPLICATE_ADJUSTMENT");
	}
}

export class InsufficientCreditBalanceError extends AppError {
	constructor(message = "Credit balance cannot be negative.") {
		super(message, 400, "INSUFFICIENT_CREDIT_BALANCE");
	}
}

export interface CreateAdjustmentOptions {
	notes?: string | null;
	entryType?: BillingLedgerEntryType;
	direction?: BillingLedgerDirection;
}

export interface CreateAdjustmentResult {
	adjustment: BillingAdjustment;
	ledgerEntry: BillingLedgerEntry;
	creditBalance: CreditBalance;
}

export interface BillingRepository {
	createAdjustmentWithLedger(
		input: CreateBillingAdjustmentInput,
		options?: CreateAdjustmentOptions,
	): Promise<CreateAdjustmentResult>;

	getCreditBalance(
		organizationId: string,
		customerId: string,
	): Promise<CreditBalance | null>;

	listLedgerEntries(
		organizationId: string,
		customerId: string,
	): Promise<BillingLedgerEntry[]>;

	listAdjustments(
		organizationId: string,
		customerId?: string,
	): Promise<BillingAdjustment[]>;

	findAdjustmentByReference(
		organizationId: string,
		referenceType: string | null | undefined,
		referenceId: string,
	): Promise<BillingAdjustment | null>;

	listMismatches(organizationId: string): Promise<BillingMismatchRecord[]>;
}

export function resolveAdjustmentDirection(
	adjustmentType: BillingAdjustmentType,
	explicitDirection?: BillingLedgerDirection,
): BillingLedgerDirection {
	if (explicitDirection) return explicitDirection;
	switch (adjustmentType) {
		case "credit_issue":
		case "refund":
			return "inflow";
		case "credit_apply":
		case "manual_charge":
		case "write_off":
			return "outflow";
	}
}

export function resolveLedgerEntryType(
	adjustmentType: BillingAdjustmentType,
	direction: BillingLedgerDirection,
	explicitEntryType?: BillingLedgerEntryType,
): BillingLedgerEntryType {
	if (explicitEntryType) return explicitEntryType;
	if (adjustmentType === "credit_issue") return "credit";
	if (adjustmentType === "credit_apply") return "debit";
	return direction === "inflow" ? "credit" : "adjustment";
}

export interface SeedOrderProjection {
	organizationId: string;
	shopifyOrderGid: string;
	shopifyCustomerGid?: string | null;
	correlationId?: string | null;
	fullyPaidAt?: string | null;
	currencyCode?: string | null;
}

export interface SeedClassEntitlement {
	id: string;
	organizationId: string;
	parentCustomerId: string;
	checkoutIntentId: string;
	shopifyOrderGid: string;
	paidAmountCents: number;
	paidCurrencyCode: string;
	status: "confirmed" | "waitlisted" | "cancelled" | "revoked";
}

export interface SeedCheckoutIntent {
	id: string;
	correlationId: string;
	organizationId: string;
	customerId: string;
	amount: string;
	currencyCode: string;
	cartReference?: string | null;
}

export interface SeedCheckoutCart {
	reference: string;
	organizationId: string;
	customerId: string;
}

export class InMemoryBillingRepository implements BillingRepository {
	private readonly adjustments: BillingAdjustment[] = [];
	private readonly ledgerEntries: BillingLedgerEntry[] = [];
	private readonly creditBalances = new Map<string, CreditBalance>();
	private readonly orderProjections: SeedOrderProjection[] = [];
	private readonly classEntitlements: SeedClassEntitlement[] = [];
	private readonly checkoutIntents: SeedCheckoutIntent[] = [];
	private readonly checkoutCarts: SeedCheckoutCart[] = [];
	private readonly seededMismatches: BillingMismatchRecord[] = [];

	seedOrderProjections(items: SeedOrderProjection[]) {
		this.orderProjections.push(...items);
	}

	seedClassEntitlements(items: SeedClassEntitlement[]) {
		this.classEntitlements.push(...items);
	}

	seedCheckoutIntents(items: SeedCheckoutIntent[]) {
		this.checkoutIntents.push(...items);
	}

	seedCheckoutCarts(items: SeedCheckoutCart[]) {
		this.checkoutCarts.push(...items);
	}

	seedMismatches(items: BillingMismatchRecord[]) {
		this.seededMismatches.push(...items);
	}

	async createAdjustmentWithLedger(
		input: CreateBillingAdjustmentInput,
		options?: CreateAdjustmentOptions,
	): Promise<CreateAdjustmentResult> {
		if (input.referenceId) {
			const existing = await this.findAdjustmentByReference(
				input.organizationId,
				input.referenceType,
				input.referenceId,
			);
			if (existing) {
				throw new DuplicateAdjustmentError(
					`Adjustment for reference "${input.referenceId}" already exists.`,
					existing,
				);
			}
		}

		const balanceKey = `${input.organizationId}:${input.customerId}`;
		const current = this.creditBalances.get(balanceKey) ?? {
			organizationId: input.organizationId,
			customerId: input.customerId,
			balanceCents: 0,
			currencyCode: input.currencyCode ?? "USD",
		};

		const direction = resolveAdjustmentDirection(
			input.adjustmentType,
			options?.direction,
		);
		const entryType = resolveLedgerEntryType(
			input.adjustmentType,
			direction,
			options?.entryType,
		);

		const delta =
			direction === "inflow" ? input.amountCents : -input.amountCents;
		const newBalance = current.balanceCents + delta;
		if (newBalance < 0) {
			throw new InsufficientCreditBalanceError(
				`Adjustment would result in negative credit balance: ${newBalance} cents. Available: ${current.balanceCents} cents.`,
			);
		}

		const nowIso = new Date().toISOString();
		const adjustment: BillingAdjustment = {
			id: randomUUID(),
			organizationId: input.organizationId,
			customerId: input.customerId,
			adminUserId: input.adminUserId,
			adjustmentType: input.adjustmentType,
			amountCents: input.amountCents,
			currencyCode: input.currencyCode ?? current.currencyCode,
			reason: input.reason,
			referenceType: input.referenceType ?? null,
			referenceId: input.referenceId ?? null,
			approvedDecisionId: input.approvedDecisionId ?? null,
			createdAtIso: nowIso,
		};
		this.adjustments.push(adjustment);

		const ledgerEntry: BillingLedgerEntry = {
			id: randomUUID(),
			organizationId: input.organizationId,
			customerId: input.customerId,
			entryType,
			amountCents: input.amountCents,
			direction,
			balanceAfterCents: newBalance,
			currencyCode: adjustment.currencyCode,
			adjustmentId: adjustment.id,
			notes: options?.notes ?? null,
			createdAtIso: nowIso,
		};
		this.ledgerEntries.push(ledgerEntry);

		const updatedBalance: CreditBalance = {
			organizationId: input.organizationId,
			customerId: input.customerId,
			balanceCents: newBalance,
			currencyCode: adjustment.currencyCode,
			updatedAtIso: nowIso,
		};
		this.creditBalances.set(balanceKey, updatedBalance);

		return { adjustment, ledgerEntry, creditBalance: updatedBalance };
	}

	async getCreditBalance(
		organizationId: string,
		customerId: string,
	): Promise<CreditBalance | null> {
		const balance = this.creditBalances.get(`${organizationId}:${customerId}`);
		return balance ? { ...balance } : null;
	}

	async listLedgerEntries(
		organizationId: string,
		customerId: string,
	): Promise<BillingLedgerEntry[]> {
		return this.ledgerEntries
			.filter(
				(e) =>
					e.organizationId === organizationId && e.customerId === customerId,
			)
			.map((e) => ({ ...e }));
	}

	async listAdjustments(
		organizationId: string,
		customerId?: string,
	): Promise<BillingAdjustment[]> {
		return this.adjustments
			.filter(
				(a) =>
					a.organizationId === organizationId &&
					(!customerId || a.customerId === customerId),
			)
			.map((a) => ({ ...a }));
	}

	async findAdjustmentByReference(
		organizationId: string,
		referenceType: string | null | undefined,
		referenceId: string,
	): Promise<BillingAdjustment | null> {
		const found = this.adjustments.find(
			(a) =>
				a.organizationId === organizationId &&
				a.referenceId === referenceId &&
				(referenceType === undefined ||
					referenceType === null ||
					a.referenceType === referenceType),
		);
		return found ? { ...found } : null;
	}

	async listMismatches(
		organizationId: string,
	): Promise<BillingMismatchRecord[]> {
		const results: BillingMismatchRecord[] = [
			...this.seededMismatches.filter(
				(m) => m.organizationId === organizationId,
			),
		];

		// 1. paid_unregistered: Order projection is fully paid, but no confirmed entitlement
		for (const order of this.orderProjections) {
			if (order.organizationId !== organizationId || !order.fullyPaidAt)
				continue;
			const entitlement = this.classEntitlements.find(
				(e) =>
					e.organizationId === organizationId &&
					e.shopifyOrderGid === order.shopifyOrderGid &&
					e.status === "confirmed",
			);
			if (!entitlement) {
				const intent = this.checkoutIntents.find(
					(ci) =>
						ci.organizationId === organizationId &&
						ci.correlationId === order.correlationId,
				);
				const cart = intent?.cartReference
					? this.checkoutCarts.find(
							(cc) =>
								cc.organizationId === organizationId &&
								cc.reference === intent.cartReference,
						)
					: undefined;
				const customerId =
					intent?.customerId ??
					cart?.customerId ??
					order.shopifyCustomerGid ??
					"unknown";
				const amountCents = intent?.amount
					? Math.round(Number.parseFloat(intent.amount) * 100)
					: null;
				results.push({
					id: randomUUID(),
					organizationId,
					customerId,
					mismatchType: "paid_unregistered",
					description:
						"Shopify order is fully paid but no class entitlement was created.",
					shopifyOrderId: order.shopifyOrderGid,
					amountCents,
					currencyCode: order.currencyCode ?? "USD",
					createdAtIso: new Date().toISOString(),
				});
			}
		}

		// 2. registered_unpaid: Confirmed entitlement, but order projection is missing or not fully paid and paidAmountCents == 0
		for (const entitlement of this.classEntitlements) {
			if (
				entitlement.organizationId !== organizationId ||
				entitlement.status !== "confirmed"
			)
				continue;
			const order = this.orderProjections.find(
				(o) =>
					o.organizationId === organizationId &&
					o.shopifyOrderGid === entitlement.shopifyOrderGid,
			);
			if (!order?.fullyPaidAt && entitlement.paidAmountCents === 0) {
				results.push({
					id: randomUUID(),
					organizationId,
					customerId: entitlement.parentCustomerId,
					mismatchType: "registered_unpaid",
					description:
						"Class entitlement is registered but payment has not been received.",
					entitlementId: entitlement.id,
					shopifyOrderId: entitlement.shopifyOrderGid,
					amountCents: 0,
					currencyCode: entitlement.paidCurrencyCode,
					createdAtIso: new Date().toISOString(),
				});
			}
		}

		// 3. partial_payment: Confirmed entitlement where paidAmountCents < expected from checkout intent
		for (const entitlement of this.classEntitlements) {
			if (
				entitlement.organizationId !== organizationId ||
				entitlement.status !== "confirmed" ||
				entitlement.paidAmountCents <= 0
			)
				continue;
			const intent = this.checkoutIntents.find(
				(ci) =>
					ci.organizationId === organizationId &&
					ci.id === entitlement.checkoutIntentId,
			);
			if (intent?.amount) {
				const expectedCents = Math.round(
					Number.parseFloat(intent.amount) * 100,
				);
				if (entitlement.paidAmountCents < expectedCents) {
					results.push({
						id: randomUUID(),
						organizationId,
						customerId: entitlement.parentCustomerId,
						mismatchType: "partial_payment",
						description: "Partial payment received for class entitlement.",
						entitlementId: entitlement.id,
						shopifyOrderId: entitlement.shopifyOrderGid,
						amountCents: entitlement.paidAmountCents,
						currencyCode: entitlement.paidCurrencyCode,
						createdAtIso: new Date().toISOString(),
					});
				}
			}
		}

		return results;
	}
}
