import { AppError, validateRegistrationAgeDate } from "@festival/common";
import {
	type DomainCacheInvalidator,
	emitDomainInvalidation,
	type S09InvalidationSink,
	type TenantContext,
} from "../../infra/s09-infra.js";
import type { TenantRepository } from "./tenant-repository.js";

/** Manages registration age date configuration for a tenant organization. */
export class OrganizationAgeConfigService {
	private cacheInvalidator?: S09InvalidationSink | DomainCacheInvalidator;

	constructor(private readonly tenants: TenantRepository) {}

	bindCacheInvalidator(
		invalidator: S09InvalidationSink | DomainCacheInvalidator,
	): void {
		this.cacheInvalidator = invalidator;
	}

	async getRegistrationConfigurationForTenant(tenant: TenantContext) {
		return {
			ageConfiguration: await this.tenants.getRegistrationAgeConfiguration(
				tenant.organization.id,
			),
		};
	}

	async updateRegistrationAgeDateForTenant(
		tenant: TenantContext,
		registrationAgeDate: unknown,
	) {
		let validatedDate: string;
		try {
			validatedDate = validateRegistrationAgeDate(
				registrationAgeDate as string,
			);
		} catch (error) {
			throw new AppError(
				error instanceof Error
					? error.message
					: "Registration age date is invalid.",
				400,
			);
		}
		const ageConfiguration =
			await this.tenants.updateRegistrationAgeConfiguration({
				organizationId: tenant.organization.id,
				registrationAgeDate: validatedDate,
			});
		emitDomainInvalidation(this.cacheInvalidator, {
			type: "RegistrationAgeConfigUpdated",
			organizationId: tenant.organization.id,
			slug: tenant.organization.slug,
		});
		return { ageConfiguration };
	}
}
