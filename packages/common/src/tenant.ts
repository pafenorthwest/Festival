import * as v from "valibot";
import { MEMBERSHIP_DIVISION_SELECTION_POLICIES } from "./entitlements.js";
import { ORGANIZATION_ROLES } from "./organization.js";
import { nonEmptyText } from "./schema-utils.js";

export const PIANO_TYPES = ["upright", "grand"] as const;

export const PianoTypeSchema = v.picklist(
	PIANO_TYPES,
	"Piano type must be upright or grand.",
);
export type PianoType = v.InferOutput<typeof PianoTypeSchema>;

export const RoomPianoConfigurationSchema = v.object({
	pianoType: PianoTypeSchema,
	count: v.pipe(
		v.number("Piano count must be a number."),
		v.integer("Piano count must be a whole number."),
		v.minValue(1, "Piano count must be at least 1."),
	),
});
export type RoomPianoConfiguration = v.InferOutput<
	typeof RoomPianoConfigurationSchema
>;

export const RoomSchema = v.object({
	id: v.string(),
	organizationId: v.string(),
	festivalId: v.string(),
	name: v.string(),
	pianoConfigurations: v.array(RoomPianoConfigurationSchema),
	createdAtIso: v.string(),
});
export type Room = v.InferOutput<typeof RoomSchema>;

export const CreateRoomInputSchema = v.pipe(
	v.strictObject({
		name: nonEmptyText("Room name", 100),
		pianoConfigurations: v.optional(v.array(RoomPianoConfigurationSchema), []),
	}),
	v.check((input) => {
		const types = new Set(input.pianoConfigurations.map((c) => c.pianoType));
		return types.size === input.pianoConfigurations.length;
	}, "Each piano type may only appear once per room."),
	v.check(
		(input) =>
			input.pianoConfigurations.reduce((sum, item) => sum + item.count, 0) <= 3,
		"Total pianos in a room must not exceed 3.",
	),
);
export type CreateRoomInput = v.InferOutput<typeof CreateRoomInputSchema>;

export const CreateOrganizationInputSchema = v.object({
	name: nonEmptyText("Organization name", 255),
	shortName: nonEmptyText("Organization short name", 100),
	defaultCurrencyCode: v.optional(nonEmptyText("Currency code", 10)),
});

export const CreateInviteInputSchema = v.object({
	organizationSlug: nonEmptyText("Organization slug", 200),
	email: nonEmptyText("Email", 320),
	role: v.picklist(ORGANIZATION_ROLES),
});

export const AcceptInviteInputSchema = v.object({
	name: nonEmptyText("Name", 200),
});

export const CreateOrganizationDivisionInputSchema = v.strictObject({
	displayName: nonEmptyText("Division name", 200),
});

export const UpdateOrganizationDivisionInputSchema = v.strictObject({
	displayName: v.optional(nonEmptyText("Division name", 200)),
	isActive: v.optional(v.boolean()),
});

export const ReorderOrganizationDivisionsInputSchema = v.strictObject({
	divisionIds: v.array(nonEmptyText("Division ID", 200)),
});

export const UpdateOrganizationTimezoneInputSchema = v.strictObject({
	timezone: nonEmptyText("Timezone", 100),
});

export const CreateFestivalInputSchema = v.strictObject({
	shortName: nonEmptyText("Festival short name", 100),
	name: nonEmptyText("Festival name", 200),
	startDate: nonEmptyText("Festival start date", 40),
	endDate: nonEmptyText("Festival end date", 40),
	registrationOpensAt: v.optional(v.nullable(v.string())),
	registrationClosesAt: v.optional(v.nullable(v.string())),
});

export const UpdateFestivalRegistrationWindowInputSchema = v.strictObject({
	registrationOpensAt: v.nullable(v.string()),
	registrationClosesAt: v.nullable(v.string()),
});

export const UpdateAccompanistPolicyInputSchema = v.strictObject({
	policy: v.picklist(
		MEMBERSHIP_DIVISION_SELECTION_POLICIES,
		"Accompanist division policy is invalid.",
	),
});

export const UpdateRegistrationAgeDateInputSchema = v.strictObject({
	registrationAgeDate: v.pipe(
		v.string("Registration age date must use YYYY-MM-DD."),
		v.trim(),
		v.regex(
			/^\d{4}-\d{2}-\d{2}$/,
			"Registration age date must use YYYY-MM-DD.",
		),
	),
});

export const LoginEventInputSchema = v.object({
	provider: v.picklist(
		["google", "password"],
		"provider must be one of: google, password.",
	),
});
