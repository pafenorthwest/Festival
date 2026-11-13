import {
	AppError,
	type CustomerClassRegistrationsResponse,
	type FestivalClassConfiguration,
	type FestivalRecord,
	type OrganizationRecord,
} from "@festival/common";
import type { CheckoutRepository } from "./checkout-types.js";
import { buildPortRegistrationItem } from "./customer-registration-query-helpers.js";
import { queryConfirmedCountsSql } from "./customer-registration-sql-queries.js";
import type {
	CheckoutCatalogReadPort,
	CheckoutCommerceReadPort,
	CheckoutCustomerIdentityPort,
	CheckoutCustomerSessionRecord,
	CheckoutOrganizationReadPort,
	CheckoutTeacherDirectoryPort,
} from "./ports.js";

export interface CustomerQueryPortDeps {
	organizations: CheckoutOrganizationReadPort;
	catalog: CheckoutCatalogReadPort;
	customers: CheckoutCustomerIdentityPort;
	teachers: CheckoutTeacherDirectoryPort;
	commerce: CheckoutCommerceReadPort;
	checkout: CheckoutRepository;
	schema: string | null;
	now: () => Date;
}

export async function loadClassConfigsByFestival(
	catalog: CheckoutCatalogReadPort,
	organizationId: string,
	festivals: FestivalRecord[],
): Promise<Map<string, Map<string, FestivalClassConfiguration>>> {
	const entries = await Promise.all(
		festivals.map(async (f) => {
			const configs = await catalog.listFestivalClassConfigurations(
				organizationId,
				f.id,
				false,
			);
			return [f.id, new Map(configs.map((c) => [c.id, c]))] as const;
		}),
	);
	return new Map(entries);
}

export async function countConfirmedByClassIds(
	deps: Pick<CustomerQueryPortDeps, "schema" | "commerce">,
	organizationId: string,
	festivalClassIds: readonly string[],
): Promise<Map<string, number>> {
	if (festivalClassIds.length === 0) return new Map();
	if (deps.schema) {
		return queryConfirmedCountsSql(
			deps.schema,
			organizationId,
			festivalClassIds,
		);
	}
	if (deps.commerce.countConfirmedClassEntitlementsByClassIds) {
		return deps.commerce.countConfirmedClassEntitlementsByClassIds(
			organizationId,
			festivalClassIds,
		);
	}
	const entries = await Promise.all(
		festivalClassIds.map(
			async (id) =>
				[
					id,
					await deps.commerce.countConfirmedClassEntitlements(
						organizationId,
						id,
					),
				] as const,
		),
	);
	return new Map(entries);
}

async function loadPortRegistrationLookups(
	deps: CustomerQueryPortDeps,
	organizationId: string,
	customerId: string,
	entitlements: Awaited<
		ReturnType<CheckoutCommerceReadPort["listClassEntitlements"]>
	>,
	festivals: FestivalRecord[],
) {
	const uniqueChildIds = Array.from(
		new Set(entitlements.map((e) => e.childId)),
	);
	const uniqueOrderGids = Array.from(
		new Set(entitlements.map((e) => e.shopifyOrderGid)),
	);
	const [children, metadataMap, orderProjections, classConfigsByFestival] =
		await Promise.all([
			deps.customers.findChildrenByIds
				? deps.customers.findChildrenByIds(
						organizationId,
						customerId,
						uniqueChildIds,
					)
				: deps.customers.listChildren(organizationId, customerId),
			deps.checkout.listRegistrationMetadataByEntitlementIds
				? deps.checkout.listRegistrationMetadataByEntitlementIds(
						organizationId,
						entitlements.map((e) => e.id),
					)
				: Promise.resolve(new Map()),
			deps.commerce.listOrderProjectionsByGids
				? deps.commerce.listOrderProjectionsByGids(
						organizationId,
						uniqueOrderGids,
					)
				: Promise.resolve([]),
			loadClassConfigsByFestival(deps.catalog, organizationId, festivals),
		]);
	return {
		childrenById: new Map(
			children.map((c) => [c.id, { id: c.id, name: c.displayName }]),
		),
		metadataMap,
		paidAtByOrderGid: new Map(
			orderProjections.map((p) => [
				p.shopifyOrderGid,
				p.fullyPaidAtIso ?? null,
			]),
		),
		classConfigsByFestival,
	};
}

