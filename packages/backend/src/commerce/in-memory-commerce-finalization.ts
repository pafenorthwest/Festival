import { randomUUID } from "node:crypto";
import {
	assertValidClassEntitlementInput,
	assertValidEntitlementGrantSnapshotInput,
	type ClassEntitlement,
	type CreateClassEntitlementInput,
	type EntitlementGrantSnapshot,
} from "@festival/common";
import { AppError } from "../errors/app-error.js";
import { withInMemoryCapacityLock } from "../repo/in-memory-capacity-lock.js";
import {
	assertMatchingInMemoryClassReplay,
	createClassEntitlementInStore,
} from "./in-memory-commerce-class-entitlements.js";
import {
	type InMemoryCommerceState,
	markDeliveryProcessedInStore,
	upsertOrderProjectionInStore,
} from "./in-memory-commerce-deliveries.js";
import {
	captureInMemoryFinalizationSnapshot,
	restoreInMemoryFinalizationSnapshot,
} from "./in-memory-commerce-snapshots.js";
import type {
	MembershipCommerceRepository,
	MembershipDecisionAuditRecord,
	MembershipValidationDecision,
	ResolveDecisionManuallyInput,
} from "./membership-commerce-repository.js";

type FinalizeInput = Parameters<
	MembershipCommerceRepository["finalizeDecision"]
>[0];

async function resolveTerminalIntent(
	state: InMemoryCommerceState,
	decision: MembershipValidationDecision,
) {
	if (
		!state.checkout ||
		!decision.checkoutIntentId ||
		decision.status === "pending_validation"
	)
		return;
	await state.checkout.resolveIntent(
		decision.checkoutIntentId,
		decision.status,
	);
}

async function checkOrderReplay(
	state: InMemoryCommerceState,
	input: FinalizeInput,
	classInputs: CreateClassEntitlementInput[],
	existing: MembershipValidationDecision | undefined,
) {
	if (!existing || existing.status === "pending_validation") return undefined;
	const existingClasses = classInputs.map((ci) => {
		const id = state.classEntitlementsByLine.get(
			`${input.decision.organizationId}\u0000${ci.shopifyOrderLineGid}`,
		);
		const ec = id ? (state.classEntitlements.get(id) ?? null) : null;
		if (ec) assertMatchingInMemoryClassReplay(ec, ci);
		return ec;
	});
	if (classInputs.length > 0 && !existingClasses.every(Boolean))
		return undefined;
	await resolveTerminalIntent(state, existing);
	markDeliveryProcessedInStore(state, input.deliveryId);
	return {
		decision: { ...existing },
		classEntitlement: existingClasses[0] ?? undefined,
		classEntitlements: existingClasses.filter((c): c is ClassEntitlement =>
			Boolean(c),
		),
		existing: true,
	};
}

async function checkIndexReplay(
	state: InMemoryCommerceState,
	input: FinalizeInput,
	orderKey: string,
) {
	const checkKey = async (indexKey: string | undefined, errMsg: string) => {
		if (!indexKey || indexKey === orderKey) return undefined;
		const existing = state.decisions.get(indexKey);
		if (!existing) throw new Error(errMsg);
		await resolveTerminalIntent(state, existing);
		markDeliveryProcessedInStore(state, input.deliveryId);
		const lineId = input.decision.shopifyOrderLineGid
			? state.classEntitlementsByLine.get(
					`${input.decision.organizationId}\u0000${input.decision.shopifyOrderLineGid}`,
				)
			: undefined;
		const ec = lineId ? state.classEntitlements.get(lineId) : undefined;
		return {
			decision: { ...existing },
			classEntitlement: ec ? { ...ec } : undefined,
			existing: true,
		};
	};
	if (input.decision.checkoutIntentId) {
		const res = await checkKey(
			state.decisionsByCheckoutIntent.get(
				`${input.decision.organizationId}\u0000${input.decision.checkoutIntentId}`,
			),
			"Checkout decision index is invalid.",
		);
		if (res) return res;
	}
	if (input.decision.shopifyOrderLineGid) {
		return checkKey(
			state.decisionsByLine.get(
				`${input.decision.organizationId}\u0000${input.decision.shopifyOrderLineGid}`,
			),
			"Order-line decision index is invalid.",
		);
	}
	return undefined;
}

