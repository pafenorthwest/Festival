import { AppError } from "@festival/common";
import type { OrderProjectionRepository } from "./order-projection-repository.js";
import type {
	MembershipDecisionAuditRecord,
	MembershipReconciliationRun,
	MembershipValidationDecision,
	ResolveDecisionManuallyInput,
	ResolveDecisionManuallyResult,
} from "./order-projection-types.js";

export interface ReconciliationRunTarget {
	reconcile(organizationId: string): Promise<{
		discoveredCount: number;
		processedCount: number;
	}>;
}

export class ReconciliationService {
	constructor(
		private readonly repository: Pick<
			OrderProjectionRepository,
			| "listCustomerDecisions"
			| "listReconciliationRuns"
			| "listUnresolvedDecisions"
			| "getDecisionById"
			| "getDecisionAudit"
			| "resolveDecisionManually"
		>,
		private readonly projection?: ReconciliationRunTarget,
	) {}

	listCustomerDecisions(
		organizationId: string,
		customerId: string,
	): Promise<MembershipValidationDecision[]> {
		return this.repository.listCustomerDecisions(organizationId, customerId);
	}

	listReconciliationRuns(
		organizationId: string,
		limit?: number,
	): Promise<MembershipReconciliationRun[]> {
		return this.repository.listReconciliationRuns(organizationId, limit);
	}

	listUnresolvedDecisions(
		organizationId: string,
	): Promise<MembershipValidationDecision[]> {
		return this.repository.listUnresolvedDecisions(organizationId);
	}

	getDecisionById(
		organizationId: string,
		decisionId: string,
	): Promise<MembershipValidationDecision | null> {
		return this.repository.getDecisionById(organizationId, decisionId);
	}

	getDecisionAudit(
		organizationId: string,
		decisionId: string,
	): Promise<MembershipDecisionAuditRecord | null> {
		return this.repository.getDecisionAudit(organizationId, decisionId);
	}

	resolveDecisionManually(
		input: ResolveDecisionManuallyInput,
	): Promise<ResolveDecisionManuallyResult> {
		return this.repository.resolveDecisionManually(input);
	}

	reconcile(organizationId: string): Promise<{
		discoveredCount: number;
		processedCount: number;
	}> {
		if (!this.projection) {
			throw new AppError(
				"Shopify order projection service is unavailable.",
				500,
			);
		}
		return this.projection.reconcile(organizationId);
	}
}
