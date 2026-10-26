import { describe, expect, it } from "bun:test";
import { CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION } from "@festival/common";
import { InMemoryCustomerAccountRepository } from "../src/customer/in-memory-customer-account-repository.js";
import { InMemoryOrganizationRepository } from "../src/repo/in-memory-organization-repository.js";
import { InMemoryWaitlistRepository } from "../src/waitlist/in-memory-waitlist-repository.js";
import { WaitlistService } from "../src/waitlist/waitlist-service.js";

describe("InMemoryWaitlistRepository", () => {
	const orgId = "org-1";
	const festivalId = "fest-1";
	const classId = "class-1";
	const parentId = "parent-1";
	const childId = "child-1";

	it("creates an entry and logs event", async () => {
		const repo = new InMemoryWaitlistRepository();
		const result = await repo.createOrReactivateEntry({
			organizationId: orgId,
			festivalId,
			festivalClassId: classId,
			parentCustomerId: parentId,
			childId,
		});

		expect(result.alreadyJoined).toBe(false);
		expect(result.action).toBe("joined");
		expect(result.entry.status).toBe("active");
		expect(result.entry.childId).toBe(childId);

		const active = await repo.findActiveEntry(orgId, classId, childId);
		expect(active).not.toBeNull();
		expect(active?.id).toBe(result.entry.id);

		const events = await repo.listEventsForEntry(orgId, result.entry.id);
		expect(events.length).toBe(1);
		expect(events[0].eventType).toBe("joined");
	});

	it("returns alreadyJoined=true if already active", async () => {
		const repo = new InMemoryWaitlistRepository();
		const first = await repo.createOrReactivateEntry({
			organizationId: orgId,
			festivalId,
			festivalClassId: classId,
			parentCustomerId: parentId,
			childId,
		});
		const second = await repo.createOrReactivateEntry({
			organizationId: orgId,
			festivalId,
			festivalClassId: classId,
			parentCustomerId: parentId,
			childId,
		});

		expect(second.alreadyJoined).toBe(true);
		expect(second.action).toBe("none");
		expect(second.entry.id).toBe(first.entry.id);

		const events = await repo.listEventsForEntry(orgId, first.entry.id);
		expect(events.length).toBe(1);
	});

	it("handles withdraw and reactivation", async () => {
		const repo = new InMemoryWaitlistRepository();
		const created = await repo.createOrReactivateEntry({
			organizationId: orgId,
			festivalId,
			festivalClassId: classId,
			parentCustomerId: parentId,
			childId,
		});

		const withdraw1 = await repo.withdrawEntry(
			orgId,
			classId,
			childId,
			"parent",
			parentId,
		);
		expect(withdraw1.alreadyWithdrawn).toBe(false);
		expect(withdraw1.entry?.status).toBe("withdrawn");
		expect(withdraw1.entry?.withdrawnAt).toBeDefined();

		const active = await repo.findActiveEntry(orgId, classId, childId);
		expect(active).toBeNull();

		const withdraw2 = await repo.withdrawEntry(
			orgId,
			classId,
			childId,
			"parent",
			parentId,
		);
		expect(withdraw2.alreadyWithdrawn).toBe(true);
		expect(withdraw2.entry?.status).toBe("withdrawn");

		const reactivated = await repo.createOrReactivateEntry({
			organizationId: orgId,
			festivalId,
			festivalClassId: classId,
			parentCustomerId: parentId,
			childId,
		});
		expect(reactivated.alreadyJoined).toBe(false);
		expect(reactivated.action).toBe("rejoined");
		expect(reactivated.entry.status).toBe("active");
		expect(reactivated.entry.id).toBe(created.entry.id);

		const events = await repo.listEventsForEntry(orgId, created.entry.id);
		expect(events.length).toBe(3);
		expect(events.map((e) => e.eventType)).toEqual([
			"joined",
			"withdrawn",
			"rejoined",
		]);
	});

	it("returns null entry on withdraw if never existed", async () => {
		const repo = new InMemoryWaitlistRepository();
		const result = await repo.withdrawEntry(
			orgId,
			classId,
			"unknown-child",
			"parent",
			parentId,
		);
		expect(result.entry).toBeNull();
		expect(result.alreadyWithdrawn).toBe(false);
	});

	it("lists entries for parent with filters and sorting", async () => {
		const repo = new InMemoryWaitlistRepository();
		await repo.createOrReactivateEntry({
			organizationId: orgId,
			festivalId,
			festivalClassId: "class-A",
			parentCustomerId: parentId,
			childId: "child-1",
		});
		await repo.createOrReactivateEntry({
			organizationId: orgId,
			festivalId,
			festivalClassId: "class-B",
			parentCustomerId: parentId,
			childId: "child-2",
		});
		await repo.createOrReactivateEntry({
			organizationId: orgId,
			festivalId: "other-fest",
			festivalClassId: "class-C",
			parentCustomerId: "other-parent",
			childId: "child-3",
		});

		const parentEntries = await repo.listEntriesForParent(orgId, parentId);
		expect(parentEntries.length).toBe(2);

		const filteredByClass = await repo.listEntriesForParent(
			orgId,
			parentId,
			festivalId,
			"class-A",
		);
		expect(filteredByClass.length).toBe(1);
		expect(filteredByClass[0].festivalClassId).toBe("class-A");
	});

	it("lists entries for class roster with active first", async () => {
		const repo = new InMemoryWaitlistRepository();
		await repo.createOrReactivateEntry({
			organizationId: orgId,
			festivalId,
			festivalClassId: classId,
			parentCustomerId: parentId,
			childId: "child-1",
		});
		await repo.createOrReactivateEntry({
			organizationId: orgId,
			festivalId,
			festivalClassId: classId,
			parentCustomerId: parentId,
			childId: "child-2",
		});

		// Withdraw first entry
		await repo.withdrawEntry(orgId, classId, "child-1", "parent", parentId);

		const roster = await repo.listEntriesForClassRoster(orgId, classId);
		expect(roster.length).toBe(2);
		expect(roster[0].childId).toBe("child-2");
		expect(roster[0].status).toBe("active");
		expect(roster[1].childId).toBe("child-1");
		expect(roster[1].status).toBe("withdrawn");
	});
});

