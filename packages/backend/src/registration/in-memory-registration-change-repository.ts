import { randomUUID } from "node:crypto";
import type {
	RefundEvent,
	RefundEventStatus,
	RegistrationChangeLog,
} from "@festival/common";
import {
	isRefundEventStatus,
	isRegistrationActorRole,
	isRegistrationChangeAction,
} from "@festival/common";
import {
	type CreateRefundEventInput,
	type CreateRegistrationChangeLogInput,
	normalizeUpdateRefundEventInput,
	type RegistrationChangeRepository,
	type UpdateRefundEventStatusInput,
} from "../domains/class-checkout/registration-change-repository.js";

export class InMemoryRegistrationChangeRepository
	implements RegistrationChangeRepository
{
	private readonly changeLogs = new Map<string, RegistrationChangeLog>();
	private readonly refundEvents = new Map<string, RefundEvent>();

	constructor(private readonly now: () => Date = () => new Date()) {}

	async ensureReady(): Promise<void> {}

	async createChangeLog(
		input: CreateRegistrationChangeLogInput,
	): Promise<RegistrationChangeLog> {
		if (!isRegistrationChangeAction(input.action)) {
			throw new Error("Registration change action is invalid.");
		}
		if (!isRegistrationActorRole(input.actorRole)) {
			throw new Error("Registration actor role is invalid.");
		}
		const id = input.id ?? randomUUID();
		const nowIso = input.createdAt ?? this.now().toISOString();
		const record: RegistrationChangeLog = {
			id,
			organizationId: input.organizationId,
			festivalId: input.festivalId ?? null,
			classEntitlementId: input.classEntitlementId,
			action: input.action,
			actorUid: input.actorUid,
			actorRole: input.actorRole,
			previousState: { ...input.previousState },
			newState: { ...input.newState },
			reason: input.reason ?? null,
			createdAt: nowIso,
		};
		this.changeLogs.set(id, record);
		return { ...record };
	}

	async listChangeLogsForEntitlement(
		organizationIdOrEntitlementId: string,
		classEntitlementId?: string,
	): Promise<RegistrationChangeLog[]> {
		const targetEntitlementId =
			classEntitlementId !== undefined
				? classEntitlementId
				: organizationIdOrEntitlementId;
		const targetOrgId =
			classEntitlementId !== undefined
				? organizationIdOrEntitlementId
				: undefined;

		return [...this.changeLogs.values()]
			.filter((log) => {
				if (log.classEntitlementId !== targetEntitlementId) return false;
				if (targetOrgId && log.organizationId !== targetOrgId) return false;
				return true;
			})
			.sort(
				(a, b) =>
					b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
			)
			.map((log) => ({ ...log }));
	}

	async createRefundEvent(input: CreateRefundEventInput): Promise<RefundEvent> {
		const status = input.status ?? "pending";
		if (!isRefundEventStatus(status)) {
			throw new Error("Refund event status is invalid.");
		}
		const id = input.id ?? randomUUID();
		const nowIso = this.now().toISOString();
		const record: RefundEvent = {
			id,
			organizationId: input.organizationId,
			registrationChangeLogId: input.registrationChangeLogId ?? null,
			classEntitlementId: input.classEntitlementId ?? null,
			shopifyOrderId: input.shopifyOrderId ?? null,
			shopifyOrderLineId: input.shopifyOrderLineId ?? null,
			shopifyRefundId: input.shopifyRefundId ?? null,
			amountCents: input.amountCents,
			currency: input.currency ?? "USD",
			status,
			failureReason: input.failureReason ?? null,
			createdAt: input.createdAt ?? nowIso,
			updatedAt: input.updatedAt ?? nowIso,
		};
		this.refundEvents.set(id, record);
		return { ...record };
	}

	async getRefundEvent(
		organizationIdOrId: string,
		id?: string,
	): Promise<RefundEvent | null> {
		const targetId = id !== undefined ? id : organizationIdOrId;
		const targetOrgId = id !== undefined ? organizationIdOrId : undefined;
		const record = this.refundEvents.get(targetId);
		if (!record) return null;
		if (targetOrgId && record.organizationId !== targetOrgId) return null;
		return { ...record };
	}

	async updateRefundEventStatus(
		idOrOrgIdOrInput: string | UpdateRefundEventStatusInput,
		idOrStatus?: string | RefundEventStatus,
		statusOrFailureReason?: RefundEventStatus | string | null,
		failureReason?: string | null,
	): Promise<RefundEvent | null> {
		const normalized = normalizeUpdateRefundEventInput(
			idOrOrgIdOrInput,
			idOrStatus,
			statusOrFailureReason,
			failureReason,
		);
		if (!isRefundEventStatus(normalized.status)) {
			throw new Error("Refund event status is invalid.");
		}
		const record = this.refundEvents.get(normalized.id);
		if (!record) return null;
		if (
			normalized.organizationId &&
			record.organizationId !== normalized.organizationId
		) {
			return null;
		}
		record.status = normalized.status;
		if (normalized.shopifyRefundId !== undefined) {
			record.shopifyRefundId = normalized.shopifyRefundId;
		}
		if (normalized.failureReason !== undefined) {
			record.failureReason = normalized.failureReason;
		}
		record.updatedAt = this.now().toISOString();
		return { ...record };
	}
}
