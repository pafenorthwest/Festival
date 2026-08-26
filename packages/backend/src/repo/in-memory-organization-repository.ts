import { randomUUID } from "node:crypto";
import type {
	AuthenticatedUser,
	CreateEntitlementGrantSnapshotInput,
	EntitlementClass,
	EntitlementGrantSnapshot,
	FestivalRecord,
	OrganizationAdminUserEntry,
	OrganizationDivision,
	OrganizationInviteRecord,
	OrganizationMembershipRecord,
	OrganizationRecord,
	OrganizationUserRecord,
} from "@festival/common";
import {
	assertValidEntitlementDurationDays,
	assertValidEntitlementGrantSnapshotInput,
	EMPTY_SHOPIFY_CAPABILITIES,
	TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS,
} from "@festival/common";
import type {
	CreateFestivalRecordInput,
	CreateInviteRecordInput,
	CreateMembershipInput,
	CreateMembershipProductRecordInput,
	InviteWithOrganization,
	MembershipWithOrganization,
	OrganizationRepository,
	ProductRecord,
	ShopifyIntegrationRecord,
	UpdateShopifyVerificationInput,
	UpsertShopifyIntegrationInput,
} from "./organization-repository.js";
import { ShopifyShopOwnershipError } from "./organization-repository.js";

export class InMemoryOrganizationRepository implements OrganizationRepository {
	private readonly users = new Map<string, OrganizationUserRecord>();
	private readonly usersByUid = new Map<string, string>();
	private readonly organizations = new Map<string, OrganizationRecord>();
	private readonly organizationsBySlug = new Map<string, string>();
	private readonly organizationsByName = new Map<string, string>();
	private readonly memberships = new Map<
		string,
		OrganizationMembershipRecord
	>();
	private readonly membershipsByUserId = new Map<string, Set<string>>();
	private readonly membershipsByUserAndOrganization = new Map<string, string>();
	private readonly invites = new Map<string, OrganizationInviteRecord>();
	private readonly invitesByToken = new Map<string, string>();
	private readonly festivals = new Map<string, FestivalRecord>();
	private readonly shopifyIntegrations = new Map<
		string,
		ShopifyIntegrationRecord
	>();
	private readonly products = new Map<string, ProductRecord>();
	private readonly entitlementGrants = new Map<
		string,
		EntitlementGrantSnapshot
	>();
	private readonly divisions = new Map<
		string,
		OrganizationDivision & { normalizedName: string }
	>();

	async ensureReady(): Promise<void> {}

	async upsertUser(user: AuthenticatedUser): Promise<OrganizationUserRecord> {
		const existingId = this.usersByUid.get(user.uid);
		if (existingId) {
			const existing = this.users.get(existingId);
			if (!existing) {
				throw new Error(`In-memory user not found for id ${existingId}`);
			}

			const updated: OrganizationUserRecord = {
				...existing,
				email: user.email.toLowerCase(),
				displayName: user.displayName,
				disassociated: false,
			};
			this.users.set(existingId, updated);
			return updated;
		}

		const created: OrganizationUserRecord = {
			id: randomUUID(),
			firebaseUid: user.uid,
			email: user.email.toLowerCase(),
			displayName: user.displayName,
			disassociated: false,
			createdAtIso: new Date().toISOString(),
		};

		this.users.set(created.id, created);
		this.usersByUid.set(created.firebaseUid, created.id);
		return created;
	}

	async findMembershipByUserId(
		userId: string,
	): Promise<MembershipWithOrganization | null> {
		const membershipIds = this.membershipsByUserId.get(userId);
		const membershipId = membershipIds?.values().next().value;
		if (!membershipId) {
			return null;
		}

		return this.membershipWithOrganization(membershipId);
	}

	async listMembershipsByUserId(
		userId: string,
	): Promise<MembershipWithOrganization[]> {
		const membershipIds = this.membershipsByUserId.get(userId);
		if (!membershipIds) {
			return [];
		}

		const memberships = await Promise.all(
			[...membershipIds].map((membershipId) =>
				this.membershipWithOrganization(membershipId),
			),
		);
		return memberships.filter(
			(membership): membership is MembershipWithOrganization =>
				membership !== null,
		);
	}

