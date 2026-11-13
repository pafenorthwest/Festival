import { describe, expect, it } from "bun:test";
import * as v from "valibot";
import {
	AcceptInviteInputSchema,
	AcquireAccompanistMembershipPayloadSchema,
	AddRepertoireCatalogWorkInputSchema,
	AdminCheckoutIntentSchema,
	AdminResolveClassCheckoutRecoveryPayloadSchema,
	BookShiftsInputSchema,
	CreateBillingAdjustmentPayloadSchema,
	CreateCustomerChildInputSchema,
	CreateFestivalClassInputSchema,
	CreateFestivalInputSchema,
	CreateInviteInputSchema,
	CreateOrganizationInputSchema,
	CreateRoomInputSchema,
	CreateVolunteerRoleInputSchema,
	CreateVolunteerShiftInputSchema,
	CustomerChildDtoSchema,
	CustomerMembershipCheckoutPayloadSchema,
	DropRegistrationBodySchema,
	EnrollVolunteerInputSchema,
	EvaluateRegistrationEligibilityInputSchema,
	FlagRepertoireReviewInputSchema,
	JoinWaitlistBodySchema,
	LoginEventInputSchema,
	NormalizeRepertoireReviewInputSchema,
	RecoveryReviewDtoSchema,
	RepertoirePieceSchema,
	ResolveRepertoireFlagInputSchema,
	RetireMembershipProductPayloadSchema,
	RoomSchema,
	SaveCustomerFestivalAvailabilityInputSchema,
	StaffMembershipRosterEntrySchema,
	StartClassCheckoutInputSchema,
	StartClassCheckoutResponseSchema,
	TransferRegistrationBodySchema,
	TriggerEventResultSchema,
	UpdateAccompanistPolicyInputSchema,
	UpdateAdminTeacherProfileApprovalInputSchema,
	UpdateCustomerProfilePayloadSchema,
	UpdateRegistrationAgeDateInputSchema,
	UpdateRegistrationMetadataInputSchema,
	UpsertCustomerTeacherProfileInputSchema,
	VolunteerCoverageGapsResponseSchema,
	VolunteerShiftListingSchema,
	WithdrawWaitlistBodySchema,
} from "../src/index.js";

