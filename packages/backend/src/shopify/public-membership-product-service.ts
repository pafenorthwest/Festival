import type {
	MembershipPurchaseSelectionResponse,
	PublicMembershipProductSummary,
	PublicMembershipProductsListResponse,
} from "@festival/common";
import { TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS } from "@festival/common";
import { AppError } from "../errors/app-error.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import type { ShopifyPublicCatalogClient } from "./shopify-public-catalog-client.js";

export class PublicMembershipProductService {
	constructor(
		private readonly repository: OrganizationRepository,
		private readonly catalog: ShopifyPublicCatalogClient,
	) {}

	async list(slug: string): Promise<PublicMembershipProductsListResponse> {
		const organization = await this.repository.findOrganizationBySlug(slug);
		if (!organization) throw new AppError("Organization not found.", 404);
		const offering = await this.repository.findMembershipProductRecordByClass(
			organization.id,
			TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
		);
		const response = {
			organization: { slug: organization.slug, name: organization.name },
			membershipProducts: [] as PublicMembershipProductSummary[],
		};
		if (!offering?.isActive) return response;
		const domain = await this.repository.getPublicShopifyCatalogDomain(
			organization.id,
		);
		if (!domain) {
			throw new AppError(
				"Membership information is temporarily unavailable.",
				503,
			);
		}
		const product = await this.catalog.readProduct(
			domain,
			offering.shopifyProductGid,
		);
		if (!product) {
			throw new AppError(
				"Membership information is temporarily unavailable.",
				503,
			);
		}
		if (
			product.id !== offering.shopifyProductGid ||
			product.variant.id !== offering.shopifyVariantGid
		) {
			throw new AppError(
				"Membership information is temporarily unavailable.",
				503,
			);
		}
		response.membershipProducts.push({
			id: offering.id,
			name: product.title,
			description: product.description,
			entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			durationDays: offering.durationDays,
			available: product.availableForSale && product.variant.availableForSale,
			price: product.variant.price,
		});
		return response;
	}

	async resolvePurchasable(
		slug: string,
		offeringId: string,
	): Promise<MembershipPurchaseSelectionResponse> {
		if (!/^[A-Za-z0-9_-]{1,128}$/.test(offeringId)) {
			throw new AppError("Membership selection is invalid.", 400);
		}
		const listing = await this.list(slug);
		const offering = listing.membershipProducts.find(
			(candidate) => candidate.id === offeringId,
		);
		if (!offering?.available) {
			throw new AppError("Membership selection is unavailable.", 409);
		}
		return {
			selection: {
				offeringId: offering.id,
				organizationSlug: listing.organization.slug,
				entitlementClass: TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
			},
		};
	}
}
