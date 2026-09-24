import type {
	ShopifyMutationAuditAttemptInput,
	ShopifyMutationAuditInput,
	ShopifyMutationAuditOperation,
	ShopifyMutationAuditWriter,
} from "../shopify/admin-mutation-audit.js";
import { ShopifyIntegrationError } from "../shopify/errors.js";
import type {
	ShopifyAdminOperationContext,
	ShopifyAdminResult,
} from "../shopify/types.js";

function failureAudit(
	audit: ShopifyMutationAuditAttemptInput,
	error: unknown,
): ShopifyMutationAuditInput {
	const isErr = error instanceof ShopifyIntegrationError;
	return {
		...audit,
		result: "failure",
		requestId: isErr ? error.requestId : undefined,
		failureCategory: isErr ? error.failureCategory : "transport",
	};
}

export async function attemptAdminMutation<T>(
	auditWriter: ShopifyMutationAuditWriter | undefined,
	context: ShopifyAdminOperationContext,
	operation: ShopifyMutationAuditOperation,
	execute: () => Promise<ShopifyAdminResult<T>>,
): Promise<T> {
	const audit: ShopifyMutationAuditAttemptInput = {
		timestampIso: new Date().toISOString(),
		firebaseActorUid: context.firebaseActorUid,
		organizationId: context.organizationId,
		operation,
	};
	if (auditWriter) await auditWriter.ensureReady(audit);
	try {
		const result = await execute();
		if (auditWriter) {
			await auditWriter.append({
				...audit,
				result: "success",
				requestId: result.requestId,
			});
		}
		return result.value;
	} catch (error) {
		if (auditWriter) await auditWriter.append(failureAudit(audit, error));
		throw error;
	}
}
