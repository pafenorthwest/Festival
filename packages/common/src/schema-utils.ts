import * as v from "valibot";

export {
	type BaseIssue,
	type BaseSchema,
	type GenericSchema,
	type InferInput,
	type InferOutput,
	safeParse,
} from "valibot";

export const nonEmptyText = (label: string, max = 500) =>
	v.pipe(
		v.string(`${label} must be a string.`),
		v.trim(),
		v.minLength(1, `${label} is required.`),
		v.maxLength(max, `${label} must be ${max} characters or less.`),
	);

export const calendarDateSchema = v.pipe(
	v.string("Date must be a string."),
	v.trim(),
	v.regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD."),
);

export type AnyValibotSchema = v.BaseSchema<
	unknown,
	unknown,
	v.BaseIssue<unknown>
>;

export type SchemaParseResult<TSchema extends AnyValibotSchema> =
	| { success: true; data: v.InferOutput<TSchema> }
	| { success: false; message: string };

export function parseSchemaValue<TSchema extends AnyValibotSchema>(
	schema: TSchema,
	input: unknown,
	fallbackMessage = "Invalid request payload.",
): SchemaParseResult<TSchema> {
	const result = v.safeParse(schema, input);
	if (result.success) {
		return { success: true, data: result.output };
	}
	const message = result.issues
		.map((issue) => issue.message)
		.filter((part) => part.trim().length > 0)
		.join(" ");
	return {
		success: false,
		message: message || fallbackMessage,
	};
}

export const RegistrationSearchQuerySchema = v.object({
	q: v.optional(v.string()),
});

export const RegistrationTeachersQuerySchema = v.object({
	childId: v.optional(v.string()),
	divisionId: v.optional(v.string()),
});

export const RegistrationEligibleClassesQuerySchema = v.object({
	childId: v.optional(v.string()),
	divisionId: v.optional(v.string()),
	teacherId: v.optional(v.string()),
});

export const WaitlistClassQuerySchema = v.object({
	classId: v.optional(v.string()),
});
