import type { CreateClassEntitlementInput } from "@festival/common";
import type { CheckoutRepository } from "../checkout/checkout-repository.js";
import type { InMemoryCommerceState } from "./in-memory-commerce-deliveries.js";
import type { MembershipCommerceRepository } from "./membership-commerce-repository.js";

type FinalizeInput = Parameters<
	MembershipCommerceRepository["finalizeDecision"]
>[0];

interface RegistrationMetadataEntitlementLinkRollback {
	snapshotRegistrationMetadataEntitlementLinks(input: {
		checkoutIntentIds: string[];
		checkoutIntentLineIds: string[];
	}): Map<string, string | null>;
	restoreRegistrationMetadataEntitlementLinks(
		snapshot: Map<string, string | null>,
	): void;
}

function supportsLinkRollback(
	checkout: CheckoutRepository | undefined,
): checkout is CheckoutRepository &
	RegistrationMetadataEntitlementLinkRollback {
	const c = checkout as
		| Partial<RegistrationMetadataEntitlementLinkRollback>
		| undefined;
	return (
		typeof c?.snapshotRegistrationMetadataEntitlementLinks === "function" &&
		typeof c.restoreRegistrationMetadataEntitlementLinks === "function"
	);
}

function captureClassInputSnapshots(
	state: InMemoryCommerceState,
	classInputs: CreateClassEntitlementInput[],
) {
	return {
		classLines: classInputs.map((ci) => {
			const key = `${ci.organizationId}\u0000${ci.shopifyOrderLineGid}`;
			return {
				key,
				had: state.classEntitlementsByLine.has(key),
				val: state.classEntitlementsByLine.get(key),
			};
		}),
		classIntents: [
			...new Set(
				classInputs.map(
					(ci) => `${ci.organizationId}\u0000${ci.checkoutIntentId}`,
				),
			),
		].map((key) => ({
			key,
			had: state.classEntitlementsByIntent.has(key),
			val: state.classEntitlementsByIntent.get(key),
		})),
	};
}

export function captureInMemoryFinalizationSnapshot(
	state: InMemoryCommerceState,
	input: FinalizeInput,
	classInputs: CreateClassEntitlementInput[],
) {
	const orderKey = `${input.decision.organizationId}\u0000${input.decision.shopifyOrderGid}`;
	const checkoutKey = input.decision.checkoutIntentId
		? `${input.decision.organizationId}\u0000${input.decision.checkoutIntentId}`
		: undefined;
	const lineKey = input.decision.shopifyOrderLineGid
		? `${input.decision.organizationId}\u0000${input.decision.shopifyOrderLineGid}`
		: undefined;
	const linkRollback = supportsLinkRollback(state.checkout)
		? state.checkout
		: undefined;
	const delivery = state.deliveries.get(input.deliveryId);
	return {
		...captureClassInputSnapshots(state, classInputs),
		linkRollback,
		linkSnap: linkRollback?.snapshotRegistrationMetadataEntitlementLinks({
			checkoutIntentIds: classInputs.map((ci) => ci.checkoutIntentId),
			checkoutIntentLineIds: classInputs.flatMap((ci) =>
				ci.checkoutIntentLineId ? [ci.checkoutIntentLineId] : [],
			),
		}),
		proj: {
			key: orderKey,
			had: state.projections.has(orderKey),
			val: state.projections.get(orderKey),
		},
		dec: {
			key: orderKey,
			had: state.decisions.has(orderKey),
			val: state.decisions.get(orderKey),
		},
		chkDec: checkoutKey
			? {
					key: checkoutKey,
					had: state.decisionsByCheckoutIntent.has(checkoutKey),
					val: state.decisionsByCheckoutIntent.get(checkoutKey),
				}
			: undefined,
		lineDec: lineKey
			? {
					key: lineKey,
					had: state.decisionsByLine.has(lineKey),
					val: state.decisionsByLine.get(lineKey),
				}
			: undefined,
		delivery: delivery ? { ...delivery } : undefined,
	};
}

function restoreMapEntry<V>(
	map: Map<string, V>,
	entry?: { key: string; had: boolean; val: V | undefined },
) {
	if (!entry) return;
	if (entry.had && entry.val !== undefined) map.set(entry.key, entry.val);
	else map.delete(entry.key);
}

export function restoreInMemoryFinalizationSnapshot(
	state: InMemoryCommerceState,
	deliveryId: string,
	snap: ReturnType<typeof captureInMemoryFinalizationSnapshot>,
) {
	for (const line of snap.classLines) {
		if (!line.had) {
			const createdId = state.classEntitlementsByLine.get(line.key);
			if (createdId) state.classEntitlements.delete(createdId);
		}
		restoreMapEntry(state.classEntitlementsByLine, line);
	}
	for (const intent of snap.classIntents)
		restoreMapEntry(state.classEntitlementsByIntent, intent);
	if (snap.linkSnap)
		snap.linkRollback?.restoreRegistrationMetadataEntitlementLinks(
			snap.linkSnap,
		);
	restoreMapEntry(state.projections, snap.proj);
	restoreMapEntry(state.decisions, snap.dec);
	restoreMapEntry(state.decisionsByCheckoutIntent, snap.chkDec);
	restoreMapEntry(state.decisionsByLine, snap.lineDec);
	if (snap.delivery) state.deliveries.set(deliveryId, snap.delivery);
}
