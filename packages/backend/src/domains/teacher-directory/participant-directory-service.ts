import {
	type AccompanistProfileRecord,
	AppError,
	type ProfileApprovalStatus,
	type PublicDirectoryProfileDto,
	type TeacherProfileRecord,
	validateDisplayName,
	validateDivisionIds,
	validateProfileApprovalStatus,
	validatePublicDirectoryOptIn,
} from "@festival/common";
import {
	assertAllowedFields,
	type DomainCacheInvalidator,
	emitS10DomainEvent,
	type S10DomainEventListener,
} from "../../infra/s10-infra.js";
import type {
	CustomerProfileSessionContext,
	MembershipEntitlementRepository,
	TeacherDirectoryCustomerAccessPort,
	TeacherDirectoryOrganizationPort,
	TeacherDirectoryRepository,
} from "./types.js";

export type ParticipantDirectoryPort = Pick<
	TeacherDirectoryRepository,
	| "getTeacherProfile"
	| "upsertTeacherProfile"
	| "updateTeacherProfileApproval"
	| "listTeacherProfiles"
	| "getAccompanistProfile"
	| "upsertAccompanistProfile"
	| "updateAccompanistProfileApproval"
	| "listAccompanistProfiles"
	| "getPublicDirectoryProfiles"
>;

export interface ParticipantDirectoryServiceDeps {
	directory: ParticipantDirectoryPort;
	entitlements: Pick<
		MembershipEntitlementRepository,
		"listEntitlementGrantSnapshots" | "findCurrentAccompanistMembershipGrant"
	>;
	organizations: Pick<
		TeacherDirectoryOrganizationPort,
		"findOrganizationBySlug"
	>;
	customerAccess?: TeacherDirectoryCustomerAccessPort;
	cacheInvalidator?: DomainCacheInvalidator;
}

function parseProfilePayload(payload: unknown, label: string) {
	assertAllowedFields(
		payload,
		["displayName", "publicDirectoryOptIn", "divisionIds"],
		label,
	);
	const body = payload as Record<string, unknown>;
	try {
		return {
			displayName: validateDisplayName(body.displayName),
			publicDirectoryOptIn: validatePublicDirectoryOptIn(
				body.publicDirectoryOptIn,
			),
			divisionIds: validateDivisionIds(body.divisionIds),
		};
	} catch (error) {
		throw new AppError(
			error instanceof Error ? error.message : "Invalid profile.",
			400,
			"invalid_profile",
		);
	}
}

function parseApprovalPayload(
	payload: unknown,
	label: string,
): ProfileApprovalStatus {
	assertAllowedFields(payload, ["approvalStatus"], label);
	const body = payload as Record<string, unknown>;
	try {
		return validateProfileApprovalStatus(body.approvalStatus);
	} catch (error) {
		throw new AppError(
			error instanceof Error ? error.message : "Invalid approval status.",
			400,
		);
	}
}

function redactTeacherContact(
	profile: TeacherProfileRecord,
): TeacherProfileRecord {
	const { zip_code: _zipCode, ...moderationProfile } = profile;
	return moderationProfile;
}

function redactAccompanistContact(
	profile: AccompanistProfileRecord,
): AccompanistProfileRecord {
	const {
		phone: _phone,
		email: _email,
		zip_code: _zipCode,
		...moderationProfile
	} = profile;
	return moderationProfile;
}

async function resolveAdminVisibleProfile<
	T extends TeacherProfileRecord | AccompanistProfileRecord,
>(
	profile: T,
	actorUid: string,
	redact: (record: T) => T,
	customerAccess?: TeacherDirectoryCustomerAccessPort,
): Promise<T> {
	const customer = await customerAccess?.findAdminCustomerProfile?.(
		profile.organization_id,
		profile.customer_id,
		actorUid,
	);
	return customer ? profile : redact(profile);
}

async function requireActiveTeacherMembership(
	entitlements: ParticipantDirectoryServiceDeps["entitlements"],
	organizationId: string,
	customerId: string,
	message: string,
): Promise<void> {
	const grants = await entitlements.listEntitlementGrantSnapshots(
		organizationId,
		customerId,
	);
	const hasActive = grants.some(
		(grant) =>
			grant.entitlementClass === "teacher_membership" &&
			grant.status === "active",
	);
	if (!hasActive) {
		throw new AppError(message, 403, "active_membership_required");
	}
}

/**
 * Domain service owning teacher and accompanist directory profiles, #361 opt-in
 * membership enforcement, admin moderation visibility, and public directory reads.
 */
export class ParticipantDirectoryService {
	private cacheInvalidator?: DomainCacheInvalidator;
	private readonly eventListeners = new Set<S10DomainEventListener>();

	constructor(private readonly deps: ParticipantDirectoryServiceDeps) {
		this.cacheInvalidator = deps.cacheInvalidator;
	}

	bindCacheInvalidator(invalidator: DomainCacheInvalidator): void {
		this.cacheInvalidator = invalidator;
	}

	onDomainEvent(listener: S10DomainEventListener): () => void {
		this.eventListeners.add(listener);
		return () => {
			this.eventListeners.delete(listener);
		};
	}

	private emitChanged(
		organizationId: string,
		role: "teacher" | "accompanist",
		profileId: string,
	): void {
		emitS10DomainEvent(
			this.cacheInvalidator,
			{ type: "TeacherDirectoryChanged", organizationId, role, profileId },
			this.eventListeners,
		);
	}

	private requireAccess(): TeacherDirectoryCustomerAccessPort {
		if (!this.deps.customerAccess) {
			throw new AppError(
				"Customer Account integration is not configured.",
				503,
			);
		}
		return this.deps.customerAccess;
	}

