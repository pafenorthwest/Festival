import {
	type AccompanistProfileRecord,
	AppError,
	type ProfileApprovalStatus,
	type TeacherProfileRecord,
	validateDisplayName,
	validateDivisionIds,
	validateMembershipDivisionSelection,
	validateProfileApprovalStatus,
	validatePublicDirectoryOptIn,
} from "@festival/common";
import { assertAllowedFields } from "../../infra/s10-infra.js";
import type { ParticipantDirectoryServiceDeps } from "./participant-directory-service.js";
import type { TeacherDirectoryCustomerAccessPort } from "./types.js";

function badRequest(message: string, code?: string): never {
	throw new AppError(message, 400, code);
}

function withValidation<T>(fn: () => T, fallback: string, code?: string): T {
	try {
		return fn();
	} catch (error) {
		badRequest(error instanceof Error ? error.message : fallback, code);
	}
}

export function parseTeacherProfilePayload(payload: unknown) {
	return withValidation(
		() => {
			assertAllowedFields(
				payload,
				["displayName", "publicDirectoryOptIn"],
				"Teacher profile",
			);
			const body = payload as Record<string, unknown>;
			return {
				displayName: validateDisplayName(body.displayName),
				publicDirectoryOptIn: validatePublicDirectoryOptIn(
					body.publicDirectoryOptIn,
				),
			};
		},
		"Invalid profile.",
		"invalid_profile",
	);
}

export function parseProfilePayload(payload: unknown, label: string) {
	assertAllowedFields(
		payload,
		["displayName", "publicDirectoryOptIn", "divisionIds"],
		label,
	);
	const body = payload as Record<string, unknown>;
	return withValidation(
		() => ({
			displayName: validateDisplayName(body.displayName),
			publicDirectoryOptIn: validatePublicDirectoryOptIn(
				body.publicDirectoryOptIn,
			),
			divisionIds: validateDivisionIds(body.divisionIds),
		}),
		"Invalid profile.",
		"invalid_profile",
	);
}

export function parseApprovalPayload(
	payload: unknown,
	label: string,
): ProfileApprovalStatus {
	assertAllowedFields(payload, ["approvalStatus"], label);
	return withValidation(
		() =>
			validateProfileApprovalStatus(
				(payload as Record<string, unknown>).approvalStatus,
			),
		"Invalid approval status.",
	);
}

function redactContact<
	T extends TeacherProfileRecord | AccompanistProfileRecord,
>(profile: T, role: "teacher" | "accompanist"): T {
	if (role === "teacher") {
		const { zip_code: _zipCode, ...rest } = profile as TeacherProfileRecord;
		return rest as T;
	}
	const {
		phone: _phone,
		email: _email,
		zip_code: _zipCode,
		...rest
	} = profile as AccompanistProfileRecord;
	return rest as T;
}

export async function resolveAdminVisible<
	T extends TeacherProfileRecord | AccompanistProfileRecord,
>(
	profile: T,
	role: "teacher" | "accompanist",
	access: {
		actorUid: string;
		customerAccess?: TeacherDirectoryCustomerAccessPort;
	},
): Promise<T> {
	const customer = await access.customerAccess?.findAdminCustomerProfile?.(
		profile.organization_id,
		profile.customer_id,
		access.actorUid,
	);
	return customer ? profile : redactContact(profile, role);
}

async function resolveTeacherUpsertDivisions(
	deps: Pick<ParticipantDirectoryServiceDeps, "entitlements" | "organizations">,
	target: {
		organizationId: string;
		customerId: string;
		existing: TeacherProfileRecord | null;
		publicDirectoryOptIn: boolean;
	},
): Promise<string[]> {
	const needsActive = !target.existing || target.publicDirectoryOptIn;
	const grants = needsActive
		? await deps.entitlements.listEntitlementGrantSnapshots(
				target.organizationId,
				target.customerId,
			)
		: [];
	const activeGrants = grants.filter(
		(g) => g.entitlementClass === "teacher_membership" && g.status === "active",
	);
	if (needsActive && !activeGrants[0]) {
		throw new AppError(
			target.existing
				? "An active Teacher membership is required to opt in to the public directory."
				: "An active Teacher membership is required to create a profile.",
			403,
			"active_membership_required",
		);
	}
	if (target.existing) return [...target.existing.division_ids];
	const active = await deps.organizations.listDivisions(
		target.organizationId,
		true,
	);
	const activeIds = new Set(active.map((d) => d.id));
	return [...new Set(activeGrants.map((g) => g.divisionId))].filter((id) =>
		activeIds.has(id),
	);
}

