import {
	AppError,
	type CustomerClassRegistrationsResponse,
	deriveFestivalMetadataCutoff,
	type FestivalClassConfiguration,
	type FestivalRecord,
	isFestivalRegistrationOpen,
	type OrganizationRecord,
	type RegistrationEligibleClass,
} from "@festival/common";
import {
	BoundedAsyncCache,
	type DomainCacheInvalidator,
	postgresSchemaName,
} from "../../infra/s11-infra.js";
import type { CheckoutRepository } from "./checkout-types.js";
import {
	buildJoinedRegistrationItems,
	buildPortRegistrationItem,
	queryClassRegistrationsJoinedSql,
	queryConfirmedCountsSql,
	toRegistrationEligibleClassDto,
} from "./customer-registration-query-helpers.js";
import type {
	CheckoutCatalogReadPort,
	CheckoutCommerceReadPort,
	CheckoutCustomerIdentityPort,
	CheckoutCustomerSessionRecord,
	CheckoutOrganizationReadPort,
	CheckoutTeacherDirectoryPort,
} from "./ports.js";

export interface CustomerRegistrationQueryServiceOptions {
	organizations: CheckoutOrganizationReadPort;
	catalog: CheckoutCatalogReadPort;
	customers: CheckoutCustomerIdentityPort;
	teachers: CheckoutTeacherDirectoryPort;
	commerce: CheckoutCommerceReadPort;
	checkout: CheckoutRepository;
	schema?: string;
	useSqlReadModels?: boolean;
	cacheInvalidator?: DomainCacheInvalidator;
	organizationCacheMaxEntries?: number;
	organizationCacheTtlMs?: number;
	organizationCacheMaxTotalBytes?: number;
	now?: () => Date;
}

export class CustomerRegistrationQueryService {
	private readonly organizations: CheckoutOrganizationReadPort;
	private readonly catalog: CheckoutCatalogReadPort;
	private readonly customers: CheckoutCustomerIdentityPort;
	private readonly teachers: CheckoutTeacherDirectoryPort;
	private readonly commerce: CheckoutCommerceReadPort;
	private readonly checkout: CheckoutRepository;
	private readonly schema: string | null;
	private readonly now: () => Date;
	private readonly organizationCacheTtlMs: number;
	private readonly organizationBySlugCache: BoundedAsyncCache<
		string,
		OrganizationRecord | null
	>;

	constructor(options: CustomerRegistrationQueryServiceOptions) {
		this.organizations = options.organizations;
		this.catalog = options.catalog;
		this.customers = options.customers;
		this.teachers = options.teachers;
		this.commerce = options.commerce;
		this.checkout = options.checkout;
		this.schema = options.useSqlReadModels
			? postgresSchemaName(options.schema ?? "orgs")
			: options.schema
				? postgresSchemaName(options.schema)
				: null;
		this.now = options.now ?? (() => new Date());
		this.organizationCacheTtlMs = options.organizationCacheTtlMs ?? 60_000;
		const maxTotalBytes = options.organizationCacheMaxTotalBytes ?? 256 * 1024;
		this.organizationBySlugCache = new BoundedAsyncCache<
			string,
			OrganizationRecord | null
		>({
			maxEntries: options.organizationCacheMaxEntries ?? 256,
			maxEntryBytes: Math.min(64 * 1024, maxTotalBytes),
			maxTotalBytes,
			cacheNullish: false,
			now: () => this.now().getTime(),
		});

		if (options.cacheInvalidator) {
			options.cacheInvalidator.subscribe((event) => {
				if (event.type === "CachesCleared") {
					this.organizationBySlugCache.deleteWhere(() => true);
					return;
				}
				if (event.type === "OrgUpdated") {
					this.organizationBySlugCache.deleteWhere(
						(slug, org) =>
							slug === event.slug || org?.id === event.organizationId,
					);
				}
			});
		}
	}