async function applyApprovedEntities(
	state: InMemoryCommerceState,
	input: FinalizeInput,
	classInputs: CreateClassEntitlementInput[],
) {
	if (input.decision.status !== "approved") {
		if (input.grant || classInputs.length > 0) {
			throw new Error(
				"Non-approved decision cannot create a grant or class entitlement.",
			);
		}
		return {};
	}
	if (input.grant && classInputs.length > 0) {
		throw new Error(
			"Approved decision cannot specify both a membership grant and class entitlement.",
		);
	}
	if (!input.grant && classInputs.length === 0) {
		throw new Error("Approved decision requires a grant or class entitlement.");
	}
	let grant: EntitlementGrantSnapshot | undefined;
	if (input.grant) {
		assertValidEntitlementGrantSnapshotInput(input.grant);
		grant = await state.organizations.createEntitlementGrantSnapshot(
			input.grant,
		);
	}
	let classEntitlements: ClassEntitlement[] | undefined;
	if (classInputs.length > 0) {
		classEntitlements = [];
		for (const ci of classInputs) {
			assertValidClassEntitlementInput(ci);
			const ce = createClassEntitlementInStore(state, ci);
			classEntitlements.push(ce);
			if (state.checkout && ci.checkoutIntentId) {
				await state.checkout.linkRegistrationMetadataToEntitlement({
					checkoutIntentId: ci.checkoutIntentId,
					checkoutIntentLineId: ci.checkoutIntentLineId ?? undefined,
					classEntitlementId: ce.id,
				});
			}
		}
	}
	return { grant, classEntitlements };
}

async function finalizeDecisionInternal(
	state: InMemoryCommerceState,
	input: FinalizeInput,
) {
	if (input.classEntitlement && input.classEntitlements !== undefined) {
		throw new Error(
			"Approved decision cannot specify both a class entitlement and class entitlements.",
		);
	}
	const classInputs =
		input.classEntitlements ??
		(input.classEntitlement ? [input.classEntitlement] : []);
	for (const ci of classInputs) assertValidClassEntitlementInput(ci);
	const orderKey = `${input.decision.organizationId}\u0000${input.decision.shopifyOrderGid}`;
	const existing = state.decisions.get(orderKey);
	const replay =
		(await checkOrderReplay(state, input, classInputs, existing)) ??
		(await checkIndexReplay(state, input, orderKey));
	if (replay) return replay;
	if (
		input.projection &&
		(input.projection.organizationId !== input.decision.organizationId ||
			input.projection.shopifyOrderGid !== input.decision.shopifyOrderGid)
	) {
		throw new Error("Order projection does not match its validation decision.");
	}
	if (input.projection) upsertOrderProjectionInStore(state, input.projection);
	const { grant, classEntitlements } = await applyApprovedEntities(
		state,
		input,
		classInputs,
	);
	const decision: MembershipValidationDecision = {
		...input.decision,
		id: existing?.id ?? randomUUID(),
		createdAtIso: existing?.createdAtIso ?? input.decision.updatedAtIso,
	};
	state.decisions.set(orderKey, decision);
	if (decision.checkoutIntentId)
		state.decisionsByCheckoutIntent.set(
			`${decision.organizationId}\u0000${decision.checkoutIntentId}`,
			orderKey,
		);
	if (decision.shopifyOrderLineGid)
		state.decisionsByLine.set(
			`${decision.organizationId}\u0000${decision.shopifyOrderLineGid}`,
			orderKey,
		);
	await resolveTerminalIntent(state, decision);
	markDeliveryProcessedInStore(state, input.deliveryId);
	return {
		decision: { ...decision },
		grant,
		classEntitlement: classEntitlements?.[0],
		classEntitlements,
		existing: false,
	};
}

async function runFinalizeWithRollback(
	state: InMemoryCommerceState,
	rawInput: FinalizeInput,
) {
	const execution = rawInput.decision.checkoutIntentId
		? await state.checkout?.classExecutions?.get(
				rawInput.decision.organizationId,
				rawInput.decision.checkoutIntentId,
			)
		: null;
	const input =
		execution &&
		(execution.checkpoint !== "attached" || execution.state === "rejected")
			? {
					...rawInput,
					decision: {
						...rawInput.decision,
						status: "needs_review" as const,
						reasonCode: "upstream_invalid" as const,
					},
					grant: undefined,
					classEntitlement: undefined,
					classEntitlements: undefined,
				}
			: rawInput;
	const classInputs =
		input.classEntitlements ??
		(input.classEntitlement ? [input.classEntitlement] : []);
	const snap = captureInMemoryFinalizationSnapshot(state, input, classInputs);
	try {
		const res = await finalizeDecisionInternal(state, input);
		if (execution && !res.existing && input.decision.checkoutIntentId) {
			await state.checkout?.classExecutions?.observePayment({
				organizationId: input.decision.organizationId,
				intentId: input.decision.checkoutIntentId,
				shopifyOrderGid: input.decision.shopifyOrderGid,
				approved: res.decision.status === "approved",
			});
		}
		return res;
	} catch (error) {
		restoreInMemoryFinalizationSnapshot(state, input.deliveryId, snap);
		throw error;
	}
}

