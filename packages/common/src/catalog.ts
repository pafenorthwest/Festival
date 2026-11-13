import * as v from "valibot";
import type { FestivalClass } from "./domain.js";
import { REPERTOIRE_REVIEW_STATUSES } from "./repertoire.js";
import { nonEmptyText } from "./schema-utils.js";

export const FESTIVAL_CLASS_CATALOG: FestivalClass[] = [
	{
		id: "solo-piano",
		title: "Solo Piano",
		classType: "solo",
		priceCents: 9000,
		minParticipants: 1,
		shopifyVariantId: "gid://shopify/ProductVariant/solo-piano",
	},
	{
		id: "concert-showcase",
		title: "Concert Showcase",
		classType: "concert",
		priceCents: 15000,
		minParticipants: 1,
		shopifyVariantId: "gid://shopify/ProductVariant/concert-showcase",
	},
	{
		id: "ensemble-jazz",
		title: "Ensemble Jazz",
		classType: "ensemble",
		priceCents: 12000,
		minParticipants: 2,
		shopifyVariantId: "gid://shopify/ProductVariant/ensemble-jazz",
	},
	{
		id: "theory-lab",
		title: "Theory Lab",
		classType: "general",
		priceCents: 6000,
		minParticipants: 1,
		shopifyVariantId: "gid://shopify/ProductVariant/theory-lab",
	},
];

export const MaximumPerformancePiecesSchema = v.union([
	v.literal(1),
	v.literal(2),
	v.literal(3),
]);

export const FestivalClassConfigurationDtoSchema = v.object({
	id: v.string(),
	organizationId: v.string(),
	festivalId: v.string(),
	displayName: v.string(),
	classSubtypeId: v.string(),
	divisionId: v.string(),
	minimumAge: v.pipe(v.number(), v.integer(), v.minValue(0)),
	maximumAge: v.pipe(v.number(), v.integer(), v.minValue(0)),
	price: v.string(),
	maximumPerformancePieces: MaximumPerformancePiecesSchema,
	performanceMinutes: v.pipe(v.number(), v.integer(), v.minValue(1)),
	capacity: v.pipe(v.number(), v.integer(), v.minValue(0)),
	isActive: v.boolean(),
	shopifyProductGid: v.string(),
	shopifyVariantGid: v.string(),
	createdAt: v.date(),
	updatedAt: v.date(),
});

export interface FestivalClassConfigurationDto {
	id: string;
	organizationId: string;
	festivalId: string;
	displayName: string;
	classSubtypeId: string;
	divisionId: string;
	minimumAge: number;
	maximumAge: number;
	price: string;
	maximumPerformancePieces: 1 | 2 | 3;
	performanceMinutes: number;
	capacity: number;
	isActive: boolean;
	shopifyProductGid: string;
	shopifyVariantGid: string;
	createdAt: Date;
	updatedAt: Date;
}

export const CreateFestivalClassInputSchema = v.object({
	displayName: nonEmptyText("Display name", 200),
	classSubtypeId: nonEmptyText("Class subtype ID", 200),
	divisionId: nonEmptyText("Division ID", 200),
	minimumAge: v.pipe(v.number(), v.integer(), v.minValue(0)),
	maximumAge: v.pipe(v.number(), v.integer(), v.minValue(0)),
	price: nonEmptyText("Price", 50),
	maximumPerformancePieces: v.optional(MaximumPerformancePiecesSchema),
	performanceMinutes: v.pipe(v.number(), v.integer(), v.minValue(1)),
	capacity: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
	isActive: v.optional(v.boolean()),
	shopifyProductGid: v.optional(v.string()),
	shopifyVariantGid: v.optional(v.string()),
});
export type CreateFestivalClassInput = v.InferOutput<
	typeof CreateFestivalClassInputSchema
>;