	private async membershipWithOrganization(
		membershipId: string,
	): Promise<MembershipWithOrganization | null> {
		const membership = this.memberships.get(membershipId);
		if (!membership) {
			return null;
		}

		const organization = this.organizations.get(membership.organizationId);
		if (!organization) {
			return null;
		}

		return { membership, organization };
	}

	async findMembershipByUserAndSlug(
		userId: string,
		slug: string,
	): Promise<MembershipWithOrganization | null> {
		const organizationId = this.organizationsBySlug.get(slug);
		if (!organizationId) {
			return null;
		}

		const membershipId = this.membershipsByUserAndOrganization.get(
			`${userId}:${organizationId}`,
		);
		if (!membershipId) {
			return null;
		}

		return this.membershipWithOrganization(membershipId);
	}

	async findOrganizationBySlug(
		slug: string,
	): Promise<OrganizationRecord | null> {
		const organizationId = this.organizationsBySlug.get(slug);
		if (!organizationId) {
			return null;
		}

		return this.organizations.get(organizationId) ?? null;
	}

	async findOrganizationByName(
		name: string,
	): Promise<OrganizationRecord | null> {
		const organizationId = this.organizationsByName.get(name.toLowerCase());
		if (!organizationId) {
			return null;
		}

		return this.organizations.get(organizationId) ?? null;
	}

	async createOrganization(input: {
		name: string;
		slug: string;
	}): Promise<OrganizationRecord> {
		const organization: OrganizationRecord = {
			id: randomUUID(),
			name: input.name,
			slug: input.slug,
			timezone: "UTC",
			createdAtIso: new Date().toISOString(),
		};

		this.organizations.set(organization.id, organization);
		this.organizationsBySlug.set(organization.slug, organization.id);
		this.organizationsByName.set(
			organization.name.toLowerCase(),
			organization.id,
		);
		return organization;
	}

	async listDivisions(
		organizationId: string,
		activeOnly = false,
	): Promise<OrganizationDivision[]> {
		return this.orderedDivisions(organizationId, activeOnly);
	}

	private orderedDivisions(
		organizationId: string,
		activeOnly = false,
	): OrganizationDivision[] {
		return [...this.divisions.values()]
			.filter(
				(division) =>
					division.organizationId === organizationId &&
					(!activeOnly || division.isActive),
			)
			.sort(
				(a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id),
			)
			.map(({ normalizedName: _normalizedName, ...division }) => division);
	}

	async createDivision(input: {
		organizationId: string;
		displayName: string;
		normalizedName: string;
	}): Promise<OrganizationDivision> {
		if (
			[...this.divisions.values()].some(
				(division) =>
					division.organizationId === input.organizationId &&
					division.normalizedName === input.normalizedName,
			)
		) {
			throw new Error("Division display name already exists.");
		}
		const now = new Date().toISOString();
		const division = {
			id: randomUUID(),
			organizationId: input.organizationId,
			displayName: input.displayName,
			normalizedName: input.normalizedName,
			isActive: true,
			displayOrder: this.orderedDivisions(input.organizationId).length,
			createdAtIso: now,
			updatedAtIso: now,
		};
		this.divisions.set(division.id, division);
		const { normalizedName: _normalizedName, ...result } = division;
		return result;
	}

	async updateDivision(input: {
		organizationId: string;
		divisionId: string;
		displayName?: string;
		normalizedName?: string;
		isActive?: boolean;
	}): Promise<OrganizationDivision | null> {
		const current = this.divisions.get(input.divisionId);
		if (!current || current.organizationId !== input.organizationId)
			return null;
		if (
			input.normalizedName &&
			[...this.divisions.values()].some(
				(division) =>
					division.id !== current.id &&
					division.organizationId === input.organizationId &&
					division.normalizedName === input.normalizedName,
			)
		) {
			throw new Error("Division display name already exists.");
		}
		const updated = {
			...current,
			displayName: input.displayName ?? current.displayName,
			normalizedName: input.normalizedName ?? current.normalizedName,
			isActive: input.isActive ?? current.isActive,
			updatedAtIso: new Date().toISOString(),
		};
		this.divisions.set(updated.id, updated);
		const { normalizedName: _normalizedName, ...result } = updated;
		return result;
	}