	async getTeacherProfile(
		orgSlug: string,
		sessionId: string | undefined,
	): Promise<TeacherProfileRecord> {
		const access = await this.requireAccess().customerReadAccess(
			orgSlug,
			sessionId,
		);
		const profile = await this.deps.directory.getTeacherProfile(
			access.organizationId,
			access.customerId,
		);
		if (!profile) throw new AppError("Teacher profile not found.", 404);
		return profile;
	}

	async upsertTeacherProfile(
		context: CustomerProfileSessionContext,
		payload: unknown,
	): Promise<TeacherProfileRecord> {
		const access = await this.requireAccess().formAccess(
			context.orgSlug,
			context.sessionId,
			context.csrfToken,
			context.requestOrigin,
		);
		const parsed = parseProfilePayload(payload, "Teacher profile");
		const existing = await this.deps.directory.getTeacherProfile(
			access.organizationId,
			access.customerId,
		);
		if (!existing || parsed.publicDirectoryOptIn) {
			await requireActiveTeacherMembership(
				this.deps.entitlements,
				access.organizationId,
				access.customerId,
				existing
					? "An active Teacher membership is required to opt in to the public directory."
					: "An active Teacher membership is required to create a profile.",
			);
		}
		const saved = await this.deps.directory.upsertTeacherProfile({
			organizationId: access.organizationId,
			customerId: access.customerId,
			...parsed,
		});
		this.emitChanged(access.organizationId, "teacher", saved.id);
		return saved;
	}

	async getAccompanistProfile(
		orgSlug: string,
		sessionId: string | undefined,
	): Promise<AccompanistProfileRecord> {
		const access = await this.requireAccess().customerReadAccess(
			orgSlug,
			sessionId,
		);
		const profile = await this.deps.directory.getAccompanistProfile(
			access.organizationId,
			access.customerId,
		);
		if (!profile) throw new AppError("Accompanist profile not found.", 404);
		return profile;
	}

	async upsertAccompanistProfile(
		context: CustomerProfileSessionContext,
		payload: unknown,
	): Promise<AccompanistProfileRecord> {
		const access = await this.requireAccess().formAccess(
			context.orgSlug,
			context.sessionId,
			context.csrfToken,
			context.requestOrigin,
		);
		const parsed = parseProfilePayload(payload, "Accompanist profile");
		const existing = await this.deps.directory.getAccompanistProfile(
			access.organizationId,
			access.customerId,
		);
		const hasGrant = existing
			? true
			: Boolean(
					await this.deps.entitlements.findCurrentAccompanistMembershipGrant({
						organizationId: access.organizationId,
						customerId: access.customerId,
					}),
				);
		if (!hasGrant) {
			throw new AppError(
				"An active Accompanist membership is required to create a profile.",
				403,
				"active_membership_required",
			);
		}
		const saved = await this.deps.directory.upsertAccompanistProfile({
			organizationId: access.organizationId,
			customerId: access.customerId,
			...parsed,
		});
		this.emitChanged(access.organizationId, "accompanist", saved.id);
		return saved;
	}

	async listTeacherProfiles(
		organizationId: string,
		actorUid: string,
	): Promise<TeacherProfileRecord[]> {
		const profiles =
			await this.deps.directory.listTeacherProfiles(organizationId);
		return await Promise.all(
			profiles.map((p) =>
				resolveAdminVisibleProfile(
					p,
					actorUid,
					redactTeacherContact,
					this.deps.customerAccess,
				),
			),
		);
	}

	async updateTeacherProfileApproval(
		organizationId: string,
		profileId: string,
		payload: unknown,
		actorUid: string,
	): Promise<TeacherProfileRecord> {
		const status = parseApprovalPayload(payload, "Teacher profile approval");
		const updated = await this.deps.directory.updateTeacherProfileApproval(
			organizationId,
			profileId,
			status,
		);
		if (!updated) throw new AppError("Teacher profile not found.", 404);
		this.emitChanged(organizationId, "teacher", updated.id);
		return await resolveAdminVisibleProfile(
			updated,
			actorUid,
			redactTeacherContact,
			this.deps.customerAccess,
		);
	}

	async listAccompanistProfiles(
		organizationId: string,
		actorUid: string,
	): Promise<AccompanistProfileRecord[]> {
		const profiles =
			await this.deps.directory.listAccompanistProfiles(organizationId);
		return await Promise.all(
			profiles.map((p) =>
				resolveAdminVisibleProfile(
					p,
					actorUid,
					redactAccompanistContact,
					this.deps.customerAccess,
				),
			),
		);
	}

	async updateAccompanistProfileApproval(
		organizationId: string,
		profileId: string,
		payload: unknown,
		actorUid: string,
	): Promise<AccompanistProfileRecord> {
		const status = parseApprovalPayload(
			payload,
			"Accompanist profile approval",
		);
		const updated = await this.deps.directory.updateAccompanistProfileApproval(
			organizationId,
			profileId,
			status,
		);
		if (!updated) throw new AppError("Accompanist profile not found.", 404);
		this.emitChanged(organizationId, "accompanist", updated.id);
		return await resolveAdminVisibleProfile(
			updated,
			actorUid,
			redactAccompanistContact,
			this.deps.customerAccess,
		);
	}

	async getPublicDirectoryProfiles(
		orgSlug: string,
	): Promise<PublicDirectoryProfileDto[]> {
		const org = await this.deps.organizations.findOrganizationBySlug(orgSlug);
		if (!org) throw new AppError("Organization not found.", 404);
		return await this.deps.directory.getPublicDirectoryProfiles(org.id);
	}
}