export async function finalizeDecisionInStore(
	state: InMemoryCommerceState,
	rawInput: FinalizeInput,
) {
	const key = `${rawInput.decision.organizationId}\u0000${rawInput.decision.checkoutIntentId ? `intent:${rawInput.decision.checkoutIntentId}` : `order:${rawInput.decision.shopifyOrderGid}`}${rawInput.decision.shopifyOrderLineGid ? `:line:${rawInput.decision.shopifyOrderLineGid}` : ""}`;
	const pending = state.finalizations.get(key);
	if (pending) {
		const res = await pending;
		markDeliveryProcessedInStore(state, rawInput.deliveryId);
		return { ...res, existing: true };
	}
	const work = withInMemoryCapacityLock(() =>
		runFinalizeWithRollback(state, rawInput),
	);
	state.finalizations.set(key, work);
	try {
		return await work;
	} finally {
		if (state.finalizations.get(key) === work) state.finalizations.delete(key);
	}
}

function recordManualDecisionIndices(
	state: InMemoryCommerceState,
	updated: MembershipValidationDecision,
) {
	const orderKey = `${updated.organizationId}\u0000${updated.shopifyOrderGid}`;
	state.decisions.set(orderKey, updated);
	if (updated.checkoutIntentId) {
		state.decisionsByCheckoutIntent.set(
			`${updated.organizationId}\u0000${updated.checkoutIntentId}`,
			orderKey,
		);
	}
	if (updated.shopifyOrderLineGid) {
		state.decisionsByLine.set(
			`${updated.organizationId}\u0000${updated.shopifyOrderLineGid}`,
			orderKey,
		);
	}
}

async function applyManualResolutionInStore(
	state: InMemoryCommerceState,
	input: ResolveDecisionManuallyInput,
) {
	const existing = [...state.decisions.values()].find(
		(d) =>
			d.id === input.decisionId && d.organizationId === input.organizationId,
	);
	if (!existing) throw new AppError("Validation decision was not found.", 404);
	if (
		existing.status !== "pending_validation" &&
		existing.status !== "needs_review"
	) {
		throw new AppError("Validation decision is already resolved.", 409);
	}
	let grant: EntitlementGrantSnapshot | undefined;
	if (input.finalStatus === "approved") {
		if (!input.grant)
			throw new AppError("Approved decision requires a grant.", 422);
		assertValidEntitlementGrantSnapshotInput(input.grant);
		grant = await state.organizations.createEntitlementGrantSnapshot(
			input.grant,
		);
	}
	if (input.projection) upsertOrderProjectionInStore(state, input.projection);
	const updated: MembershipValidationDecision = {
		...existing,
		customerId: input.customerId ?? existing.customerId,
		checkoutIntentId: input.checkoutIntentId ?? existing.checkoutIntentId,
		shopifyOrderLineGid:
			input.shopifyOrderLineGid ?? existing.shopifyOrderLineGid,
		status: input.finalStatus,
		reasonCode:
			input.finalStatus === "approved" ? undefined : existing.reasonCode,
		updatedAtIso: input.resolvedAtIso,
	};
	recordManualDecisionIndices(state, updated);
	await resolveTerminalIntent(state, updated);
	const audit: MembershipDecisionAuditRecord = {
		id: randomUUID(),
		organizationId: input.organizationId,
		decisionId: updated.id,
		priorStatus: existing.status,
		finalStatus: input.finalStatus,
		actorUserId: input.actorUserId,
		note: input.note,
		resolvedAtIso: input.resolvedAtIso,
	};
	state.decisionAudits.set(updated.id, audit);
	return { decision: { ...updated }, grant, audit: { ...audit } };
}

export async function resolveDecisionManuallyInStore(
	state: InMemoryCommerceState,
	input: ResolveDecisionManuallyInput,
) {
	return withInMemoryCapacityLock(() =>
		applyManualResolutionInStore(state, input),
	);
}
