import * as v from "valibot";
import { AVAILABILITY_HOURS, type AvailabilityHour } from "./availability.js";
import {
	PROFILE_EMAIL_PATTERN,
	PROFILE_PHONE_PATTERN,
} from "./customer-account.js";
import { calendarDateSchema, nonEmptyText } from "./schema-utils.js";

export const CustomerChildDtoSchema = v.object({
	id: v.string(),
	displayName: v.string(),
	name: v.optional(v.string()),
	hasCurrentValidAgeSnapshot: v.boolean(),
});
export type CustomerChildDto = v.InferOutput<typeof CustomerChildDtoSchema>;

export const CreateCustomerChildInputSchema = v.object({
	displayName: nonEmptyText("Display name", 200),
	birthday: calendarDateSchema,
});

export const RefreshCustomerChildAgeSnapshotInputSchema = v.object({
	birthday: calendarDateSchema,
});

export const CustomerMailingAddressSchema = v.strictObject({
	line1: nonEmptyText("Address line 1", 512),
	line2: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(512))),
	city: nonEmptyText("City", 255),
	region: nonEmptyText("Region", 255),
	postalCode: nonEmptyText("Postal code", 255),
	countryCode: v.pipe(
		nonEmptyText("Country code", 2),
		v.regex(/^[A-Za-z]{2}$/, "Country code is invalid."),
	),
});

export const UpdateCustomerProfilePayloadSchema = v.strictObject({
	name: nonEmptyText("Name", 255),
	email: v.pipe(
		nonEmptyText("Email", 255),
		v.regex(PROFILE_EMAIL_PATTERN, "Email is invalid."),
	),
	mailingAddress: CustomerMailingAddressSchema,
	phone: v.pipe(
		nonEmptyText("Phone", 255),
		v.regex(PROFILE_PHONE_PATTERN, "Phone is invalid."),
	),
});

export const UpdateCustomerProfileRouteBodySchema = v.partial(
	UpdateCustomerProfilePayloadSchema,
);

const availabilityHourSchema = v.pipe(
	v.number(),
	v.integer(),
	v.check(
		(hour): hour is AvailabilityHour =>
			(AVAILABILITY_HOURS as readonly number[]).includes(hour),
		"Availability hour is invalid.",
	),
);

export const SaveCustomerFestivalAvailabilityInputSchema = v.object({
	festivalId: nonEmptyText("Festival ID", 200),
	subjects: v.array(
		v.object({
			subjectType: v.picklist(["accompanist", "child"]),
			subjectId: nonEmptyText("Subject ID", 200),
			days: v.array(
				v.object({
					date: calendarDateSchema,
					availableHours: v.array(availabilityHourSchema),
				}),
			),
		}),
	),
});

export const CustomerOrdersQuerySchema = v.object({
	after: v.optional(v.string()),
});

export const CustomerAvailabilityQuerySchema = v.object({
	festivalId: v.optional(v.string()),
});
