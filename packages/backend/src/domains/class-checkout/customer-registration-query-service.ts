import {
	AppError,
	type CustomerClassRegistrationsResponse,
	deriveFestivalMetadataCutoff,
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
	countConfirmedByClassIds,
	listClassRegistrationsFromPorts,
	requireCustomerChildAge,
	requireCustomerQueryFestival,
	requireValidDivisionTeacher,
	resolveCustomerAccessFromOrg,
} from "./customer-registration-port-queries.js";
import {
	buildJoinedRegistrationItems,
	queryClassRegistrationsJoinedSql,
	toRegistrationEligibleClassDto,
} from "./customer-registration-query-helpers.js";
import type {
	CheckoutCatalogReadPort,
	CheckoutCommerceReadPort,
	CheckoutCustomerIdentityPort,
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
		const orgId = access.organization.id;
		const festival = await requireCustomerQueryFestival(
			this.catalog,
			orgId,
			festivalShortName,
		);
		const childAge = await requireCustomerChildAge(
			this.customers,
			orgId,
			access.customerId,
			childId,
			this.now().toISOString(),
		);
		await requireValidDivisionTeacher(
			this.teachers,
			orgId,
			divisionId,
			teacherId,
		);
		return this.loadAndFilterEligibleClasses(
			orgId,
			festival,
			divisionId,
			childAge,
		);
	}

	private async loadAndFilterEligibleClasses(
		orgId: string,
		festival: Awaited<ReturnType<typeof requireCustomerQueryFestival>>,
		divisionId: string,
		childAge: number,
	): Promise<{ classes: RegistrationEligibleClass[] }> {
		const [timezone, allClasses, subtypes] = await Promise.all([
			this.organizations.getOrganizationTimezone(orgId),
			this.catalog.listFestivalClassConfigurations(orgId, festival.id, true),
			this.catalog.listRegistrationCatalogValues(orgId, "class_subtype", false),
		]);
		const isRegistrationOpen = isFestivalRegistrationOpen(
			festival,
			this.now(),
			timezone || "UTC",
		);
		const eligible = allClasses.filter(
			(item) =>
				item.isActive &&
				item.divisionId === divisionId &&
				childAge >= item.minimumAge &&
				childAge <= item.maximumAge,
		);
		const placedCounts = await countConfirmedByClassIds(
			{ schema: this.schema, commerce: this.commerce },
			orgId,
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
			? await requireCustomerQueryFestival(
					this.catalog,
					access.organization.id,
					trimmedShortName,
				)
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
		return listClassRegistrationsFromPorts(this.portDeps(), {
			organizationId: access.organization.id,
			customerId: access.customerId,
			targetFestival,
			festivals,
			editCutoffs,
		});
	}

	private portDeps() {
		return {
			organizations: this.organizations,
			catalog: this.catalog,
			customers: this.customers,
			teachers: this.teachers,
			commerce: this.commerce,
			checkout: this.checkout,
			schema: this.schema,
			now: this.now,
		};
	}

	private async resolveOrganizationBySlug(
		slug: string,
	): Promise<OrganizationRecord> {
		const org = await this.organizationBySlugCache.getOrLoad(slug, async () => {
			const value = await this.organizations.findOrganizationBySlug(slug);
			const bytes = value
				? Buffer.byteLength(JSON.stringify(value), "utf8")
				: 0;
			return { value, ttlMs: this.organizationCacheTtlMs, bytes };
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
		const organization = await this.resolveOrganizationBySlug(slug);
		return resolveCustomerAccessFromOrg(
			this.customers,
			organization,
			sessionId,
			this.now().getTime(),
		);
	}
}