describe("WaitlistService", () => {
	async function createFixture() {
		const orgRepo = new InMemoryOrganizationRepository();
		const customerRepo = new InMemoryCustomerAccountRepository();
		const waitlistRepo = new InMemoryWaitlistRepository();

		const org = await orgRepo.createOrganization({
			name: "Music Festival",
			slug: "music-fest",
		});

		const festival = await orgRepo.createFestival({
			id: "fest-1",
			organizationId: org.id,
			name: "Annual Music Festival 2026",
			code: "AMF2026",
			shortName: "AMF",
			startDate: "2026-05-01",
			endDate: "2026-05-10",
		});

		const division = await orgRepo.createDivision({
			organizationId: org.id,
			name: "Piano Division",
			sortOrder: 1,
		});

		const subtype = await orgRepo.createRegistrationCatalogValue({
			organizationId: org.id,
			kind: "class_subtype",
			displayName: "Solo Classical",
			normalizedName: "solo classical",
		});

		const classConfig = await orgRepo.createFestivalClassConfiguration({
			organizationId: org.id,
			festivalId: festival.id,
			displayName: "Grade 8 Piano",
			classSubtypeId: subtype.id,
			divisionId: division.id,
			minimumAge: 10,
			maximumAge: 18,
			priceInCents: 3000,
			price: "30.00",
			capacity: 2,
			maximumPerformancePieces: 1,
			performanceMinutes: 10,
		});

		const session = await customerRepo.createCustomerSession({
			organizationId: org.id,
			shopifyCustomerGid: "gid://shopify/Customer/1001",
			encryptedTokens: "tokens",
			csrfToken: "csrf",
			integrationVersion: 1,
			createdAtIso: new Date().toISOString(),
			lastSeenAtIso: new Date().toISOString(),
			expiresAtIso: new Date(Date.now() + 86400000).toISOString(),
		});
		const parentCustomer = session.customer;

		const child = await customerRepo.createChild({
			organizationId: org.id,
			parentCustomerId: parentCustomer.id,
			displayName: "Emma Watson",
			firstName: "Emma",
			lastName: "Watson",
		});

		let placedEntitlementCount = 2; // class is full by default (capacity: 2)

		const service = new WaitlistService({
			waitlistRepo,
			orgRepo,
			customerRepo,
			entitlementCount: async () => placedEntitlementCount,
		});

		return {
			org,
			festival,
			classConfig,
			parentCustomer,
			child,
			orgRepo,
			customerRepo,
			waitlistRepo,
			service,
			setPlacedCount: (n: number) => {
				placedEntitlementCount = n;
			},
		};
	}

	describe("joinWaitlist", () => {
		it("validates input fields", async () => {
			const f = await createFixture();
			await expect(
				f.service.joinWaitlist({
					organizationId: f.org.id,
					festivalId: f.festival.id,
					festivalClassId: f.classConfig.id,
					parentCustomerId: f.parentCustomer.id,
					childId: f.child.id,
					parentName: "John Doe",
					parentEmail: "invalid-email",
					parentPhone: "555-1234",
					staffAccessConsent: true,
				}),
			).rejects.toThrow("Parent email is invalid.");
		});

		it("throws 404 if child does not belong to parent", async () => {
			const f = await createFixture();
			await expect(
				f.service.joinWaitlist({
					organizationId: f.org.id,
					festivalId: f.festival.id,
					festivalClassId: f.classConfig.id,
					parentCustomerId: f.parentCustomer.id,
					childId: "non-existent-child",
					parentName: "John Doe",
					parentEmail: "john@example.com",
					parentPhone: "555-123-4567",
					staffAccessConsent: true,
				}),
			).rejects.toThrow(
				"Child not found or does not belong to parent customer.",
			);
		});

		it("throws 404 if class configuration not found", async () => {
			const f = await createFixture();
			await expect(
				f.service.joinWaitlist({
					organizationId: f.org.id,
					festivalId: f.festival.id,
					festivalClassId: "non-existent-class",
					parentCustomerId: f.parentCustomer.id,
					childId: f.child.id,
					parentName: "John Doe",
					parentEmail: "john@example.com",
					parentPhone: "555-123-4567",
					staffAccessConsent: true,
				}),
			).rejects.toThrow("Class configuration not found.");
		});

		it("throws 400 if class has open capacity", async () => {
			const f = await createFixture();
			f.setPlacedCount(0); // 0 out of 2 spots taken -> open capacity

			await expect(
				f.service.joinWaitlist({
					organizationId: f.org.id,
					festivalId: f.festival.id,
					festivalClassId: f.classConfig.id,
					parentCustomerId: f.parentCustomer.id,
					childId: f.child.id,
					parentName: "John Doe",
					parentEmail: "john@example.com",
					parentPhone: "555-123-4567",
					staffAccessConsent: true,
				}),
			).rejects.toThrow(
				"Class has open capacity and does not require waitlist.",
			);
		});

		it("successfully joins waitlist when capacity is full", async () => {
			const f = await createFixture();
			f.setPlacedCount(2); // capacity is 2

			const result = await f.service.joinWaitlist({
				organizationId: f.org.id,
				festivalId: f.festival.id,
				festivalClassId: f.classConfig.id,
				parentCustomerId: f.parentCustomer.id,
				childId: f.child.id,
				parentName: "John Doe",
				parentEmail: "john@example.com",
				parentPhone: "555-123-4567",
				staffAccessConsent: true,
			});

			expect(result.alreadyJoined).toBe(false);
			expect(result.entry.status).toBe("active");
			expect(result.entry.parentName).toBe("John Doe");
			expect(result.entry.parentEmail).toBe("john@example.com");

			// Profile applied
			const updatedCustomer = await f.customerRepo.getCustomer(
				f.org.id,
				f.parentCustomer.id,
			);
			expect(updatedCustomer?.name.value).toBe("John Doe");
			expect(updatedCustomer?.email.value).toBe("john@example.com");

			// Staff access consent recorded
			const consented = await f.customerRepo.getConsentedCustomer(
				f.org.id,
				f.parentCustomer.id,
				CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
			);
			expect(consented).not.toBeNull();

			// Calling join again reports alreadyJoined=true
			const again = await f.service.joinWaitlist({
				organizationId: f.org.id,
				festivalId: f.festival.id,
				festivalClassId: f.classConfig.id,
				parentCustomerId: f.parentCustomer.id,
				childId: f.child.id,
				parentName: "John Doe",
				parentEmail: "john@example.com",
				parentPhone: "555-123-4567",
				staffAccessConsent: true,
			});
			expect(again.alreadyJoined).toBe(true);
		});
	});

	describe("withdrawWaitlist", () => {
		it("withdraws child from waitlist", async () => {
			const f = await createFixture();
			await f.service.joinWaitlist({
				organizationId: f.org.id,
				festivalId: f.festival.id,
				festivalClassId: f.classConfig.id,
				parentCustomerId: f.parentCustomer.id,
				childId: f.child.id,
				parentName: "John Doe",
				parentEmail: "john@example.com",
				parentPhone: "555-123-4567",
				staffAccessConsent: true,
			});

			const withdrawal = await f.service.withdrawWaitlist({
				organizationId: f.org.id,
				parentCustomerId: f.parentCustomer.id,
				childId: f.child.id,
				festivalClassId: f.classConfig.id,
			});

			expect(withdrawal.alreadyWithdrawn).toBe(false);
			expect(withdrawal.entry?.status).toBe("withdrawn");

			// Repeat withdrawal
			const repeat = await f.service.withdrawWaitlist({
				organizationId: f.org.id,
				parentCustomerId: f.parentCustomer.id,
				childId: f.child.id,
				festivalClassId: f.classConfig.id,
			});
			expect(repeat.alreadyWithdrawn).toBe(true);
		});

		it("throws 404 if child does not belong to parent customer", async () => {
			const f = await createFixture();
			await expect(
				f.service.withdrawWaitlist({
					organizationId: f.org.id,
					parentCustomerId: f.parentCustomer.id,
					childId: "other-child",
					festivalClassId: f.classConfig.id,
				}),
			).rejects.toThrow(
				"Child not found or does not belong to parent customer.",
			);
		});
	});

	describe("listParentWaitlistEntries", () => {
		it("lists entries for parent enriched with childDisplayName", async () => {
			const f = await createFixture();
			await f.service.joinWaitlist({
				organizationId: f.org.id,
				festivalId: f.festival.id,
				festivalClassId: f.classConfig.id,
				parentCustomerId: f.parentCustomer.id,
				childId: f.child.id,
				parentName: "John Doe",
				parentEmail: "john@example.com",
				parentPhone: "555-123-4567",
				staffAccessConsent: true,
			});

			const list = await f.service.listParentWaitlistEntries({
				organizationId: f.org.id,
				parentCustomerId: f.parentCustomer.id,
			});

			expect(list.length).toBe(1);
			expect(list[0].childDisplayName).toBe("Emma Watson");
			expect(list[0].childName).toBe("Emma Watson");
		});
	});

	describe("listClassWaitlistRosterForAdmin", () => {
		it("validates festival and class", async () => {
			const f = await createFixture();
			await expect(
				f.service.listClassWaitlistRosterForAdmin({
					organizationId: f.org.id,
					festivalId: "bad-fest",
					classId: f.classConfig.id,
					actorUid: "admin-1",
				}),
			).rejects.toThrow("Festival not found.");
		});

		it("returns roster entries with audit and consent checks", async () => {
			const f = await createFixture();
			await f.service.joinWaitlist({
				organizationId: f.org.id,
				festivalId: f.festival.id,
				festivalClassId: f.classConfig.id,
				parentCustomerId: f.parentCustomer.id,
				childId: f.child.id,
				parentName: "John Doe",
				parentEmail: "john@example.com",
				parentPhone: "555-123-4567",
				staffAccessConsent: true,
			});

			const roster = await f.service.listClassWaitlistRosterForAdmin({
				organizationId: f.org.id,
				festivalId: f.festival.id,
				classId: f.classConfig.id,
				actorUid: "admin-user-42",
			});

			expect(roster.length).toBe(1);
			expect(roster[0].childName).toBe("Emma Watson");
			expect(roster[0].parentName).toBe("John Doe");
			expect(roster[0].parentEmail).toBe("john@example.com");
			expect(roster[0].parentPhone).toBe("555-123-4567");
			expect(roster[0].position).toBe(1);
			expect(roster[0].status).toBe("active");
		});

		it("handles withdrawn entries and non-consented parents in roster", async () => {
			const f = await createFixture();
			// Join and then withdraw
			await f.service.joinWaitlist({
				organizationId: f.org.id,
				festivalId: f.festival.id,
				festivalClassId: f.classConfig.id,
				parentCustomerId: f.parentCustomer.id,
				childId: f.child.id,
				parentName: "John Doe",
				parentEmail: "john@example.com",
				parentPhone: "555-123-4567",
				staffAccessConsent: true,
			});
			await f.service.withdrawWaitlist({
				organizationId: f.org.id,
				parentCustomerId: f.parentCustomer.id,
				childId: f.child.id,
				festivalClassId: f.classConfig.id,
			});

			const roster = await f.service.listClassWaitlistRosterForAdmin({
				organizationId: f.org.id,
				festivalId: f.festival.id,
				classId: f.classConfig.id,
				actorUid: "admin-user-42",
			});

			expect(roster.length).toBe(1);
			expect(roster[0].status).toBe("withdrawn");
			expect(roster[0].position).toBeUndefined();
		});
	});

	describe("reactivation and constructor overloads", () => {
		it("reactivates previously withdrawn entry", async () => {
			const f = await createFixture();
			await f.service.joinWaitlist({
				organizationId: f.org.id,
				festivalId: f.festival.id,
				festivalClassId: f.classConfig.id,
				parentCustomerId: f.parentCustomer.id,
				childId: f.child.id,
				parentName: "John Doe",
				parentEmail: "john@example.com",
				parentPhone: "555-123-4567",
				staffAccessConsent: true,
			});

			await f.service.withdrawWaitlist({
				organizationId: f.org.id,
				parentCustomerId: f.parentCustomer.id,
				childId: f.child.id,
				festivalClassId: f.classConfig.id,
			});

			const rejoins = await f.service.joinWaitlist({
				organizationId: f.org.id,
				festivalId: f.festival.id,
				festivalClassId: f.classConfig.id,
				parentCustomerId: f.parentCustomer.id,
				childId: f.child.id,
				parentName: "John Doe",
				parentEmail: "john@example.com",
				parentPhone: "555-123-4567",
				staffAccessConsent: true,
			});

			expect(rejoins.alreadyJoined).toBe(false);
			expect(rejoins.entry.status).toBe("active");
		});

		it("instantiates via positional arguments", async () => {
			const f = await createFixture();
			const service = new WaitlistService(
				f.waitlistRepo,
				f.orgRepo,
				f.customerRepo,
				async () => 2,
			);
			expect(service).toBeInstanceOf(WaitlistService);
		});

		it("throws 400 when festivalId does not match class festivalId", async () => {
			const f = await createFixture();
			const otherFest = await f.orgRepo.createFestival({
				id: "fest-other",
				organizationId: f.org.id,
				name: "Other Festival",
				code: "OTHER2026",
				shortName: "OTHER",
				startDate: "2026-06-01",
				endDate: "2026-06-10",
			});
			await expect(
				f.service.joinWaitlist({
					organizationId: f.org.id,
					festivalId: otherFest.id,
					festivalClassId: f.classConfig.id,
					parentCustomerId: f.parentCustomer.id,
					childId: f.child.id,
					parentName: "John Doe",
					parentEmail: "john@example.com",
					parentPhone: "555-123-4567",
					staffAccessConsent: true,
				}),
			).rejects.toThrow("Class does not belong to festival.");
		});
	});
});
