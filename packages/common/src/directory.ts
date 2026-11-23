import * as v from "valibot";
import { PROFILE_APPROVAL_STATUSES } from "./profile.js";
import { nonEmptyText } from "./schema-utils.js";

export const UpsertCustomerTeacherProfileInputSchema = v.strictObject({
	displayName: nonEmptyText("Display name", 100),
	publicDirectoryOptIn: v.boolean(),
});
export type UpsertCustomerTeacherProfileInput = v.InferOutput<
	typeof UpsertCustomerTeacherProfileInputSchema
>;

export const UpsertCustomerAccompanistProfileInputSchema = v.strictObject({
	displayName: nonEmptyText("Display name", 100),
	publicDirectoryOptIn: v.boolean(),
	divisionIds: v.array(v.string()),
});
export type UpsertCustomerAccompanistProfileInput = v.InferOutput<
	typeof UpsertCustomerAccompanistProfileInputSchema
>;
export const UpsertParticipantProfileInputSchema =
	UpsertCustomerAccompanistProfileInputSchema;
export type UpsertParticipantProfileInput =
	UpsertCustomerAccompanistProfileInput;

export const UpdateAdminTeacherProfileApprovalInputSchema = v.object({
	profileId: nonEmptyText("Profile ID", 200),
	approvalStatus: v.picklist(PROFILE_APPROVAL_STATUSES),
});
export const UpdateAdminAccompanistProfileApprovalInputSchema =
	UpdateAdminTeacherProfileApprovalInputSchema;
export type UpdateAdminTeacherProfileApprovalInput = v.InferOutput<
	typeof UpdateAdminTeacherProfileApprovalInputSchema
>;
export type UpdateAdminAccompanistProfileApprovalInput = v.InferOutput<
	typeof UpdateAdminAccompanistProfileApprovalInputSchema
>;

export const UpdateProfileApprovalBodySchema = v.object({
	approvalStatus: v.picklist(PROFILE_APPROVAL_STATUSES),
});

export const UpdateTeacherProfileDivisionsBodySchema = v.strictObject({
	divisionIds: v.pipe(
		v.array(nonEmptyText("Division ID", 200)),
		v.length(1, "Exactly one division is required."),
	),
});
export type UpdateTeacherProfileDivisionsBody = v.InferOutput<
	typeof UpdateTeacherProfileDivisionsBodySchema
>;

export const UpdateAdminTeacherProfileDivisionsInputSchema = v.strictObject({
	profileId: nonEmptyText("Profile ID", 200),
	divisionIds: v.pipe(
		v.array(nonEmptyText("Division ID", 200)),
		v.length(1, "Exactly one division is required."),
	),
});
export type UpdateAdminTeacherProfileDivisionsInput = v.InferOutput<
	typeof UpdateAdminTeacherProfileDivisionsInputSchema
>;

export const StaffMembershipRosterEntrySchema = v.object({
	membershipType: v.picklist(["Teacher", "Accompanist"]),
	offeringName: v.string(),
	source: v.string(),
	status: v.literal("active"),
	startsOn: v.string(),
	endsOn: v.string(),
	name: v.optional(v.string()),
	email: v.optional(v.string()),
	phone: v.optional(v.string()),
	city: v.optional(v.string()),
	divisions: v.array(
		v.object({
			divisionId: v.string(),
			divisionName: v.string(),
		}),
	),
});

export interface StaffMembershipRosterEntry
	extends v.InferOutput<typeof StaffMembershipRosterEntrySchema> {}