	async reorderDivisions(
		organizationId: string,
		divisionIds: string[],
	): Promise<OrganizationDivision[]> {
		const current = this.orderedDivisions(organizationId);
		if (
			current.length !== divisionIds.length ||
			new Set(divisionIds).size !== divisionIds.length ||
			divisionIds.some((id) => !current.some((division) => division.id === id))
		) {
			throw new Error(
				"Division order must contain every organization division exactly once.",
			);
		}
		const now = new Date().toISOString();
		divisionIds.forEach((id, displayOrder) => {
			const division = this.divisions.get(id);
			if (!division) throw new Error("Division not found.");
			this.divisions.set(id, { ...division, displayOrder, updatedAtIso: now });
		});
		return this.orderedDivisions(organizationId);
	}

	async getOrganizationTimezone(organizationId: string): Promise<string> {
		const organization = this.organizations.get(organizationId);
		if (!organization) throw new Error("Organization not found.");
		return organization.timezone;
	}

	async updateOrganizationTimezone(
		organizationId: string,
		timezone: string,
	): Promise<string> {
		const organization = this.organizations.get(organizationId);
		if (!organization) throw new Error("Organization not found.");
		this.organizations.set(organizationId, { ...organization, timezone });
		return timezone;
	}

	async createMembership(
		input: CreateMembershipInput,
	): Promise<OrganizationMembershipRecord> {
		const key = `${input.userId}:${input.organizationId}`;
		if (this.membershipsByUserAndOrganization.has(key)) {
			throw new Error("Membership already exists for this organization.");
		}

		const membership: OrganizationMembershipRecord = {
			id: randomUUID(),
			organizationId: input.organizationId,
			userId: input.userId,
			role: input.role,
			origin: input.origin,
			joinedAtIso: new Date().toISOString(),
		};

		this.memberships.set(membership.id, membership);
		const userMemberships =
			this.membershipsByUserId.get(membership.userId) ?? new Set<string>();
		userMemberships.add(membership.id);
		this.membershipsByUserId.set(membership.userId, userMemberships);
		this.membershipsByUserAndOrganization.set(key, membership.id);
		return membership;
	}

	async createInvite(
		input: CreateInviteRecordInput,
	): Promise<OrganizationInviteRecord> {
		const invite: OrganizationInviteRecord = {
			id: randomUUID(),
			token: randomUUID(),
			organizationId: input.organizationId,
			email: input.email.toLowerCase(),
			role: input.role,
			invitedByUserId: input.invitedByUserId,
			createdAtIso: new Date().toISOString(),
		};

		this.invites.set(invite.id, invite);
		this.invitesByToken.set(invite.token, invite.id);
		return invite;
	}

	async findInviteByToken(
		token: string,
	): Promise<InviteWithOrganization | null> {
		const inviteId = this.invitesByToken.get(token);
		if (!inviteId) {
			return null;
		}

		const invite = this.invites.get(inviteId);
		if (!invite) {
			return null;
		}

		const organization = this.organizations.get(invite.organizationId);
		if (!organization) {
			return null;
		}

		return { invite, organization };
	}

	async markInviteAccepted(token: string): Promise<void> {
		const inviteId = this.invitesByToken.get(token);
		if (!inviteId) {
			return;
		}

		const invite = this.invites.get(inviteId);
		if (!invite) {
			return;
		}

		this.invites.set(inviteId, {
			...invite,
			acceptedAtIso: new Date().toISOString(),
		});
	}

	async listAdminUsers(
		organizationId: string,
		currentUserId: string,
	): Promise<OrganizationAdminUserEntry[]> {
		const acceptedUsers = [...this.memberships.values()]
			.filter((membership) => membership.organizationId === organizationId)
			.map((membership) => {
				const user = this.users.get(membership.userId);
				if (!user) {
					throw new Error(`User not found for membership ${membership.id}`);
				}

				return {
					id: membership.id,
					email: user.email,
					role: membership.role,
					status: "accepted" as const,
					isSelf: membership.userId === currentUserId,
				};
			});
		const pendingUsers = [...this.invites.values()]
			.filter(
				(invite) =>
					invite.organizationId === organizationId && !invite.acceptedAtIso,
			)
			.map((invite) => ({
				id: invite.id,
				email: invite.email,
				role: invite.role,
				status: "pending" as const,
				isSelf: false,
			}));

		return [...acceptedUsers, ...pendingUsers];
	}

