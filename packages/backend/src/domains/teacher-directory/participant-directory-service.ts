import {
	type AccompanistProfileRecord,
	AppError,
	type PublicDirectoryProfileDto,
	type TeacherProfileRecord,
} from "@festival/common";
import {
	type DomainCacheInvalidator,
	emitS10DomainEvent,
	type S10DomainEventListener,
} from "../../infra/s10-infra.js";
import {
	executeAccompanistUpsert,
	executeTeacherUpsert,
	parseApprovalPayload,
	resolveAdminVisible,
	resolveSingleActiveTeacherDivision,
} from "./participant-directory-helpers.js";
import type {
	CustomerProfileSessionContext,
	MembershipEntitlementRepository,
	MembershipProductRepository,
	TeacherDirectoryCustomerAccessPort,
	TeacherDirectoryOrganizationPort,
	TeacherDirectoryRepository,
} from "./types.js";

export type ParticipantDirectoryPort = Pick<
	TeacherDirectoryRepository,
	| "getTeacherProfile"
	| "upsertTeacherProfile"
	| "updateTeacherProfileApproval"
	| "updateTeacherProfileDivisions"
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
		"findOrganizationBySlug" | "listDivisions"
	>;
	products?: Pick<MembershipProductRepository, "getAccompanistDivisionPolicy">;
	customerAccess?: TeacherDirectoryCustomerAccessPort;
	cacheInvalidator?: DomainCacheInvalidator;
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

	private formAccess(ctx: CustomerProfileSessionContext) {
		return this.requireAccess().formAccess(
			ctx.orgSlug,
			ctx.sessionId,
			ctx.csrfToken,
			ctx.requestOrigin,
		);
	}

	async getTeacherProfile(
		orgSlug: string,
		sessionId: string | undefined,
	): Promise<TeacherProfileRecord> {
		const a = await this.requireAccess().customerReadAccess(orgSlug, sessionId);
		const p = await this.deps.directory.getTeacherProfile(
			a.organizationId,
			a.customerId,
		);
		if (!p) throw new AppError("Teacher profile not found.", 404);
		return p;
	}

	async upsertTeacherProfile(
		ctx: CustomerProfileSessionContext,
		payload: unknown,
	): Promise<TeacherProfileRecord> {
		const a = await this.formAccess(ctx);
		const saved = await executeTeacherUpsert(this.deps, a, payload);
		this.emitChanged(a.organizationId, "teacher", saved.id);
		return saved;
	}

	async getAccompanistProfile(
		orgSlug: string,
		sessionId: string | undefined,
	): Promise<AccompanistProfileRecord> {
		const a = await this.requireAccess().customerReadAccess(orgSlug, sessionId);
		const p = await this.deps.directory.getAccompanistProfile(
			a.organizationId,
			a.customerId,
		);
		if (!p) throw new AppError("Accompanist profile not found.", 404);
		return p;
	}

	async upsertAccompanistProfile(
		ctx: CustomerProfileSessionContext,
		payload: unknown,
	): Promise<AccompanistProfileRecord> {
		const a = await this.formAccess(ctx);
		const saved = await executeAccompanistUpsert(this.deps, a, payload);
		this.emitChanged(a.organizationId, "accompanist", saved.id);
		return saved;
	}

	private async finishAdmin<
		T extends TeacherProfileRecord | AccompanistProfileRecord,
	>(
		updated: T | null,
		role: "teacher" | "accompanist",
		ctx: { organizationId: string; actorUid: string; label: string },
	): Promise<T> {
		if (!updated) throw new AppError(`${ctx.label} profile not found.`, 404);
		this.emitChanged(ctx.organizationId, role, updated.id);
		return resolveAdminVisible(updated, role, {
			actorUid: ctx.actorUid,
			customerAccess: this.deps.customerAccess,
		});
	}

	async listTeacherProfiles(
		organizationId: string,
		actorUid: string,
	): Promise<TeacherProfileRecord[]> {
		const list = await this.deps.directory.listTeacherProfiles(organizationId);
		const ctx = { actorUid, customerAccess: this.deps.customerAccess };
		return Promise.all(list.map((p) => resolveAdminVisible(p, "teacher", ctx)));
	}

	async updateTeacherProfileApproval(
		organizationId: string,
		profileId: string,
		payload: unknown,
		actorUid: string,
	): Promise<TeacherProfileRecord> {
		const status = parseApprovalPayload(payload, "Teacher profile approval");
		const u = await this.deps.directory.updateTeacherProfileApproval(
			organizationId,
			profileId,
			status,
		);
		return this.finishAdmin(u, "teacher", {
			organizationId,
			actorUid,
			label: "Teacher",
		});
	}

	async updateTeacherProfileDivisions(
		organizationId: string,
		profileId: string,
		payload: unknown,
		actorUid: string,
	): Promise<TeacherProfileRecord> {
		const divId = await resolveSingleActiveTeacherDivision(
			this.deps.organizations,
			organizationId,
			payload,
		);
		const u = await this.deps.directory.updateTeacherProfileDivisions(
			organizationId,
			profileId,
			[divId],
		);
		return this.finishAdmin(u, "teacher", {
			organizationId,
			actorUid,
			label: "Teacher",
		});
	}

	async listAccompanistProfiles(
		organizationId: string,
		actorUid: string,
	): Promise<AccompanistProfileRecord[]> {
		const list =
			await this.deps.directory.listAccompanistProfiles(organizationId);
		const ctx = { actorUid, customerAccess: this.deps.customerAccess };
		return Promise.all(
			list.map((p) => resolveAdminVisible(p, "accompanist", ctx)),
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
		const u = await this.deps.directory.updateAccompanistProfileApproval(
			organizationId,
			profileId,
			status,
		);
		return this.finishAdmin(u, "accompanist", {
			organizationId,
			actorUid,
			label: "Accompanist",
		});
	}

	async getPublicDirectoryProfiles(
		orgSlug: string,
	): Promise<PublicDirectoryProfileDto[]> {
		const org = await this.deps.organizations.findOrganizationBySlug(orgSlug);
		if (!org) throw new AppError("Organization not found.", 404);
		return this.deps.directory.getPublicDirectoryProfiles(org.id);
	}
}