	async listRegistrationEligibleClasses(
		slug: string,
		festivalShortName: string,
		sessionId: string | undefined,
		childId: string,
		divisionId: string,
		teacherId: string,
	): Promise<{ classes: RegistrationEligibleClass[] }> {
		const access = await this.resolveCustomerAccess(slug, sessionId);
		const festival = await this.requireFestival(
			access.organization.id,
			festivalShortName,
		);
		const childAge = await this.requireChildAge(
			access.organization.id,
			access.customerId,
			childId,
		);
		await this.requireValidTeacher(
			access.organization.id,
			divisionId,
			teacherId,
		);

		const timezone =
			(await this.organizations.getOrganizationTimezone(
				access.organization.id,
			)) || "UTC";
		const isRegistrationOpen = isFestivalRegistrationOpen(
			festival,
			this.now(),
			timezone,
		);
		const [allClasses, subtypes] = await Promise.all([
			this.catalog.listFestivalClassConfigurations(
				access.organization.id,
				festival.id,
				true,
			),
			this.catalog.listRegistrationCatalogValues(
				access.organization.id,
				"class_subtype",
				false,
			),
		]);
		const eligible = allClasses.filter(
			(item) =>
				item.isActive &&
				item.divisionId === divisionId &&
				childAge >= item.minimumAge &&
				childAge <= item.maximumAge,
		);
		const placedCounts = await this.countConfirmedByClassIds(
			access.organization.id,
			eligible.map((item) => item.id),
		);
		const subtypeById = new Map(subtypes.map((s) => [s.id, s]));
		return {
			classes: eligible.map((item) =>
				toRegistrationEligibleClassDto(
					item,
					subtypeById,
					isRegistrationOpen,
					placedCounts,
				),
			),
		};
	}

	async listClassRegistrations(
		slug: string,
		sessionId: string,
		festivalShortName?: string,
	): Promise<CustomerClassRegistrationsResponse> {
		const access = await this.resolveCustomerAccess(slug, sessionId);
		const trimmedShortName = festivalShortName?.trim() ?? "";
		const targetFestival = trimmedShortName
			? await this.requireFestival(access.organization.id, trimmedShortName)
			: null;
		const [festivals, timezone] = await Promise.all([
			targetFestival
				? Promise.resolve([targetFestival])
				: this.catalog.listFestivals(access.organization.id),
			this.organizations.getOrganizationTimezone(access.organization.id),
		]);
		const tz = timezone || "UTC";
		const editCutoffs = new Map(
			festivals.map((f) => [
				f.id,
				deriveFestivalMetadataCutoff(f.startDate, tz),
			]),
		);

		if (this.schema) {
			const rows = await queryClassRegistrationsJoinedSql(
				this.schema,
				access.organization.id,
				access.customerId,
				targetFestival?.id,
			);
			return {
				registrations: buildJoinedRegistrationItems(
					rows,
					editCutoffs,
					this.now().getTime(),
				),
			};
		}

		return this.listClassRegistrationsFromPorts(
			access.organization.id,
			access.customerId,
			targetFestival,
			festivals,
			editCutoffs,
		);
	}

	private async listClassRegistrationsFromPorts(
		organizationId: string,
		customerId: string,
		targetFestival: FestivalRecord | null,
		festivals: FestivalRecord[],
		editCutoffs: Map<string, Date>,
	): Promise<CustomerClassRegistrationsResponse> {
		const entitlements = await this.commerce.listClassEntitlements({
			organizationId,
			parentCustomerId: customerId,
			...(targetFestival ? { festivalId: targetFestival.id } : {}),
		});
		if (entitlements.length === 0) {
			return { registrations: [] };
		}
		const uniqueChildIds = Array.from(
			new Set(entitlements.map((e) => e.childId)),
		);
		const uniqueOrderGids = Array.from(
			new Set(entitlements.map((e) => e.shopifyOrderGid)),
		);
		const [children, metadataMap, orderProjections, classConfigsByFestival] =
			await Promise.all([
				this.customers.findChildrenByIds
					? this.customers.findChildrenByIds(
							organizationId,
							customerId,
							uniqueChildIds,
						)
					: this.customers.listChildren(organizationId, customerId),
				this.checkout.listRegistrationMetadataByEntitlementIds
					? this.checkout.listRegistrationMetadataByEntitlementIds(
							organizationId,
							entitlements.map((e) => e.id),
						)
					: Promise.resolve(new Map()),
				this.commerce.listOrderProjectionsByGids
					? this.commerce.listOrderProjectionsByGids(
							organizationId,
							uniqueOrderGids,
						)
					: Promise.resolve([]),
				this.loadClassConfigsByFestival(organizationId, festivals),
			]);

		const childrenById = new Map(
			children.map((c) => [c.id, { id: c.id, name: c.displayName }]),
		);
		const paidAtByOrderGid = new Map(
			orderProjections.map((p) => [
				p.shopifyOrderGid,
				p.fullyPaidAtIso ?? null,
			]),
		);
		const nowMs = this.now().getTime();
		return {
			registrations: entitlements.map((entitlement) =>
				buildPortRegistrationItem(entitlement, {
					childrenById,
					classConfigsByFestival,
					metadataByEntitlementId: metadataMap,
					paidAtByOrderGid,
					editCutoffs,
					nowMs,
				}),
			),
		};
	}

