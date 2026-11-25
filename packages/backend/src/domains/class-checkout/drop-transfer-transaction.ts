import type { ClassEntitlement } from "@festival/common";
import { sql } from "bun";
import {
	type ClassCheckoutDomainEvent,
	ClassCheckoutEventBus,
} from "./events.js";
import type { CheckoutCommerceReadPort } from "./ports.js";
import type { RegistrationChangeRepository } from "./registration-change-repository.js";

export interface DropTransferTransactionalDeps {
	entitlements: CheckoutCommerceReadPort;
	changeRepo: RegistrationChangeRepository;
	eventBus?: ClassCheckoutEventBus;
}

interface SnapshotCapable {
	createTransactionSnapshot(): () => void;
}

function captureObjectSnapshot(target: object): (() => void) | null {
	if (
		"createTransactionSnapshot" in target &&
		typeof (target as Partial<SnapshotCapable>).createTransactionSnapshot ===
			"function"
	) {
		return (target as SnapshotCapable).createTransactionSnapshot();
	}
	for (const desc of Object.values(Object.getOwnPropertyDescriptors(target))) {
		const val: unknown = desc.value;
		if (
			val &&
			typeof val === "object" &&
			"createTransactionSnapshot" in val &&
			typeof (val as Partial<SnapshotCapable>).createTransactionSnapshot ===
				"function"
		) {
			return (val as SnapshotCapable).createTransactionSnapshot();
		}
	}
	return null;
}

async function rollbackEntitlementSnapshots(
	entitlements: CheckoutCommerceReadPort,
	priorById: ReadonlyMap<string, ClassEntitlement>,
): Promise<void> {
	for (const prior of [...priorById.values()].reverse()) {
		if (entitlements.updateClassEntitlement) {
			await entitlements.updateClassEntitlement(
				prior.organizationId,
				prior.id,
				{ festivalClassId: prior.festivalClassId, status: prior.status },
			);
		} else if (entitlements.updateClassEntitlementStatus) {
			await entitlements.updateClassEntitlementStatus(
				prior.organizationId,
				prior.id,
				prior.status,
			);
		}
	}
}

type UpdateEntitlementFn = NonNullable<
	CheckoutCommerceReadPort["updateClassEntitlement"]
>;
type UpdateStatusFn = NonNullable<
	CheckoutCommerceReadPort["updateClassEntitlementStatus"]
>;

function createCompensatingEntitlementsPort(
	entitlements: CheckoutCommerceReadPort,
): { port: CheckoutCommerceReadPort; rollback: () => Promise<void> } {
	const priorById = new Map<string, ClassEntitlement>();
	const recordPrior = async (orgId: string, id: string): Promise<void> => {
		if (priorById.has(id) || !entitlements.getClassEntitlement) return;
		const existing = await entitlements.getClassEntitlement(orgId, id);
		if (existing) priorById.set(id, { ...existing });
	};
	const port = new Proxy(entitlements, {
		get(target, prop) {
			if (
				prop === "updateClassEntitlement" &&
				typeof target.updateClassEntitlement === "function"
			) {
				return async (...args: Parameters<UpdateEntitlementFn>) => {
					await recordPrior(args[0], args[1]);
					return target.updateClassEntitlement?.(...args) ?? null;
				};
			}
			if (
				prop === "updateClassEntitlementStatus" &&
				typeof target.updateClassEntitlementStatus === "function"
			) {
				return async (...args: Parameters<UpdateStatusFn>) => {
					await recordPrior(args[0], args[1]);
					return target.updateClassEntitlementStatus?.(...args) ?? null;
				};
			}
			const value: unknown = Reflect.get(target, prop, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	return {
		port,
		rollback: () => rollbackEntitlementSnapshots(entitlements, priorById),
	};
}

function prepareNonSqlBindings(deps: DropTransferTransactionalDeps): {
	entitlements: CheckoutCommerceReadPort;
	changeRepo: RegistrationChangeRepository;
	rollback: () => Promise<void>;
} {
	const entSnapshot = deps.entitlements.withTransaction
		? null
		: captureObjectSnapshot(deps.entitlements);
	const entCompensating =
		!deps.entitlements.withTransaction && !entSnapshot
			? createCompensatingEntitlementsPort(deps.entitlements)
			: null;
	const changeSnapshot = deps.changeRepo.withTransaction
		? null
		: captureObjectSnapshot(deps.changeRepo);
	return {
		entitlements: entCompensating ? entCompensating.port : deps.entitlements,
		changeRepo: deps.changeRepo,
		rollback: async () => {
			changeSnapshot?.();
			entSnapshot?.();
			if (entCompensating) await entCompensating.rollback();
		},
	};
}

export async function runDropTransferTransaction<T>(
	deps: DropTransferTransactionalDeps,
	work: (txDeps: DropTransferTransactionalDeps) => Promise<T>,
): Promise<T> {
	const stagedEvents: ClassCheckoutDomainEvent[] = [];
	const stagedBus = new ClassCheckoutEventBus();
	stagedBus.subscribe((event) => {
		stagedEvents.push(event);
	});

	const usesSqlTx =
		typeof deps.entitlements.withTransaction === "function" ||
		typeof deps.changeRepo.withTransaction === "function";
	if (usesSqlTx) {
		await deps.entitlements.prepareTransaction?.();
		await deps.changeRepo.prepareTransaction?.();
		await deps.changeRepo.ensureReady?.();
	}

	const nonSql = prepareNonSqlBindings(deps);
	let result: T;
	try {
		result = usesSqlTx
			? await sql.begin(async (tx) =>
					work({
						entitlements: deps.entitlements.withTransaction
							? deps.entitlements.withTransaction(tx)
							: nonSql.entitlements,
						changeRepo: deps.changeRepo.withTransaction
							? deps.changeRepo.withTransaction(tx)
							: nonSql.changeRepo,
						eventBus: stagedBus,
					}),
				)
			: await work({
					entitlements: nonSql.entitlements,
					changeRepo: nonSql.changeRepo,
					eventBus: stagedBus,
				});
	} catch (error) {
		await nonSql.rollback();
		throw error;
	}

	for (const event of stagedEvents) {
		deps.eventBus?.emit(event);
	}
	return result;
}
