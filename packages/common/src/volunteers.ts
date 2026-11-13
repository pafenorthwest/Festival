import * as v from "valibot";
import {
	MESSAGE_CHANNELS,
	MESSAGE_DELIVERY_STATUSES,
	MESSAGE_LOG_STATUSES,
} from "./communication.js";
import { calendarDateSchema, nonEmptyText } from "./schema-utils.js";
import {
	type CreateVolunteerRoleInput,
	type CreateVolunteerShiftInput,
	SHIFT_PERIODS,
	type UpdateVolunteerRoleInput,
	type UpdateVolunteerShiftInput,
	VOLUNTEER_ASSIGNMENT_STATUSES,
	type VolunteerRole,
	type VolunteerShift,
} from "./volunteer.js";

export type {
	CreateVolunteerRoleInput,
	CreateVolunteerShiftInput,
	UpdateVolunteerRoleInput,
	UpdateVolunteerShiftInput,
	VolunteerRole,
	VolunteerShift,
};

export const VolunteerRoleSchema = v.object({
	id: v.string(),
	organizationId: v.string(),
	festivalId: v.optional(v.string(), ""),
	slug: v.string(),
	displayName: v.string(),
	description: v.string(),
	detailsUrl: v.nullable(v.string()),
	isRoomProctor: v.boolean(),
	createdAtIso: v.string(),
});

export const VolunteerShiftSchema = v.object({
	id: v.string(),
	organizationId: v.string(),
	festivalId: v.optional(v.string(), ""),
	roleId: v.string(),
	date: calendarDateSchema,
	period: v.picklist(SHIFT_PERIODS),
	timeText: v.nullable(v.string()),
	division: v.nullable(v.string()),
	adjudicator: v.nullable(v.string()),
	createdAtIso: v.string(),
});

export const CreateVolunteerRoleInputSchema = v.object({
	slug: nonEmptyText("Role slug", 64),
	displayName: nonEmptyText("Role display name", 100),
	description: nonEmptyText("Role description", 1000),
	detailsUrl: v.optional(v.nullable(v.string())),
	isRoomProctor: v.optional(v.boolean(), false),
	organizationId: v.optional(v.string()),
	festivalId: v.optional(v.string()),
});

export const UpdateVolunteerRoleInputSchema = v.object({
	displayName: nonEmptyText("Role display name", 100),
	description: nonEmptyText("Role description", 1000),
	detailsUrl: v.optional(v.nullable(v.string())),
	isRoomProctor: v.optional(v.boolean(), false),
});

export const CreateVolunteerShiftInputSchema = v.object({
	date: calendarDateSchema,
	period: v.picklist(SHIFT_PERIODS),
	timeText: v.optional(v.nullable(v.string())),
	division: v.optional(v.nullable(v.string())),
	adjudicator: v.optional(v.nullable(v.string())),
	organizationId: v.optional(v.string()),
	festivalId: v.optional(v.string()),
	roleId: v.optional(v.string()),
});

export const UpdateVolunteerShiftInputSchema = v.object({
	date: calendarDateSchema,
	period: v.picklist(SHIFT_PERIODS),
	timeText: v.optional(v.nullable(v.string())),
	division: v.optional(v.nullable(v.string())),
	adjudicator: v.optional(v.nullable(v.string())),
});

export const EnrollVolunteerInputSchema = v.object({
	name: nonEmptyText("Name", 200),
	phone: nonEmptyText("Phone", 40),
	email: v.optional(v.string()),
});

export const BookShiftsInputSchema = v.object({
	shiftIds: v.pipe(
		v.array(nonEmptyText("Shift ID", 200)),
		v.minLength(1, "At least one shift ID is required."),
	),
});

export const VolunteerAssignmentSchema = v.object({
	id: v.string(),
	organizationId: v.string(),
	festivalId: v.optional(v.string()),
	shiftId: v.string(),
	volunteerId: v.string(),
	status: v.picklist(VOLUNTEER_ASSIGNMENT_STATUSES),
	createdAtIso: v.string(),
	cancelledAtIso: v.nullable(v.string()),
});

export const VolunteerShiftListingSchema = v.object({
	...VolunteerShiftSchema.entries,
	available: v.boolean(),
	role: VolunteerRoleSchema,
	shift: VolunteerShiftSchema,
});
export type VolunteerShiftListing = v.InferOutput<
	typeof VolunteerShiftListingSchema
>;

export const VolunteerScheduleEntrySchema = v.object({
	assignment: VolunteerAssignmentSchema,
	shift: VolunteerShiftSchema,
	role: VolunteerRoleSchema,
});
export type VolunteerScheduleEntry = v.InferOutput<
	typeof VolunteerScheduleEntrySchema
>;