	async deleteMembership(input: {
		organizationId: string;
		membershipId: string;
		currentUserId: string;
	}): Promise<void> {
		const membership = this.memberships.get(input.membershipId);
		if (!membership || membership.organizationId !== input.organizationId) {
			throw new Error("Membership not found.");
		}

		if (membership.userId === input.currentUserId) {
			throw new Error("Admins cannot delete their own membership.");
		}

		this.memberships.delete(input.membershipId);
		this.membershipsByUserId.get(membership.userId)?.delete(input.membershipId);
		this.membershipsByUserAndOrganization.delete(
			`${membership.userId}:${membership.organizationId}`,
		);

		const user = this.users.get(membership.userId);
		if (user) {
			this.users.set(user.id, {
				...user,
				disassociated: true,
			});
		}
	}

	async cancelInvite(input: {
		organizationId: string;
		inviteId: string;
	}): Promise<void> {
		const invite = this.invites.get(input.inviteId);
		if (!invite || invite.organizationId !== input.organizationId) {
			throw new Error("Invite not found.");
		}

		this.invites.delete(input.inviteId);
		this.invitesByToken.delete(invite.token);
	}

	async listFestivals(organizationId: string): Promise<FestivalRecord[]> {
		return [...this.festivals.values()].filter(
			(festival) => festival.organizationId === organizationId,
		);
	}

	async createFestival(
		input: CreateFestivalRecordInput,
	): Promise<FestivalRecord> {
		if (
			[...this.festivals.values()].some(
				(festival) =>
					festival.organizationId === input.organizationId &&
					(festival.name.toLowerCase() === input.name.toLowerCase() ||
						festival.code === input.code),
			)
		) {
			throw new Error("Festival already exists for this organization.");
		}

		const festival: FestivalRecord = {
			id: input.id,
			organizationId: input.organizationId,
			code: input.code,
			name: input.name,
			startDate: input.startDate,
			endDate: input.endDate,
			createdAtIso: new Date().toISOString(),
		};

		this.festivals.set(festival.id, festival);
		return festival;
	}

	async findFestivalByName(
		organizationId: string,
		name: string,
	): Promise<FestivalRecord | null> {
		return (
			[...this.festivals.values()].find(
				(festival) =>
					festival.organizationId === organizationId &&
					festival.name.toLowerCase() === name.toLowerCase(),
			) ?? null
		);
	}

	async dismissWelcome(
		userId: string,
		organizationId: string,
	): Promise<OrganizationMembershipRecord> {
		const membershipId = this.membershipsByUserAndOrganization.get(
			`${userId}:${organizationId}`,
		);
		if (!membershipId) {
			throw new Error(`Membership not found for user ${userId}`);
		}

		const membership = this.memberships.get(membershipId);
		if (!membership || membership.organizationId !== organizationId) {
			throw new Error(
				`Membership not found for organization ${organizationId}`,
			);
		}

		const updated: OrganizationMembershipRecord = {
			...membership,
			welcomeDismissedAtIso: new Date().toISOString(),
		};

		this.memberships.set(membership.id, updated);
		return updated;
	}

	async getShopifyIntegration(
		organizationId: string,
	): Promise<ShopifyIntegrationRecord | null> {
		return this.shopifyIntegrations.get(organizationId) ?? null;
	}

	async getPublicShopifyCatalogDomain(
		organizationId: string,
	): Promise<string | null> {
		const integration = this.shopifyIntegrations.get(organizationId);
		return integration?.verificationStatus === "ok"
			? (integration.verifiedShopDomain ?? null)
			: null;
	}