export async function listClassRegistrationsFromPorts(
	deps: CustomerQueryPortDeps,
	params: {
		organizationId: string;
		customerId: string;
		targetFestival: FestivalRecord | null;
		festivals: FestivalRecord[];
		editCutoffs: Map<string, Date>;
	},
): Promise<CustomerClassRegistrationsResponse> {
	const entitlements = await deps.commerce.listClassEntitlements({
		organizationId: params.organizationId,
		parentCustomerId: params.customerId,
		...(params.targetFestival ? { festivalId: params.targetFestival.id } : {}),
	});
	if (entitlements.length === 0) {
		return { registrations: [] };
	}
	const {
		childrenById,
		metadataMap,
		paidAtByOrderGid,
		classConfigsByFestival,
	} = await loadPortRegistrationLookups(
		deps,
		params.organizationId,
		params.customerId,
		entitlements,
		params.festivals,
	);
	const nowMs = deps.now().getTime();
	return {
		registrations: entitlements.map((entitlement) =>
			buildPortRegistrationItem(entitlement, {
				childrenById,
				classConfigsByFestival,
				metadataByEntitlementId: metadataMap,
				paidAtByOrderGid,
				editCutoffs: params.editCutoffs,
				nowMs,
			}),
		),
	};
}

export async function fetchCustomerSession(
	customers: CheckoutCustomerIdentityPort,
	organizationId: string,
	sessionId: string,
): Promise<CheckoutCustomerSessionRecord | null> {
	if (customers.getSession.length >= 2) {
		return (
			customers.getSession as (
				orgId: string,
				sid: string,
			) => Promise<CheckoutCustomerSessionRecord | null>
		)(organizationId, sessionId);
	}
	return (
		customers.getSession as (
			sid: string,
		) => Promise<CheckoutCustomerSessionRecord | null>
	)(sessionId);
}

export async function resolveCustomerAccessFromOrg(
	customers: CheckoutCustomerIdentityPort,
	organization: OrganizationRecord,
	sessionId: string | undefined,
	nowMs: number,
): Promise<{ organization: OrganizationRecord; customerId: string }> {
	if (!sessionId) {
		throw new AppError("Customer authentication is required.", 401);
	}
	const session = await fetchCustomerSession(
		customers,
		organization.id,
		sessionId,
	);
	if (!session || session.organizationId !== organization.id) {
		throw new AppError("Customer authentication is required.", 401);
	}
	if (session.revokedAtIso) {
		throw new AppError("Customer session has ended.", 401);
	}
	const expiry =
		session.absoluteExpiresAtIso ??
		session.expiresAtIso ??
		session.idleExpiresAtIso;
	if (expiry && Date.parse(expiry) <= nowMs) {
		throw new AppError("Customer session expired.", 401);
	}
	return { organization, customerId: session.customerId };
}

export async function requireCustomerQueryFestival(
	catalog: CheckoutCatalogReadPort,
	organizationId: string,
	festivalShortName: string,
): Promise<FestivalRecord> {
	const festival = await catalog.findFestivalByShortName(
		organizationId,
		festivalShortName.trim(),
	);
	if (!festival) {
		throw new AppError("Festival not found.", 404);
	}
	return festival;
}

export async function requireCustomerChildAge(
	customers: CheckoutCustomerIdentityPort,
	organizationId: string,
	customerId: string,
	childId: string,
	nowIso: string,
): Promise<number> {
	if (!childId.trim()) {
		throw new AppError("Child selection is required.", 400);
	}
	const child = await customers.findChild(
		organizationId,
		customerId,
		childId.trim(),
	);
	if (!child) {
		throw new AppError("Selected child was not found.", 404);
	}
	const snapshot = await customers.findActiveChildAgeSnapshot(
		organizationId,
		child.id,
		nowIso,
	);
	if (!snapshot) {
		throw new AppError("An active child age snapshot is required.", 400);
	}
	return snapshot.age;
}

export async function requireValidDivisionTeacher(
	teachers: CheckoutTeacherDirectoryPort,
	organizationId: string,
	divisionId: string,
	teacherId: string,
): Promise<void> {
	if (!divisionId.trim() || !teacherId.trim()) {
		throw new AppError("Division and teacher selection are required.", 400);
	}
	if (teachers.findActiveTeacherEntitlementGrant) {
		const grant = await (
			teachers.findActiveTeacherEntitlementGrant as (input: {
				organizationId: string;
				customerId: string;
				divisionId: string;
			}) => Promise<unknown>
		)({
			organizationId,
			customerId: teacherId.trim(),
			divisionId: divisionId.trim(),
		});
		if (!grant) {
			throw new AppError(
				"Selected teacher does not hold an active membership for this division.",
				400,
			);
		}
		return;
	}
	const activeTeachers = await teachers.listActiveTeachersForDivision(
		organizationId,
		divisionId.trim(),
	);
	if (!activeTeachers.some((t) => t.id === teacherId.trim())) {
		throw new AppError(
			"Selected teacher does not hold an active membership for this division.",
			400,
		);
	}
}