const CoverageGapShiftSchema = v.object({
	shiftId: v.string(),
	id: v.optional(v.string()),
	roleId: v.string(),
	roleDisplayName: v.string(),
	roleName: v.optional(v.string()),
	roleSlug: v.optional(v.string()),
	date: v.string(),
	period: v.picklist(SHIFT_PERIODS),
	timeText: v.nullable(v.string()),
	division: v.nullable(v.string()),
	adjudicator: v.nullable(v.string()),
	isRoomProctor: v.boolean(),
});

const ShiftCoverageEntrySchema = v.object({
	shiftId: v.string(),
	roleId: v.string(),
	roleDisplayName: v.string(),
	date: v.string(),
	period: v.picklist(SHIFT_PERIODS),
	timeText: v.nullable(v.string()),
	division: v.nullable(v.string()),
	adjudicator: v.nullable(v.string()),
	isRoomProctor: v.boolean(),
	status: v.picklist(["Open", "Filled"]),
});

export const VolunteerCoverageGapsResponseSchema = v.object({
	totalShifts: v.number(),
	coveredShifts: v.number(),
	filledShifts: v.optional(v.number()),
	unfilledShifts: v.number(),
	totalGaps: v.optional(v.number()),
	coveragePercentage: v.number(),
	gaps: v.array(CoverageGapShiftSchema),
	gapsByDate: v.optional(v.record(v.string(), v.array(CoverageGapShiftSchema))),
	gapsByRole: v.optional(v.record(v.string(), v.array(CoverageGapShiftSchema))),
	slots: v.array(ShiftCoverageEntrySchema),
	openShifts: v.number(),
	unfilled: v.array(CoverageGapShiftSchema),
});
export type VolunteerCoverageGapsResponse = v.InferOutput<
	typeof VolunteerCoverageGapsResponseSchema
>;

const MessageEventSchema = v.object({
	id: v.string(),
	organizationId: v.string(),
	eventType: v.string(),
	recipientDestination: v.string(),
	payload: v.record(v.string(), v.unknown()),
	idempotencyKey: v.string(),
	status: v.picklist(MESSAGE_DELIVERY_STATUSES),
	createdAtIso: v.optional(v.string()),
	updatedAtIso: v.optional(v.string()),
});

const MessageLogSchema = v.object({
	id: v.string(),
	organizationId: v.string(),
	eventId: v.nullable(v.string()),
	templateId: v.optional(v.nullable(v.string())),
	channel: v.picklist(MESSAGE_CHANNELS),
	provider: v.string(),
	status: v.picklist(MESSAGE_LOG_STATUSES),
	providerMessageId: v.optional(v.nullable(v.string())),
	attempts: v.number(),
	errorMessage: v.optional(v.nullable(v.string())),
	createdAtIso: v.optional(v.string()),
});

export const TriggerEventResultSchema = v.object({
	status: v.picklist(MESSAGE_DELIVERY_STATUSES),
	success: v.boolean(),
	event: MessageEventSchema,
	log: v.optional(MessageLogSchema),
	error: v.optional(v.string()),
	duplicate: v.optional(v.boolean()),
});
export type TriggerEventResult = v.InferOutput<typeof TriggerEventResultSchema>;

export const CreateMessageTemplatePayloadSchema = v.object({
	organizationId: v.optional(v.string()),
	templateKey: nonEmptyText("Template key", 120),
	channel: v.picklist(MESSAGE_CHANNELS),
	subject: v.optional(v.nullable(v.string())),
	body: v.string(),
	variables: v.optional(v.array(v.string())),
	isActive: v.optional(v.boolean()),
});

export const UpdateMessageTemplatePayloadSchema = v.object({
	organizationId: v.optional(v.string()),
	templateKey: v.optional(nonEmptyText("Template key", 120)),
	channel: v.optional(v.picklist(MESSAGE_CHANNELS)),
	subject: v.optional(v.nullable(v.string())),
	body: v.optional(v.string()),
	variables: v.optional(v.array(v.string())),
	isActive: v.optional(v.boolean()),
});

export const TriggerMessageEventPayloadSchema = v.object({
	organizationId: v.optional(v.string()),
	eventType: nonEmptyText("Event type", 120),
	recipientDestination: nonEmptyText("Recipient", 320),
	payload: v.optional(v.record(v.string(), v.unknown())),
	idempotencyKey: v.optional(v.string()),
});

export const VolunteerShiftsQuerySchema = v.object({
	available: v.optional(v.string()),
	open: v.optional(v.string()),
});

export const CommunicationTemplatesQuerySchema = v.object({
	channel: v.optional(v.string()),
	isActive: v.optional(v.string()),
});

export const CommunicationLogQuerySchema = v.object({
	channel: v.optional(v.string()),
	status: v.optional(v.string()),
	eventId: v.optional(v.string()),
	limit: v.optional(v.string()),
	offset: v.optional(v.string()),
});