	async upsertShopifyIntegration(
		input: UpsertShopifyIntegrationInput,
	): Promise<ShopifyIntegrationRecord> {
		const existing = this.shopifyIntegrations.get(input.organizationId);
		if (
			[...this.shopifyIntegrations.values()].some(
				(integration) =>
					integration.organizationId !== input.organizationId &&
					(integration.storeDomain === input.storeDomain ||
						integration.verifiedShopDomain === input.storeDomain),
			)
		) {
			throw new ShopifyShopOwnershipError();
		}
		const now = new Date().toISOString();
		const record: ShopifyIntegrationRecord = {
			organizationId: input.organizationId,
			storeDomain: input.storeDomain,
			clientId: input.clientId,
			encryptedClientSecret: input.encryptedClientSecret,
			encryptedStorefrontPrivateToken: input.encryptedStorefrontPrivateToken,
			verificationStatus: "unknown",
			grantedScopes: [],
			capabilities: { ...EMPTY_SHOPIFY_CAPABILITIES },
			integrationVersion: (existing?.integrationVersion ?? 0) + 1,
			createdAtIso: existing?.createdAtIso ?? now,
			updatedAtIso: now,
		};

		this.shopifyIntegrations.set(input.organizationId, record);
		return record;
	}

	async updateShopifyVerification(
		input: UpdateShopifyVerificationInput,
	): Promise<ShopifyIntegrationRecord> {
		const existing = this.shopifyIntegrations.get(input.organizationId);
		if (!existing) {
			throw new Error("Shopify integration not found.");
		}
		if (
			input.verificationStatus === "ok" &&
			[...this.shopifyIntegrations.values()].some(
				(integration) =>
					integration.organizationId !== input.organizationId &&
					(integration.storeDomain === input.verifiedShopDomain ||
						integration.verifiedShopDomain === input.verifiedShopDomain ||
						integration.verifiedShopGid === input.verifiedShopGid),
			)
		) {
			throw new ShopifyShopOwnershipError();
		}

		const record: ShopifyIntegrationRecord = {
			...existing,
			verificationStatus: input.verificationStatus,
			verifiedShopGid:
				input.verificationStatus === "ok" ? input.verifiedShopGid : undefined,
			verifiedShopDomain:
				input.verificationStatus === "ok"
					? input.verifiedShopDomain
					: undefined,
			grantedScopes:
				input.verificationStatus === "ok" ? [...input.grantedScopes] : [],
			capabilities:
				input.verificationStatus === "ok"
					? { ...input.capabilities }
					: { ...EMPTY_SHOPIFY_CAPABILITIES },
			verifiedAtIso: input.verifiedAtIso,
			lastTestedAtIso: input.lastTestedAtIso,
			lastError: input.lastError,
			lastFailureCategory: input.lastFailureCategory,
			updatedAtIso: new Date().toISOString(),
		};

		this.shopifyIntegrations.set(input.organizationId, record);
		return record;
	}

	async createMembershipProductRecord(
		input: CreateMembershipProductRecordInput,
	): Promise<ProductRecord> {
		if (!this.organizations.has(input.organizationId)) {
			throw new Error("Organization not found.");
		}
		if (input.entitlementClass !== TEACHER_MEMBERSHIP_ENTITLEMENT_CLASS) {
			throw new Error("Entitlement class must be teacher_membership.");
		}
		if (
			[...this.products.values()].some(
				(product) =>
					product.organizationId === input.organizationId &&
					product.productCategory === "membership" &&
					product.entitlementClass === input.entitlementClass &&
					product.isActive &&
					input.isActive,
			)
		) {
			throw new Error(
				"Membership product already exists for this organization.",
			);
		}

		if (
			await this.findProductRecordByShopifyProductGid(input.shopifyProductGid)
		) {
			throw new Error("Shopify product is already associated.");
		}

		if (
			await this.findProductRecordByShopifyVariantGid(input.shopifyVariantGid)
		) {
			throw new Error("Shopify variant is already associated.");
		}

		const now = new Date().toISOString();
		assertValidEntitlementDurationDays(input.durationDays);
		const record: ProductRecord = {
			id: randomUUID(),
			organizationId: input.organizationId,
			productCategory: "membership",
			entitlementClass: input.entitlementClass,
			durationDays: input.durationDays,
			isActive: input.isActive,
			shopifyProductGid: input.shopifyProductGid,
			shopifyVariantGid: input.shopifyVariantGid,
			productNameSnapshot: input.productNameSnapshot,
			createdAtIso: now,
			updatedAtIso: now,
		};

		this.products.set(record.id, record);
		return record;
	}