describe("@festival/common valibot schemas", () => {
	it("validates tenant schemas (rooms, festivals, divisions)", () => {
		const roomResult = v.safeParse(CreateRoomInputSchema, {
			name: "Hall A",
			pianoConfigurations: [
				{ pianoType: "grand", count: 2 },
				{ pianoType: "upright", count: 1 },
			],
		});
		expect(roomResult.success).toBe(true);

		expect(
			v.safeParse(CreateRoomInputSchema, {
				name: "Too many pianos",
				pianoConfigurations: [{ pianoType: "grand", count: 4 }],
			}).success,
		).toBe(false);

		expect(
			v.safeParse(CreateRoomInputSchema, {
				name: "Duplicate types",
				pianoConfigurations: [
					{ pianoType: "grand", count: 1 },
					{ pianoType: "grand", count: 1 },
				],
			}).success,
		).toBe(false);

		expect(
			v.safeParse(RoomSchema, {
				id: "room_1",
				organizationId: "org_1",
				festivalId: "fest_1",
				name: "Hall A",
				pianoConfigurations: [{ pianoType: "upright", count: 1 }],
				createdAtIso: "2026-01-01T00:00:00.000Z",
			}).success,
		).toBe(true);

		expect(
			v.safeParse(CreateFestivalInputSchema, {
				name: "Spring Festival",
				shortName: "spring-2026",
				startDate: "2026-05-01",
				endDate: "2026-05-03",
			}).success,
		).toBe(true);
		expect(
			v.safeParse(CreateFestivalInputSchema, {
				name: "Spring Festival",
				shortName: "spring-2026",
			}).success,
		).toBe(false);
		expect(
			v.safeParse(CreateFestivalInputSchema, {
				name: "   ",
				shortName: "spring",
				startDate: "2026-05-01",
				endDate: "2026-05-03",
			}).success,
		).toBe(false);

		expect(
			v.safeParse(CreateOrganizationInputSchema, {
				name: "Seattle Music",
				shortName: "seattle-music",
				defaultCurrencyCode: "USD",
			}).success,
		).toBe(true);
		expect(
			v.safeParse(CreateOrganizationInputSchema, {
				name: "Seattle Music",
			}).success,
		).toBe(false);
		expect(
			v.safeParse(CreateInviteInputSchema, {
				organizationSlug: "seattle-music",
				email: "chair@example.com",
				role: "Admin",
			}).success,
		).toBe(true);
		expect(
			v.safeParse(CreateInviteInputSchema, {
				organizationId: "org_1",
				email: "chair@example.com",
				role: "Admin",
			}).success,
		).toBe(false);
		expect(v.safeParse(AcceptInviteInputSchema, { name: "Ada" }).success).toBe(
			true,
		);
		expect(v.safeParse(AcceptInviteInputSchema, {}).success).toBe(false);
		expect(
			v.safeParse(UpdateAccompanistPolicyInputSchema, {
				policy: "one_to_two",
			}).success,
		).toBe(true);
		expect(
			v.safeParse(UpdateAccompanistPolicyInputSchema, {
				policy: "optional",
			}).success,
		).toBe(false);
		expect(
			v.safeParse(UpdateRegistrationAgeDateInputSchema, {
				registrationAgeDate: "2026-04-01",
			}).success,
		).toBe(true);
		expect(
			v.safeParse(LoginEventInputSchema, { provider: "google" }).success,
		).toBe(true);
		expect(
			v.safeParse(LoginEventInputSchema, { provider: "github" }).success,
		).toBe(false);
	});

	it("validates catalog and repertoire review schemas", () => {
		expect(
			v.safeParse(CreateFestivalClassInputSchema, {
				displayName: "Solo Piano Senior",
				classSubtypeId: "sub_1",
				divisionId: "div_1",
				minimumAge: 10,
				maximumAge: 18,
				price: "45.00",
				performanceMinutes: 12,
			}).success,
		).toBe(true);
		expect(
			v.safeParse(CreateFestivalClassInputSchema, {
				displayName: "Bad Class",
				classSubtypeId: "sub_1",
				divisionId: "div_1",
				minimumAge: 10,
				maximumAge: 18,
				price: "45.00",
				performanceMinutes: 0,
			}).success,
		).toBe(false);

		expect(
			v.safeParse(NormalizeRepertoireReviewInputSchema, {
				normalizedTitle: "Sonata in C",
				normalizedComposer: "W. A. Mozart",
				status: "approved",
			}).success,
		).toBe(true);
		expect(
			v.safeParse(NormalizeRepertoireReviewInputSchema, {
				normalizedTitle: "",
				normalizedComposer: "Mozart",
			}).success,
		).toBe(false);

		expect(
			v.safeParse(FlagRepertoireReviewInputSchema, {
				reason: "ambiguous_title",
				notes: "Check opus number",
			}).success,
		).toBe(true);
		expect(
			v.safeParse(ResolveRepertoireFlagInputSchema, {
				resolutionNotes: "Verified edition",
				status: "reviewed",
			}).success,
		).toBe(true);
		expect(
			v.safeParse(AddRepertoireCatalogWorkInputSchema, {
				title: "Nocturne Op. 9 No. 2",
				composer: "Fryderyk Chopin",
			}).success,
		).toBe(true);
	});

	it("validates customer schemas (children, profile, availability)", () => {
		expect(
			v.safeParse(CustomerChildDtoSchema, {
				id: "child_1",
				displayName: "Ada Lovelace",
				hasCurrentValidAgeSnapshot: true,
			}).success,
		).toBe(true);

		expect(
			v.safeParse(CreateCustomerChildInputSchema, {
				displayName: "Ada",
				birthday: "2015-04-10",
			}).success,
		).toBe(true);
		expect(
			v.safeParse(CreateCustomerChildInputSchema, {
				displayName: "Ada",
				birthday: "04/10/2015",
			}).success,
		).toBe(false);

		expect(
			v.safeParse(UpdateCustomerProfilePayloadSchema, {
				name: "Parent Name",
				email: "parent@example.com",
				phone: "+1 206 555 0100",
				mailingAddress: {
					line1: "123 Main St",
					city: "Seattle",
					region: "WA",
					postalCode: "98101",
					countryCode: "US",
				},
			}).success,
		).toBe(true);
		expect(
			v.safeParse(UpdateCustomerProfilePayloadSchema, {
				name: "Parent Name",
				email: "not-an-email",
				phone: "+1 206 555 0100",
				mailingAddress: {
					line1: "123 Main St",
					city: "Seattle",
					region: "WA",
					postalCode: "98101",
					countryCode: "US",
				},
			}).success,
		).toBe(false);

		expect(
			v.safeParse(SaveCustomerFestivalAvailabilityInputSchema, {
				festivalId: "fest_1",
				subjects: [
					{
						subjectType: "child",
						subjectId: "child_1",
						days: [{ date: "2026-05-01", availableHours: [9, 10] }],
					},
				],
			}).success,
		).toBe(true);
		expect(
			v.safeParse(SaveCustomerFestivalAvailabilityInputSchema, {
				festivalId: "fest_1",
				subjects: [
					{
						subjectType: "child",
						subjectId: "child_1",
						days: [{ date: "2026-05-01", availableHours: [25] }],
					},
				],
			}).success,
		).toBe(false);
	});

	it("validates directory schemas (profiles, approval, roster)", () => {
		expect(
			v.safeParse(UpsertCustomerTeacherProfileInputSchema, {
				displayName: "Dr. Clara Schumann",
				publicDirectoryOptIn: true,
				divisionIds: ["div_piano"],
			}).success,
		).toBe(true);
		expect(
			v.safeParse(UpsertCustomerTeacherProfileInputSchema, {
				displayName: "",
				publicDirectoryOptIn: true,
				divisionIds: [],
			}).success,
		).toBe(false);

		expect(
			v.safeParse(UpdateAdminTeacherProfileApprovalInputSchema, {
				profileId: "prof_1",
				approvalStatus: "approved",
			}).success,
		).toBe(true);
		expect(
			v.safeParse(UpdateAdminTeacherProfileApprovalInputSchema, {
				profileId: "prof_1",
				approvalStatus: "unknown",
			}).success,
		).toBe(false);

		expect(
			v.safeParse(StaffMembershipRosterEntrySchema, {
				membershipType: "Teacher",
				offeringName: "Teacher Annual",
				source: "shopify",
				status: "active",
				startsOn: "2026-01-01",
				endsOn: "2027-01-01",
				divisions: [{ divisionId: "div_1", divisionName: "Piano" }],
			}).success,
		).toBe(true);
	});

	it("validates registration schemas (eligibility, checkout, metadata, repertoire pieces)", () => {
		expect(
			v.safeParse(RepertoirePieceSchema, {
				title: "Invention No. 1",
				composer: "J. S. Bach",
				durationSeconds: 90,
			}).success,
		).toBe(true);
		expect(
			v.safeParse(RepertoirePieceSchema, {
				title: "Invention No. 1",
				composer: "J. S. Bach",
				durationSeconds: 0,
			}).success,
		).toBe(false);

		expect(
			v.safeParse(EvaluateRegistrationEligibilityInputSchema, {
				items: [{ childId: "c1", festivalClassId: "fc1" }],
			}).success,
		).toBe(true);
		expect(
			v.safeParse(EvaluateRegistrationEligibilityInputSchema, { items: [] })
				.success,
		).toBe(false);

		expect(
			v.safeParse(StartClassCheckoutInputSchema, {
				lineItems: [
					{
						childId: "c1",
						festivalClassId: "fc1",
						teacherId: "t1",
						pieces: [
							{ title: "Piece", composer: "Composer", durationSeconds: 120 },
						],
					},
				],
			}).success,
		).toBe(true);
		expect(
			v.safeParse(StartClassCheckoutResponseSchema, {
				checkoutUrl: "https://shop.example/checkout/1",
				correlationId: "corr_1",
			}).success,
		).toBe(true);
		expect(
			v.safeParse(UpdateRegistrationMetadataInputSchema, {
				accompanistId: null,
				customField: "kept",
			}).success,
		).toBe(true);
		expect(
			v.safeParse(JoinWaitlistBodySchema, {
				childId: "child_1",
				parentName: "Jane Parent",
				parentEmail: "jane@example.com",
				parentPhone: "206-555-0100",
				staffAccessConsent: true,
			}).success,
		).toBe(true);
		expect(
			v.safeParse(JoinWaitlistBodySchema, { childId: "child_1" }).success,
		).toBe(false);
		expect(
			v.safeParse(WithdrawWaitlistBodySchema, {
				waitlistEntryId: "wl_1",
			}).success,
		).toBe(true);
		expect(
			v.safeParse(WithdrawWaitlistBodySchema, { childId: "child_1" }).success,
		).toBe(true);
		expect(v.safeParse(WithdrawWaitlistBodySchema, {}).success).toBe(false);
		expect(
			v.safeParse(DropRegistrationBodySchema, {
				reason: "Schedule conflict",
				requestRefund: true,
			}).success,
		).toBe(true);
		expect(
			v.safeParse(TransferRegistrationBodySchema, {
				targetFestivalClassId: "class_2",
			}).success,
		).toBe(true);
		expect(v.safeParse(TransferRegistrationBodySchema, {}).success).toBe(false);
		expect(
			v.safeParse(AcquireAccompanistMembershipPayloadSchema, {
				name: "Sam Accompanist",
				email: "sam@example.com",
				city: "Seattle",
				phone: "206-555-0199",
				divisionIds: ["div_1"],
				staffAccessConsent: true,
			}).success,
		).toBe(true);
	});

	it("validates commerce schemas (billing adjustments, recovery, checkout)", () => {
		expect(
			v.safeParse(CreateBillingAdjustmentPayloadSchema, {
				customerId: "cust_1",
				adjustmentType: "credit_issue",
				amountCents: 2500,
				reason: "Schedule adjustment",
			}).success,
		).toBe(true);
		expect(
			v.safeParse(CreateBillingAdjustmentPayloadSchema, {
				customerId: "cust_1",
				adjustmentType: "invalid_type",
				amountCents: 100,
				reason: "bad",
			}).success,
		).toBe(false);

		const intent = {
			id: "intent_1",
			correlationId: "corr_1",
			organizationId: "org_1",
			customerId: "cust_1",
			sessionId: "sess_1",
			idempotencyKey: "idem_1",
			intentType: "membership",
			offeringId: "off_1",
			entitlementClass: "teacher_membership",
			durationDays: 365,
			festivalClassId: null,
			childId: null,
			shopifyProductGid: "gid://shopify/Product/1",
			shopifyVariantGid: "gid://shopify/ProductVariant/1",
			policyVersion: "v1",
			divisionId: "div_1",
			divisionNameSnapshot: "Piano",
			staffAccessConsent: true,
			amount: "50.00",
			currencyCode: "USD",
			cartReference: null,
			status: "created",
			expiresAtIso: "2026-06-01T00:00:00.000Z",
			createdAtIso: "2026-05-01T00:00:00.000Z",
		};
		expect(v.safeParse(AdminCheckoutIntentSchema, intent).success).toBe(true);
		expect(
			v.safeParse(RecoveryReviewDtoSchema, {
				recoveryRequest: {
					id: "rec_1",
					status: "pending",
					expiresAtIso: "2026-06-01T00:00:00.000Z",
					createdAtIso: "2026-05-01T00:00:00.000Z",
				},
				sourceIntent: intent,
				offering: null,
				division: null,
			}).success,
		).toBe(true);

		expect(
			v.safeParse(CustomerMembershipCheckoutPayloadSchema, {
				offeringId: "off_1",
				divisionId: "div_1",
				staffAccessConsent: true,
			}).success,
		).toBe(true);
		expect(
			v.safeParse(CustomerMembershipCheckoutPayloadSchema, {
				offeringId: "off_1",
				divisionId: "div_1",
				staffAccessConsent: false,
			}).success,
		).toBe(false);
		expect(
			v.safeParse(RetireMembershipProductPayloadSchema, { confirmed: false })
				.success,
		).toBe(false);
		expect(
			v.safeParse(AdminResolveClassCheckoutRecoveryPayloadSchema, {
				expectedGeneration: 1,
				reason: "Operator verified",
				action: "adopt_cart",
			}).success,
		).toBe(true);
	});

	it("validates volunteers and communication schemas", () => {
		expect(
			v.safeParse(CreateVolunteerRoleInputSchema, {
				slug: "room-proctor",
				displayName: "Room Proctor",
				description: "Manage recital room",
				isRoomProctor: true,
			}).success,
		).toBe(true);
		expect(
			v.safeParse(CreateVolunteerShiftInputSchema, {
				date: "2026-05-12",
				period: "AM",
			}).success,
		).toBe(true);
		expect(
			v.safeParse(CreateVolunteerShiftInputSchema, {
				date: "2026-05-12",
				period: "NIGHT",
			}).success,
		).toBe(false);
		expect(
			v.safeParse(EnrollVolunteerInputSchema, {
				name: "Alex Volunteer",
				phone: "555-0199",
			}).success,
		).toBe(true);
		expect(
			v.safeParse(BookShiftsInputSchema, { shiftIds: ["s1"] }).success,
		).toBe(true);
		expect(v.safeParse(BookShiftsInputSchema, { shiftIds: [] }).success).toBe(
			false,
		);

		const role = {
			id: "r1",
			organizationId: "o1",
			festivalId: "f1",
			slug: "proctor",
			displayName: "Proctor",
			description: "Help",
			detailsUrl: null,
			isRoomProctor: true,
			createdAtIso: "2026-01-01T00:00:00.000Z",
		};
		const shift = {
			id: "s1",
			organizationId: "o1",
			festivalId: "f1",
			roleId: "r1",
			date: "2026-05-12",
			period: "PM",
			timeText: "1:00 PM",
			division: null,
			adjudicator: null,
			createdAtIso: "2026-01-01T00:00:00.000Z",
		};
		expect(
			v.safeParse(VolunteerShiftListingSchema, {
				...shift,
				available: true,
				role,
				shift,
			}).success,
		).toBe(true);
		expect(
			v.safeParse(VolunteerCoverageGapsResponseSchema, {
				totalShifts: 1,
				coveredShifts: 0,
				unfilledShifts: 1,
				coveragePercentage: 0,
				gaps: [],
				slots: [],
				openShifts: 1,
				unfilled: [],
			}).success,
		).toBe(true);
		expect(
			v.safeParse(TriggerEventResultSchema, {
				status: "delivered",
				success: true,
				event: {
					id: "ev1",
					organizationId: "o1",
					eventType: "welcome",
					recipientDestination: "a@b.com",
					payload: {},
					idempotencyKey: "k1",
					status: "delivered",
				},
			}).success,
		).toBe(true);
	});
});
