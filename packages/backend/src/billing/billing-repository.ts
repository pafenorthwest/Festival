import { randomUUID } from "node:crypto";
import type {
	BillingAdjustment,
	BillingLedgerEntry,
	BillingMismatchRecord,
	CreateBillingAdjustmentInput,
	CreditBalance,
} from "@festival/common";
import {
	type BillingRepository,
	type CreateAdjustmentOptions,
	type CreateAdjustmentResult,
	DuplicateAdjustmentError,
	InsufficientCreditBalanceError,
	resolveAdjustmentDirection,
	resolveLedgerEntryType,
} from "../domains/commerce-projection/index.js";
import {
	detectPaidUnregisteredMismatches,
	detectPartialPaymentMismatches,
	detectRegisteredUnpaidMismatches,
} from "./in-memory-billing-mismatches.js";

export {
	type BillingRepository,
	type CreateAdjustmentOptions,
	type CreateAdjustmentResult,
	DuplicateAdjustmentError,
	InsufficientCreditBalanceError,
	resolveAdjustmentDirection,
	resolveLedgerEntryType,
};

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
	checkoutIntentLineId?: string | null;
	shopifyOrderGid: string;
	paidAmountCents: number;
	paidCurrencyCode: string;
	status: string;
}

export interface SeedCheckoutIntentLine {
	id: string;
	checkoutIntentId: string;
	organizationId?: string;
	amount: string;
	currencyCode?: string;
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
	private readonly checkoutIntentLines: SeedCheckoutIntentLine[] = [];
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

	seedCheckoutIntentLines(items: SeedCheckoutIntentLine[]) {
		this.checkoutIntentLines.push(...items);
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
		const newBalance =
			current.balanceCents +
			(direction === "inflow" ? input.amountCents : -input.amountCents);
		if (newBalance < 0) {
			throw new InsufficientCreditBalanceError(
				`Adjustment would result in negative credit balance: ${newBalance} cents. Available: ${current.balanceCents} cents.`,
			);
		}
		return this.recordAdjustmentRecords(
			input,
			balanceKey,
			current.currencyCode,
			entryType,
			direction,
			newBalance,
			options?.notes ?? null,
		);
	}

	private recordAdjustmentRecords(
		input: CreateBillingAdjustmentInput,
		balanceKey: string,
		fallbackCurrency: string,
		entryType: BillingLedgerEntry["entryType"],
		direction: BillingLedgerEntry["direction"],
		newBalance: number,
		notes: string | null,
	): CreateAdjustmentResult {
		const nowIso = new Date().toISOString();
		const currencyCode = input.currencyCode ?? fallbackCurrency;
		const adjustment: BillingAdjustment = {
			id: randomUUID(),
			organizationId: input.organizationId,
			customerId: input.customerId,
			adminUserId: input.adminUserId,
			adjustmentType: input.adjustmentType,
			amountCents: input.amountCents,
			currencyCode,
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
			currencyCode,
			adjustmentId: adjustment.id,
			notes,
			createdAtIso: nowIso,
		};
		this.ledgerEntries.push(ledgerEntry);
		const creditBalance: CreditBalance = {
			organizationId: input.organizationId,
			customerId: input.customerId,
			balanceCents: newBalance,
			currencyCode,
			updatedAtIso: nowIso,
		};
		this.creditBalances.set(balanceKey, creditBalance);
		return { adjustment, ledgerEntry, creditBalance };
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
		const state = {
			orderProjections: this.orderProjections,
			classEntitlements: this.classEntitlements,
			checkoutIntents: this.checkoutIntents,
			checkoutIntentLines: this.checkoutIntentLines,
			checkoutCarts: this.checkoutCarts,
		};
		return [
			...this.seededMismatches.filter(
				(m) => m.organizationId === organizationId,
			),
			...detectPaidUnregisteredMismatches(organizationId, state),
			...detectRegisteredUnpaidMismatches(organizationId, state),
			...detectPartialPaymentMismatches(organizationId, state),
		];
	}
}