	private async loadClassConfigsByFestival(
		organizationId: string,
		festivals: FestivalRecord[],
	): Promise<Map<string, Map<string, FestivalClassConfiguration>>> {
		const entries = await Promise.all(
			festivals.map(async (f) => {
				const configs = await this.catalog.listFestivalClassConfigurations(
					organizationId,
					f.id,
					false,
				);
				return [f.id, new Map(configs.map((c) => [c.id, c]))] as const;
			}),
		);
		return new Map(entries);
	}

	private async countConfirmedByClassIds(
		organizationId: string,
		festivalClassIds: readonly string[],
	): Promise<Map<string, number>> {
		if (festivalClassIds.length === 0) return new Map();
		if (this.schema) {
			return queryConfirmedCountsSql(
				this.schema,
				organizationId,
				festivalClassIds,
			);
		}
		if (this.commerce.countConfirmedClassEntitlementsByClassIds) {
			return this.commerce.countConfirmedClassEntitlementsByClassIds(
				organizationId,
				festivalClassIds,
			);
		}
		const entries = await Promise.all(
			festivalClassIds.map(
				async (id) =>
					[
						id,
						await this.commerce.countConfirmedClassEntitlements(
							organizationId,
							id,
						),
					] as const,
			),
		);
		return new Map(entries);
	}

	private async resolveOrganizationBySlug(
		slug: string,
	): Promise<OrganizationRecord> {
		const org = await this.organizationBySlugCache.getOrLoad(slug, async () => {
			const value = await this.organizations.findOrganizationBySlug(slug);
			const bytes = value
				? Buffer.byteLength(JSON.stringify(value), "utf8")
				: 0;
			return {
				value,
				ttlMs: this.organizationCacheTtlMs,
				bytes,
			};
		});
		if (!org) {
			throw new AppError("Organization not found.", 404);
		}
		return org;
	}

	private async resolveCustomerAccess(
		slug: string,
		sessionId: string | undefined,
	): Promise<{ organization: OrganizationRecord; customerId: string }> {
		if (!sessionId) {
			throw new AppError("Customer authentication is required.", 401);
		}
		const organization = await this.resolveOrganizationBySlug(slug);
		const session = await this.fetchSession(organization.id, sessionId);
		const nowMs = this.now().getTime();
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

	private async fetchSession(
		organizationId: string,
		sessionId: string,
	): Promise<CheckoutCustomerSessionRecord | null> {
		if (this.customers.getSession.length >= 2) {
			return (
				this.customers.getSession as (
					orgId: string,
					sid: string,
				) => Promise<CheckoutCustomerSessionRecord | null>
			)(organizationId, sessionId);
		}
		return (
			this.customers.getSession as (
				sid: string,
			) => Promise<CheckoutCustomerSessionRecord | null>
		)(sessionId);
	}

	private async requireFestival(
		organizationId: string,
		festivalShortName: string,
	): Promise<FestivalRecord> {
		const festival = await this.catalog.findFestivalByShortName(
			organizationId,
			festivalShortName.trim(),
		);
		if (!festival) {
			throw new AppError("Festival not found.", 404);
		}
		return festival;
	}

	private async requireChildAge(
		organizationId: string,
		customerId: string,
		childId: string,
	): Promise<number> {
		if (!childId.trim()) {
			throw new AppError("Child selection is required.", 400);
		}
		const child = await this.customers.findChild(
			organizationId,
			customerId,
			childId.trim(),
		);
		if (!child) {
			throw new AppError("Selected child was not found.", 404);
		}
		const snapshot = await this.customers.findActiveChildAgeSnapshot(
			organizationId,
			child.id,
			this.now().toISOString(),
		);
		if (!snapshot) {
			throw new AppError("An active child age snapshot is required.", 400);
		}
		return snapshot.age;
	}

	private async requireValidTeacher(
		organizationId: string,
		divisionId: string,
		teacherId: string,
	): Promise<void> {
		if (!divisionId.trim() || !teacherId.trim()) {
			throw new AppError("Division and teacher selection are required.", 400);
		}
		if (this.teachers.findActiveTeacherEntitlementGrant) {
			const grant = await (
				this.teachers.findActiveTeacherEntitlementGrant as (input: {
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
		const teachers = await this.teachers.listActiveTeachersForDivision(
			organizationId,
			divisionId.trim(),
		);
		if (!teachers.some((t) => t.id === teacherId.trim())) {
			throw new AppError(
				"Selected teacher does not hold an active membership for this division.",
				400,
			);
		}
	}
}
