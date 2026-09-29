import {
	assertValidCreateBillingAdjustmentInput,
	type BillingAdjustment,
	type BillingLedgerEntry,
	type BillingMismatchRecord,
	type CreateBillingAdjustmentInput,
	type CreditBalance,
} from "@festival/common";
import { AppError } from "../errors/app-error.js";
import {
	type BillingRepository,
	type CreateAdjustmentOptions,
	DuplicateAdjustmentError,
} from "./billing-repository.js";

export interface ApplyAdjustmentOutcome {
	adjustment: BillingAdjustment;
	ledgerEntry?: BillingLedgerEntry;
	creditBalance: CreditBalance;
	alreadyExisted: boolean;
}

function isDecisionOrMembershipRefund(
	input: CreateBillingAdjustmentInput,
): boolean {
	const refType = input.referenceType?.trim().toLowerCase() ?? "";
	if (
		refType === "decision" ||
		refType === "membership_decision" ||
		refType === "membership_refund" ||
		refType.includes("decision")
	) {
		return true;
	}
	if (input.adjustmentType === "refund" && refType === "membership") {
		return true;
	}
	return false;
}

export class BillingReconciliationService {
	constructor(private readonly repository: BillingRepository) {}

	async applyAdjustment(
		input: CreateBillingAdjustmentInput,
		options?: CreateAdjustmentOptions,
	): Promise<ApplyAdjustmentOutcome> {
		assertValidCreateBillingAdjustmentInput(input);

		if (
			isDecisionOrMembershipRefund(input) &&
			(!input.approvedDecisionId ||
				input.approvedDecisionId.trim().length === 0)
		) {
			throw new AppError(
				"Approved decision ID is required when referencing a decision or membership refund.",
				403,
				"AUTHORITY_BOUNDARY_VIOLATION",
			);
		}

		if (input.referenceId) {
			const existing = await this.repository.findAdjustmentByReference(
				input.organizationId,
				input.referenceType,
				input.referenceId,
			);
			if (existing) {
				const currentBalance = await this.repository.getCreditBalance(
					input.organizationId,
					input.customerId,
				);
				return {
					adjustment: existing,
					creditBalance: currentBalance ?? {
						organizationId: input.organizationId,
						customerId: input.customerId,
						balanceCents: 0,
						currencyCode: input.currencyCode ?? "USD",
					},
					alreadyExisted: true,
				};
			}
		}

		try {
			const result = await this.repository.createAdjustmentWithLedger(
				input,
				options,
			);
			return {
				adjustment: result.adjustment,
				ledgerEntry: result.ledgerEntry,
				creditBalance: result.creditBalance,
				alreadyExisted: false,
			};
		} catch (error) {
			if (error instanceof DuplicateAdjustmentError && input.referenceId) {
				const existing =
					error.existingAdjustment ??
					(await this.repository.findAdjustmentByReference(
						input.organizationId,
						input.referenceType,
						input.referenceId,
					));
				if (existing) {
					const currentBalance = await this.repository.getCreditBalance(
						input.organizationId,
						input.customerId,
					);
					return {
						adjustment: existing,
						creditBalance: currentBalance ?? {
							organizationId: input.organizationId,
							customerId: input.customerId,
							balanceCents: 0,
							currencyCode: input.currencyCode ?? "USD",
						},
						alreadyExisted: true,
					};
				}
			}
			throw error;
		}
	}

	async createAdjustment(
		input: CreateBillingAdjustmentInput,
		options?: CreateAdjustmentOptions,
	): Promise<ApplyAdjustmentOutcome> {
		return this.applyAdjustment(input, options);
	}

	async listMismatches(
		organizationId: string,
	): Promise<BillingMismatchRecord[]> {
		return this.repository.listMismatches(organizationId);
	}

	async getMismatches(
		organizationId: string,
	): Promise<BillingMismatchRecord[]> {
		return this.listMismatches(organizationId);
	}

	async getCreditBalance(
		organizationId: string,
		customerId: string,
	): Promise<CreditBalance | null> {
		return this.repository.getCreditBalance(organizationId, customerId);
	}

	async listLedgerEntries(
		organizationId: string,
		customerId: string,
	): Promise<BillingLedgerEntry[]> {
		return this.repository.listLedgerEntries(organizationId, customerId);
	}

	async listAdjustments(
		organizationId: string,
		customerId?: string,
	): Promise<BillingAdjustment[]> {
		return this.repository.listAdjustments(organizationId, customerId);
	}
}
