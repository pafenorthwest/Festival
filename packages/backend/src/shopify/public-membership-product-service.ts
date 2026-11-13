import type {
	MembershipPurchaseSelectionResponse,
	PublicMembershipProductSummary,
	PublicMembershipProductsListResponse,
} from "@festival/common";
import { TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS } from "@festival/common";
import { AppError } from "../errors/app-error.js";
import { BoundedAsyncCache } from "../lib/bounded-async-cache.js";
import type {
	DomainCacheInvalidationEvent,
	DomainCacheInvalidator,
} from "../lib/domain-cache-invalidator.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import {
	SHOPIFY_STOREFRONT_PRIVATE_TOKEN_PURPOSE,
	type ShopifySecretKeyring,
} from "./encryption.js";
import type { ShopifyPublicCatalogClient } from "./shopify-public-catalog-client.js";

const PUBLIC_LISTING_CACHE_TTL_MS = 5 * 60_000;
const PUBLIC_LISTING_MAX_ENTRIES = 512;
const PUBLIC_LISTING_MAX_ENTRY_BYTES = 256 * 1024;
const PUBLIC_LISTING_MAX_TOTAL_BYTES = 8 * 1024 * 1024;

interface CachedPublicListing {
	organizationId: string;
	response: PublicMembershipProductsListResponse;
}

function cloneListingResponse(
	response: PublicMembershipProductsListResponse,
): PublicMembershipProductsListResponse {
	return {
		organization: { ...response.organization },
		membershipProducts: response.membershipProducts.map((product) => ({
			...product,
			price: { ...product.price },
		})),
	};
}

export class PublicMembershipProductService {
	private readonly listingCache: BoundedAsyncCache<string, CachedPublicListing>;
	private unsubscribeCacheInvalidator?: () => void;

	constructor(
		private readonly repository: OrganizationRepository,
		private readonly catalog: ShopifyPublicCatalogClient,
		private readonly secretKeyring?: ShopifySecretKeyring,
	) {
		this.listingCache = new BoundedAsyncCache({
			maxEntries: PUBLIC_LISTING_MAX_ENTRIES,
			maxEntryBytes: PUBLIC_LISTING_MAX_ENTRY_BYTES,
			maxTotalBytes: PUBLIC_LISTING_MAX_TOTAL_BYTES,
		});
	}

	bindCacheInvalidator(invalidator: DomainCacheInvalidator): void {
		this.unsubscribeCacheInvalidator?.();
		this.unsubscribeCacheInvalidator = invalidator.subscribe((event) =>
			this.handleCacheInvalidation(event),
		);
	}

	private handleCacheInvalidation(event: DomainCacheInvalidationEvent): void {
		if (event.type === "CachesCleared") {
			this.listingCache.deleteWhere(() => true);
			return;
		}
		if (
			event.type === "OrgUpdated" ||
			event.type === "MembershipChanged" ||
			event.type === "FestivalCatalogUpdated" ||
			event.type === "ShopifySecretRotated"
		) {
			this.listingCache.deleteWhere(
				(slug, entry) =>
					!event.organizationId ||
					slug === event.slug ||
					entry.organizationId === event.organizationId,
			);
		}
	}

	private async storefrontToken(
		organizationId: string,
	): Promise<string | undefined> {
		if (!this.secretKeyring) return undefined;
		const integration =
			await this.repository.getShopifyIntegration(organizationId);
		if (!integration?.encryptedStorefrontPrivateToken) return undefined;
		return this.secretKeyring.decrypt(
			integration.encryptedStorefrontPrivateToken,
			{
				organizationId,
				purpose: SHOPIFY_STOREFRONT_PRIVATE_TOKEN_PURPOSE,
			},
		);
	}

	private async loadListing(slug: string): Promise<CachedPublicListing> {
		const organization = await this.repository.findOrganizationBySlug(slug);
		if (!organization) throw new AppError("Organization not found.", 404);
		const offering = await this.repository.findMembershipProductRecordByClass(
			organization.id,
			TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
		);
		const response: PublicMembershipProductsListResponse = {
			organization: { slug: organization.slug, name: organization.name },
			membershipProducts: [] as PublicMembershipProductSummary[],
		};
		if (!offering?.isActive) {
			return { organizationId: organization.id, response };
		}
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
			await this.storefrontToken(organization.id),
		);
		if (
			!product ||
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
			price: { ...product.variant.price },
		});
		return { organizationId: organization.id, response };
	}

	async list(slug: string): Promise<PublicMembershipProductsListResponse> {
		const cached = await this.listingCache.getOrLoad(slug, async () => {
			const loaded = await this.loadListing(slug);
			const value: CachedPublicListing = {
				organizationId: loaded.organizationId,
				response: cloneListingResponse(loaded.response),
			};
			return {
				value,
				ttlMs: PUBLIC_LISTING_CACHE_TTL_MS,
				bytes: Buffer.byteLength(JSON.stringify(value.response)),
			};
		});
		return cloneListingResponse(cached.response);
	}

	async resolvePurchasable(
		slug: string,
		offeringId: string,
	): Promise<MembershipPurchaseSelectionResponse> {
		if (!/^[A-Za-z0-9_-]{1,128}$/.test(offeringId)) {
			throw new AppError("Membership selection is invalid.", 400);
		}
		const { response: listing } = await this.loadListing(slug);
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