	async listMembershipProductRecords(
		organizationId: string,
	): Promise<ProductRecord[]> {
		return [...this.products.values()]
			.filter(
				(product) =>
					product.organizationId === organizationId &&
					product.productCategory === "membership",
			)
			.sort((a, b) => a.createdAtIso.localeCompare(b.createdAtIso));
	}

	async updateMembershipProductRecord(input: {
		organizationId: string;
		productId: string;
		productNameSnapshot?: string;
		durationDays?: number;
		isActive?: boolean;
	}): Promise<ProductRecord | null> {
		const current = this.products.get(input.productId);
		if (!current || current.organizationId !== input.organizationId)
			return null;
		if (input.durationDays !== undefined) {
			assertValidEntitlementDurationDays(input.durationDays);
		}
		if (
			input.isActive === true &&
			[...this.products.values()].some(
				(product) =>
					product.id !== current.id &&
					product.organizationId === input.organizationId &&
					product.entitlementClass === current.entitlementClass &&
					product.isActive,
			)
		) {
			throw new Error(
				"Membership product already exists for this organization.",
			);
		}
		const updated: ProductRecord = {
			...current,
			productNameSnapshot:
				input.productNameSnapshot ?? current.productNameSnapshot,
			durationDays: input.durationDays ?? current.durationDays,
			isActive: input.isActive ?? current.isActive,
			updatedAtIso: new Date().toISOString(),
		};
		this.products.set(updated.id, updated);
		return { ...updated };
	}

	async findMembershipProductRecordByClass(
		organizationId: string,
		entitlementClass: EntitlementClass,
	): Promise<ProductRecord | null> {
		return (
			[...this.products.values()].find(
				(product) =>
					product.organizationId === organizationId &&
					product.productCategory === "membership" &&
					product.entitlementClass === entitlementClass &&
					product.isActive,
			) ?? null
		);
	}

	async findProductRecordByShopifyProductGid(
		shopifyProductGid: string,
	): Promise<ProductRecord | null> {
		return (
			[...this.products.values()].find(
				(product) => product.shopifyProductGid === shopifyProductGid,
			) ?? null
		);
	}

	async findProductRecordByShopifyVariantGid(
		shopifyVariantGid: string,
	): Promise<ProductRecord | null> {
		return (
			[...this.products.values()].find(
				(product) => product.shopifyVariantGid === shopifyVariantGid,
			) ?? null
		);
	}

	async createEntitlementGrantSnapshot(
		input: CreateEntitlementGrantSnapshotInput,
	): Promise<EntitlementGrantSnapshot> {
		assertValidEntitlementGrantSnapshotInput(input);
		const offering = this.products.get(input.offeringId);
		if (!offering || offering.organizationId !== input.organizationId) {
			throw new Error(
				"Entitlement offering was not found for this Organization.",
			);
		}
		const division = this.divisions.get(input.divisionId);
		if (!division || division.organizationId !== input.organizationId) {
			throw new Error(
				"Entitlement division was not found for this Organization.",
			);
		}
		if (
			[...this.entitlementGrants.values()].some(
				(grant) =>
					grant.checkoutIntentId === input.checkoutIntentId ||
					grant.shopifyOrderLineGid === input.shopifyOrderLineGid,
			)
		) {
			throw new Error("Entitlement grant correlation is already recorded.");
		}
		const record: EntitlementGrantSnapshot = Object.freeze({
			...input,
			id: randomUUID(),
			createdAtIso: new Date().toISOString(),
		});
		this.entitlementGrants.set(record.id, record);
		return { ...record };
	}

	async listEntitlementGrantSnapshots(
		organizationId: string,
		customerId: string,
	): Promise<EntitlementGrantSnapshot[]> {
		return [...this.entitlementGrants.values()]
			.filter(
				(grant) =>
					grant.organizationId === organizationId &&
					grant.customerId === customerId,
			)
			.sort((a, b) => a.createdAtIso.localeCompare(b.createdAtIso))
			.map((grant) => ({ ...grant }));
	}
}