export async function resolveSingleActiveTeacherDivision(
	organizations: ParticipantDirectoryServiceDeps["organizations"],
	organizationId: string,
	payload: unknown,
): Promise<string> {
	assertAllowedFields(payload, ["divisionIds"], "Teacher profile divisions");
	const rawIds = (payload as Record<string, unknown>).divisionIds;
	if (!Array.isArray(rawIds) || rawIds.length !== 1) {
		badRequest("Exactly one division is required.", "invalid_division");
	}
	const [divisionId] = withValidation(
		() => validateDivisionIds(rawIds),
		"Each division ID must be a valid UUID.",
		"invalid_division",
	);
	const active = await organizations.listDivisions(organizationId, true);
	if (!divisionId || !active.some((d) => d.id === divisionId)) {
		badRequest(
			"Division is not active for this organization.",
			"invalid_division",
		);
	}
	return divisionId;
}

async function requireActiveAccompanistMembership(
	entitlements: ParticipantDirectoryServiceDeps["entitlements"],
	target: { organizationId: string; customerId: string; hasExisting: boolean },
): Promise<void> {
	const grant = await entitlements.findCurrentAccompanistMembershipGrant({
		organizationId: target.organizationId,
		customerId: target.customerId,
	});
	if (!grant || grant.status !== "active") {
		throw new AppError(
			target.hasExisting
				? "An active Accompanist membership is required to opt in to the public directory."
				: "An active Accompanist membership is required to create a profile.",
			403,
			"active_membership_required",
		);
	}
}

async function validateAccompanistProfileDivisions(
	deps: Pick<ParticipantDirectoryServiceDeps, "organizations" | "products">,
	organizationId: string,
	divisionIds: string[],
): Promise<void> {
	const active = await deps.organizations.listDivisions(organizationId, true);
	const activeIds = new Set(active.map((d) => d.id));
	if (divisionIds.some((id) => !activeIds.has(id))) {
		badRequest(
			"One or more divisions are not active for this organization.",
			"invalid_division",
		);
	}
	const policy = deps.products
		? (await deps.products.getAccompanistDivisionPolicy(organizationId)).policy
		: "one_to_all";
	withValidation(
		() =>
			validateMembershipDivisionSelection(policy, divisionIds, active.length),
		"Selected divisions do not satisfy the membership policy.",
		"invalid_division",
	);
}

export async function executeTeacherUpsert(
	deps: ParticipantDirectoryServiceDeps,
	access: { organizationId: string; customerId: string },
	payload: unknown,
): Promise<TeacherProfileRecord> {
	const parsed = parseTeacherProfilePayload(payload);
	const existing = await deps.directory.getTeacherProfile(
		access.organizationId,
		access.customerId,
	);
	const divisionIds = await resolveTeacherUpsertDivisions(deps, {
		organizationId: access.organizationId,
		customerId: access.customerId,
		existing,
		publicDirectoryOptIn: parsed.publicDirectoryOptIn,
	});
	return deps.directory.upsertTeacherProfile({
		organizationId: access.organizationId,
		customerId: access.customerId,
		...parsed,
		divisionIds,
	});
}

export async function executeAccompanistUpsert(
	deps: ParticipantDirectoryServiceDeps,
	access: { organizationId: string; customerId: string },
	payload: unknown,
): Promise<AccompanistProfileRecord> {
	const parsed = parseProfilePayload(payload, "Accompanist profile");
	const existing = await deps.directory.getAccompanistProfile(
		access.organizationId,
		access.customerId,
	);
	if (!existing || parsed.publicDirectoryOptIn) {
		await requireActiveAccompanistMembership(deps.entitlements, {
			organizationId: access.organizationId,
			customerId: access.customerId,
			hasExisting: Boolean(existing),
		});
	}
	await validateAccompanistProfileDivisions(
		deps,
		access.organizationId,
		parsed.divisionIds,
	);
	return deps.directory.upsertAccompanistProfile({
		organizationId: access.organizationId,
		customerId: access.customerId,
		...parsed,
	});
}