export const UpdateFestivalClassInputSchema = v.object({
	displayName: v.optional(nonEmptyText("Display name", 200)),
	minimumAge: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
	maximumAge: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
	price: v.optional(nonEmptyText("Price", 50)),
	maximumPerformancePieces: v.optional(MaximumPerformancePiecesSchema),
	performanceMinutes: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1)),
	),
	capacity: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
	isActive: v.optional(v.boolean()),
	shopifyProductGid: v.optional(v.string()),
	shopifyVariantGid: v.optional(v.string()),
});
export type UpdateFestivalClassInput = v.InferOutput<
	typeof UpdateFestivalClassInputSchema
>;

export const CreateClassSubtypeInputSchema = v.strictObject({
	displayName: nonEmptyText("Display name", 200),
	requiredSubtypeId: v.optional(v.nullable(v.string())),
});

export const CreateInstrumentInputSchema = v.strictObject({
	displayName: nonEmptyText("Display name", 200),
});

export const UpdateClassSubtypeInputSchema = v.strictObject({
	displayName: v.optional(nonEmptyText("Display name", 200)),
	isActive: v.optional(v.boolean()),
	requiredSubtypeId: v.optional(v.nullable(v.string())),
});

export const UpdateInstrumentInputSchema = v.strictObject({
	displayName: v.optional(nonEmptyText("Display name", 200)),
	isActive: v.optional(v.boolean()),
});

export const ReorderCatalogValuesInputSchema = v.strictObject({
	ids: v.array(nonEmptyText("ID", 200)),
});

export const ClaimRepertoireReviewInputSchema = v.object({
	reviewerName: v.optional(v.string()),
});

export const NormalizeRepertoireReviewInputSchema = v.object({
	normalizedTitle: nonEmptyText("Normalized title", 300),
	normalizedComposer: nonEmptyText("Normalized composer", 300),
	imslpUrl: v.optional(v.nullable(v.string())),
	notes: v.optional(v.nullable(v.string())),
	status: v.optional(v.picklist(REPERTOIRE_REVIEW_STATUSES)),
	canonicalWorkId: v.optional(v.nullable(v.string())),
	canonicalContributorId: v.optional(v.nullable(v.string())),
	reviewItemId: v.optional(v.string()),
});
export type NormalizeRepertoireReviewInput = v.InferOutput<
	typeof NormalizeRepertoireReviewInputSchema
>;

export const FlagRepertoireReviewInputSchema = v.object({
	reason: nonEmptyText("Flag reason", 200),
	notes: v.optional(v.nullable(v.string())),
	reviewItemId: v.optional(v.string()),
});
export type FlagRepertoireReviewInput = v.InferOutput<
	typeof FlagRepertoireReviewInputSchema
>;

export const ResolveRepertoireFlagInputSchema = v.object({
	flagId: v.optional(v.string()),
	resolutionNotes: v.optional(v.nullable(v.string())),
	notes: v.optional(v.nullable(v.string())),
	status: v.optional(v.picklist(REPERTOIRE_REVIEW_STATUSES)),
	reviewItemId: v.optional(v.string()),
});
export type ResolveRepertoireFlagInput = v.InferOutput<
	typeof ResolveRepertoireFlagInputSchema
>;

export const AddRepertoireCatalogWorkInputSchema = v.object({
	title: nonEmptyText("Title", 300),
	composer: nonEmptyText("Composer", 300),
	composerName: v.optional(v.string()),
	imslpUrl: v.optional(v.nullable(v.string())),
	classifications: v.optional(v.array(v.string())),
	organizationId: v.optional(v.string()),
});
export type AddRepertoireCatalogWorkInput = v.InferOutput<
	typeof AddRepertoireCatalogWorkInputSchema
>;

export const RepertoireQueueQuerySchema = v.object({
	status: v.optional(v.string()),
	claimedByUid: v.optional(v.string()),
	flaggedOnly: v.optional(v.string()),
	search: v.optional(v.string()),
	q: v.optional(v.string()),
	limit: v.optional(v.string()),
	offset: v.optional(v.string()),
	sync: v.optional(v.string()),
});

export const RepertoireCatalogQuerySchema = v.object({
	q: v.optional(v.string()),
	query: v.optional(v.string()),
	search: v.optional(v.string()),
	limit: v.optional(v.string()),
});
