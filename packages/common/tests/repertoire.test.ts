import { describe, expect, it } from "bun:test";
import {
	type AddCatalogWorkInput,
	type CanonicalContributor,
	type CanonicalWork,
	calculateRepertoireReviewQueueSummary,
	isRepertoireReviewStatus,
	REPERTOIRE_FLAG_REASONS,
	REPERTOIRE_REVIEW_STATUSES,
	type RepertoireReviewItem,
	type RepertoireReviewQueueFilter,
	type RepertoireReviewQueueSummary,
	validateAddCatalogWorkInput,
	validateClaimReviewInput,
	validateFlagReviewInput,
	validateNormalizeReviewInput,
	validateResolveFlagInput,
} from "../src/index.js";

describe("repertoire review domain types and validation", () => {
	describe("RepertoireReviewStatus and constants", () => {
		it("includes expected review statuses", () => {
			expect(REPERTOIRE_REVIEW_STATUSES).toContain("pending");
			expect(REPERTOIRE_REVIEW_STATUSES).toContain("claimed");
			expect(REPERTOIRE_REVIEW_STATUSES).toContain("in_review");
			expect(REPERTOIRE_REVIEW_STATUSES).toContain("reviewed");
			expect(REPERTOIRE_REVIEW_STATUSES).toContain("flagged");
			expect(REPERTOIRE_REVIEW_STATUSES).toContain("needs_follow_up");
			expect(REPERTOIRE_REVIEW_STATUSES).toContain("approved");
		});

		it("validates status values correctly with isRepertoireReviewStatus", () => {
			expect(isRepertoireReviewStatus("pending")).toBe(true);
			expect(isRepertoireReviewStatus("claimed")).toBe(true);
			expect(isRepertoireReviewStatus("in_review")).toBe(true);
			expect(isRepertoireReviewStatus("reviewed")).toBe(true);
			expect(isRepertoireReviewStatus("flagged")).toBe(true);
			expect(isRepertoireReviewStatus("needs_follow_up")).toBe(true);
			expect(isRepertoireReviewStatus("approved")).toBe(true);
			expect(isRepertoireReviewStatus("approved_for_publication")).toBe(true);
			expect(isRepertoireReviewStatus("unknown_status")).toBe(false);
			expect(isRepertoireReviewStatus(null)).toBe(false);
			expect(isRepertoireReviewStatus(123)).toBe(false);
		});

		it("includes standard repertoire flag reasons", () => {
			expect(REPERTOIRE_FLAG_REASONS).toContain("ambiguous_title");
			expect(REPERTOIRE_FLAG_REASONS).toContain("missing_composer");
			expect(REPERTOIRE_FLAG_REASONS).toContain("spelling_issue");
			expect(REPERTOIRE_FLAG_REASONS).toContain("duplicate_work");
			expect(REPERTOIRE_FLAG_REASONS).toContain(
				"uncertain_work_identification",
			);
			expect(REPERTOIRE_FLAG_REASONS).toContain("other");
		});
	});

	describe("validateClaimReviewInput", () => {
		it("validates standard claim input", () => {
			const result = validateClaimReviewInput({
				reviewItemId: "item-123",
				reviewerId: "user-456",
				reviewerName: "Jane Doe",
				organizationId: "org-789",
			});
			expect(result.valid).toBe(true);
			expect(result.errors).toEqual([]);
			expect(result.data?.reviewItemId).toBe("item-123");
			expect(result.data?.reviewerId).toBe("user-456");
			expect(result.data?.reviewerName).toBe("Jane Doe");
			expect(result.data?.organizationId).toBe("org-789");
		});

		it("accepts id and assignedReviewerId field aliases", () => {
			const result = validateClaimReviewInput({
				id: "item-alias",
				assignedReviewerId: "rev-alias",
			});
			expect(result.valid).toBe(true);
			expect(result.data?.reviewItemId).toBe("item-alias");
			expect(result.data?.reviewerId).toBe("rev-alias");
		});

		it("rejects non-object or missing payload", () => {
			expect(validateClaimReviewInput(null).valid).toBe(false);
			expect(validateClaimReviewInput(undefined).valid).toBe(false);
			expect(validateClaimReviewInput("item-1").valid).toBe(false);
			expect(validateClaimReviewInput([]).valid).toBe(false);
		});

		it("rejects missing or empty reviewItemId", () => {
			const result = validateClaimReviewInput({
				reviewItemId: "   ",
				reviewerId: "user-1",
			});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Review item ID is required.");
		});

		it("rejects missing or empty reviewerId", () => {
			const result = validateClaimReviewInput({
				reviewItemId: "item-1",
				reviewerId: "",
			});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Reviewer ID is required.");
		});
	});

	describe("validateNormalizeReviewInput", () => {
		it("validates valid normalize review input with all fields", () => {
			const result = validateNormalizeReviewInput({
				reviewItemId: "item-1",
				normalizedTitle: "Moonlight Sonata, Op. 27 No. 2",
				normalizedComposer: "Ludwig van Beethoven",
				imslpUrl:
					"https://imslp.org/wiki/Piano_Sonata_No.14,_Op.27_No.2_(Beethoven,_Ludwig_van)",
				status: "reviewed",
				canonicalWorkId: "work-1",
				canonicalContributorId: "comp-1",
				notes: "Verified against Henle Urtext edition",
				reviewerId: "user-1",
				organizationId: "org-1",
			});
			expect(result.valid).toBe(true);
			expect(result.errors).toEqual([]);
			expect(result.data?.normalizedTitle).toBe(
				"Moonlight Sonata, Op. 27 No. 2",
			);
			expect(result.data?.normalizedComposer).toBe("Ludwig van Beethoven");
			expect(result.data?.status).toBe("reviewed");
			expect(result.data?.canonicalWorkId).toBe("work-1");
		});

		it("accepts title and composer aliases and trims inputs", () => {
			const result = validateNormalizeReviewInput({
				id: "item-2",
				title: "  Clair de Lune  ",
				composer: "  Claude Debussy  ",
			});
			expect(result.valid).toBe(true);
			expect(result.data?.reviewItemId).toBe("item-2");
			expect(result.data?.normalizedTitle).toBe("Clair de Lune");
			expect(result.data?.normalizedComposer).toBe("Claude Debussy");
		});

		it("rejects non-object payload", () => {
			const result = validateNormalizeReviewInput(null);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				"Normalize review input must be an object.",
			);
		});

		it("rejects missing reviewItemId, normalizedTitle, or normalizedComposer", () => {
			const result = validateNormalizeReviewInput({});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Review item ID is required.");
			expect(result.errors).toContain("Normalized title is required.");
			expect(result.errors).toContain("Normalized composer is required.");
		});

		it("rejects overly long title or composer", () => {
			const result = validateNormalizeReviewInput({
				reviewItemId: "item-1",
				normalizedTitle: "A".repeat(301),
				normalizedComposer: "B".repeat(201),
			});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				"Normalized title must be 300 characters or less.",
			);
			expect(result.errors).toContain(
				"Normalized composer must be 200 characters or less.",
			);
		});

		it("rejects invalid IMSLP URL scheme", () => {
			const result = validateNormalizeReviewInput({
				reviewItemId: "item-1",
				normalizedTitle: "Valid Title",
				normalizedComposer: "Valid Composer",
				imslpUrl: "ftp://imslp.org/file",
			});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				"IMSLP URL must be a valid HTTP or HTTPS URL.",
			);
		});

		it("rejects invalid status", () => {
			const result = validateNormalizeReviewInput({
				reviewItemId: "item-1",
				normalizedTitle: "Valid Title",
				normalizedComposer: "Valid Composer",
				status: "invalid_status" as RepertoireReviewStatus,
			});
			expect(result.valid).toBe(false);
			expect(result.errors[0]).toContain("Invalid review status");
		});
	});

	describe("validateFlagReviewInput", () => {
		it("validates valid flag review input", () => {
			const result = validateFlagReviewInput({
				reviewItemId: "item-1",
				reason: "ambiguous_title",
				notes: "Multiple sonatas in C major by Mozart",
				flaggedBy: "user-1",
				organizationId: "org-1",
			});
			expect(result.valid).toBe(true);
			expect(result.errors).toEqual([]);
			expect(result.data?.reviewItemId).toBe("item-1");
			expect(result.data?.reason).toBe("ambiguous_title");
			expect(result.data?.notes).toBe("Multiple sonatas in C major by Mozart");
		});

		it("accepts id and flagReason aliases", () => {
			const result = validateFlagReviewInput({
				id: "item-alias",
				flagReason: "missing_composer",
				flagNotes: "Needs verification",
			});
			expect(result.valid).toBe(true);
			expect(result.data?.reviewItemId).toBe("item-alias");
			expect(result.data?.reason).toBe("missing_composer");
			expect(result.data?.notes).toBe("Needs verification");
		});

		it("rejects non-object payload", () => {
			const result = validateFlagReviewInput(null);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Flag review input must be an object.");
		});

		it("rejects missing reviewItemId and reason", () => {
			const result = validateFlagReviewInput({});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Review item ID is required.");
			expect(result.errors).toContain("Flag reason is required.");
		});

		it("rejects overly long reason or notes", () => {
			const result = validateFlagReviewInput({
				reviewItemId: "item-1",
				reason: "R".repeat(201),
				notes: "N".repeat(2001),
			});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				"Flag reason must be 200 characters or less.",
			);
			expect(result.errors).toContain("Notes must be 2000 characters or less.");
		});
	});

	describe("validateResolveFlagInput", () => {
		it("validates resolution with reviewItemId", () => {
			const result = validateResolveFlagInput({
				reviewItemId: "item-1",
				resolutionNotes: "Disambiguated to K. 545",
				status: "reviewed",
				resolvedBy: "user-2",
			});
			expect(result.valid).toBe(true);
			expect(result.errors).toEqual([]);
			expect(result.data?.reviewItemId).toBe("item-1");
			expect(result.data?.resolutionNotes).toBe("Disambiguated to K. 545");
			expect(result.data?.status).toBe("reviewed");
		});

		it("validates resolution with flagId only", () => {
			const result = validateResolveFlagInput({
				flagId: "flag-99",
				notes: "Resolved via catalog match",
			});
			expect(result.valid).toBe(true);
			expect(result.data?.reviewItemId).toBe("flag-99");
			expect(result.data?.flagId).toBe("flag-99");
			expect(result.data?.resolutionNotes).toBe("Resolved via catalog match");
		});

		it("rejects non-object payload", () => {
			const result = validateResolveFlagInput(undefined);
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Resolve flag input must be an object.");
		});

		it("rejects when both reviewItemId and flagId are missing", () => {
			const result = validateResolveFlagInput({});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Review item ID is required.");
		});

		it("rejects invalid status or overly long resolution notes", () => {
			const result = validateResolveFlagInput({
				reviewItemId: "item-1",
				resolutionNotes: "N".repeat(2001),
				status: "bad_status" as RepertoireReviewStatus,
			});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				"Resolution notes must be 2000 characters or less.",
			);
			expect(result.errors[1]).toContain("Invalid review status");
		});
	});

	describe("calculateRepertoireReviewQueueSummary", () => {
		it("calculates queue summary correctly", () => {
			const items: RepertoireReviewItem[] = [
				{
					id: "item-1",
					organizationId: "org-1",
					rawTitle: "Sonata 1",
					rawComposer: "Mozart",
					status: "pending",
					createdAtIso: "2026-09-01T00:00:00Z",
					updatedAtIso: "2026-09-01T00:00:00Z",
				},
				{
					id: "item-2",
					organizationId: "org-1",
					rawTitle: "Waltz",
					rawComposer: "Chopin",
					status: "in_review",
					createdAtIso: "2026-09-01T00:00:00Z",
					updatedAtIso: "2026-09-01T00:00:00Z",
				},
				{
					id: "item-3",
					organizationId: "org-1",
					rawTitle: "Etude",
					rawComposer: "Liszt",
					status: "flagged",
					isFlagged: true,
					flagReason: "ambiguous_title",
					createdAtIso: "2026-09-01T00:00:00Z",
					updatedAtIso: "2026-09-01T00:00:00Z",
				},
				{
					id: "item-4",
					organizationId: "org-1",
					rawTitle: "Prelude",
					rawComposer: "Bach",
					status: "reviewed",
					createdAtIso: "2026-09-01T00:00:00Z",
					updatedAtIso: "2026-09-01T00:00:00Z",
				},
				{
					id: "item-5",
					organizationId: "org-1",
					rawTitle: "Nocturne",
					rawComposer: "Chopin",
					status: "approved",
					createdAtIso: "2026-09-01T00:00:00Z",
					updatedAtIso: "2026-09-01T00:00:00Z",
				},
			];

			const summary: RepertoireReviewQueueSummary =
				calculateRepertoireReviewQueueSummary(items);
			expect(summary.total).toBe(5);
			expect(summary.pending).toBe(1);
			expect(summary.inReview).toBe(1);
			expect(summary.reviewed).toBe(1);
			expect(summary.flagged).toBe(1);
			expect(summary.approved).toBe(1);
			expect(summary.completed).toBe(2);
		});
	});

	describe("validateAddCatalogWorkInput", () => {
		it("validates valid catalog work input with all fields", () => {
			const result = validateAddCatalogWorkInput({
				title: "Symphony No. 5 in C minor, Op. 67",
				composer: "Ludwig van Beethoven",
				imslpUrl:
					"https://imslp.org/wiki/Symphony_No.5,_Op.67_(Beethoven,_Ludwig_van)",
				organizationId: "org-1",
			});
			expect(result.valid).toBe(true);
			expect(result.errors).toEqual([]);
			expect(result.data?.title).toBe("Symphony No. 5 in C minor, Op. 67");
			expect(result.data?.composer).toBe("Ludwig van Beethoven");
			expect(result.data?.imslpUrl).toBe(
				"https://imslp.org/wiki/Symphony_No.5,_Op.67_(Beethoven,_Ludwig_van)",
			);
			expect(result.data?.organizationId).toBe("org-1");
		});

		it("accepts composerName as alias for composer and trims whitespace", () => {
			const result = validateAddCatalogWorkInput({
				title: "   Für Elise   ",
				composerName: "   Ludwig van Beethoven   ",
			});
			expect(result.valid).toBe(true);
			expect(result.errors).toEqual([]);
			expect(result.data?.title).toBe("Für Elise");
			expect(result.data?.composer).toBe("Ludwig van Beethoven");
			expect(result.data?.imslpUrl).toBeNull();
			expect(result.data?.organizationId).toBeUndefined();
		});

		it("rejects non-object or null payload", () => {
			expect(validateAddCatalogWorkInput(null).valid).toBe(false);
			expect(validateAddCatalogWorkInput(undefined).valid).toBe(false);
			expect(validateAddCatalogWorkInput("invalid").valid).toBe(false);
			expect(validateAddCatalogWorkInput([]).valid).toBe(false);
		});

		it("rejects missing title or composer", () => {
			const result = validateAddCatalogWorkInput({
				title: "   ",
				composer: "",
			});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Title is required.");
			expect(result.errors).toContain("Composer is required.");
		});

		it("rejects overly long title or composer", () => {
			const result = validateAddCatalogWorkInput({
				title: "a".repeat(301),
				composer: "b".repeat(201),
			});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain("Title must be 300 characters or less.");
			expect(result.errors).toContain(
				"Composer must be 200 characters or less.",
			);
		});

		it("rejects invalid IMSLP URL scheme", () => {
			const result = validateAddCatalogWorkInput({
				title: "Clair de Lune",
				composer: "Claude Debussy",
				imslpUrl: "ftp://example.com/sheet.pdf",
			});
			expect(result.valid).toBe(false);
			expect(result.errors).toContain(
				"IMSLP URL must be a valid HTTP or HTTPS URL.",
			);
		});
	});

	describe("Canonical types contract verification", () => {
		it("allows constructing CanonicalWork and CanonicalContributor", () => {
			const contributor: CanonicalContributor = {
				id: "contributor-1",
				organizationId: "org-1",
				name: "Johannes Brahms",
				normalizedName: "brahms johannes",
				imslpUrl: "https://imslp.org/wiki/Category:Brahms,_Johannes",
				isActive: true,
			};
			expect(contributor.id).toBe("contributor-1");
			expect(contributor.name).toBe("Johannes Brahms");

			const work: CanonicalWork = {
				id: "work-1",
				organizationId: "org-1",
				title: "Intermezzo in A major, Op. 118 No. 2",
				composerId: "contributor-1",
				composerName: "Johannes Brahms",
				imslpUrl:
					"https://imslp.org/wiki/6_Klavierst%C3%BCcke,_Op.118_(Brahms,_Johannes)",
				classifications: ["solo", "romantic"],
				isActive: true,
			};
			expect(work.title).toBe("Intermezzo in A major, Op. 118 No. 2");
			expect(work.composerId).toBe("contributor-1");
		});

		it("allows constructing RepertoireReviewQueueFilter", () => {
			const filter: RepertoireReviewQueueFilter = {
				organizationId: "org-1",
				classType: "solo",
				divisionId: "div-piano",
				status: "pending",
				assignedReviewerId: "rev-1",
				searchQuery: "Bach",
				isFlagged: false,
				page: 1,
				limit: 25,
			};
			expect(filter.classType).toBe("solo");
			expect(filter.searchQuery).toBe("Bach");
		});

		it("allows constructing AddCatalogWorkInput", () => {
			const input: AddCatalogWorkInput = {
				title: "Prelude in C Major",
				composer: "J.S. Bach",
				imslpUrl: "https://imslp.org/wiki/Well-Tempered_Clavier",
				organizationId: "org-1",
			};
			expect(input.title).toBe("Prelude in C Major");
			expect(input.composer).toBe("J.S. Bach");
		});
	});
});
