import { describe, expect, it } from "bun:test";
import { CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION } from "@festival/common";
import { CUSTOMER_SESSION_COOKIE } from "../src/customer/customer-account-service.js";
import { ParticipantProfileService } from "../src/services/participant-profile-service.js";
import { setupTestApp } from "./participant-profile-test-harness.js";

const nowIso = "2026-10-25T12:00:00.000Z";
const phone = "+1 206 555 0199";
const email = "verified-membership@example.com";
const postalCode = "98109";
type Role = "teacher" | "accompanist";

async function fixture(role: Role) {
	const f = await setupTestApp();
	const createCustomer = (organizationId: string, sessionId: string) =>
		f.customerRepository.createCustomerSession({
			organizationId,
			sessionId,
			shopifyCustomerGid: "gid://shopify/Customer/admin-consent-test",
			encryptedTokens: "unused-test-tokens",
			csrfToken: "csrf-token-1",
			integrationVersion: 1,
			createdAtIso: nowIso,
			lastSeenAtIso: nowIso,
			expiresAtIso: "2026-11-01T12:00:00.000Z",
		});
	const { customer } = await createCustomer(f.orgA.id, "real-customer-session");
	await f.customerRepository.applyCustomerProfile({
		organizationId: f.orgA.id,
		customerId: customer.id,
		source: "festival",
		updatedAtIso: nowIso,
		profile: {
			email: "festival-edited@example.com",
			phone,
			mailingAddress: {
				line1: "1 Private Street",
				city: "Seattle",
				region: "WA",
				postalCode,
				countryCode: "US",
			},
		},
	});
	f.customerAccountService.sessions.set("sess-cust-1", {
		organizationId: f.orgA.id,
		customerId: customer.id,
		csrfToken: "csrf-token-1",
	});
	f.repository.setCustomerContact(f.orgA.id, {
		customerId: customer.id,
		email: "festival-edited@example.com",
		phone,
	});
	await f.repository.createAccompanistMembershipGrant({
		organizationId: f.orgA.id,
		customerId: customer.id,
		normalizedEmail: email,
		offeringNameSnapshot: "Legacy Accompanist Membership",
		source: "accompanist_form",
		contact: {
			name: "Legacy Member",
			email,
			phone: "old-phone",
			city: "Seattle",
		},
		divisions: [{ divisionId: f.divA1.id, divisionName: f.divA1.displayName }],
		startsOn: "2026-01-01",
		endsOn: "2027-01-01",
	});
	const input = {
		organizationId: f.orgA.id,
		customerId: customer.id,
		displayName: "Private Member",
		publicDirectoryOptIn: false,
		divisionIds: [f.divA1.id],
	};
	const created =
		role === "teacher"
			? await f.repository.upsertTeacherProfile(input)
			: await f.repository.upsertAccompanistProfile(input);

	// In-memory profiles omit the postal-code join supplied by PostgreSQL.
	if (role === "teacher") {
		const list = f.repository.listTeacherProfiles.bind(f.repository);
		const update = f.repository.updateTeacherProfileApproval.bind(f.repository);
		const get = f.repository.getTeacherProfile.bind(f.repository);
		f.repository.listTeacherProfiles = async (...args) =>
			(await list(...args)).map((p) => ({ ...p, zip_code: postalCode }));
		f.repository.updateTeacherProfileApproval = async (...args) => {
			const p = await update(...args);
			return p && { ...p, zip_code: postalCode };
		};
		f.repository.getTeacherProfile = async (...args) => {
			const p = await get(...args);
			return p && { ...p, zip_code: postalCode };
		};
	} else {
		const list = f.repository.listAccompanistProfiles.bind(f.repository);
		const update = f.repository.updateAccompanistProfileApproval.bind(
			f.repository,
		);
		const get = f.repository.getAccompanistProfile.bind(f.repository);
		f.repository.listAccompanistProfiles = async (...args) =>
			(await list(...args)).map((p) => ({ ...p, zip_code: postalCode }));
		f.repository.updateAccompanistProfileApproval = async (...args) => {
			const p = await update(...args);
			return p && { ...p, zip_code: postalCode };
		};
		f.repository.getAccompanistProfile = async (...args) => {
			const p = await get(...args);
			return p && { ...p, zip_code: postalCode };
		};
	}
	const consent = (version = CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION) =>
		f.customerRepository.recordStaffAccessConsent({
			organizationId: f.orgA.id,
			customerId: customer.id,
			privacyNoticeVersion: version,
			consentedAtIso: nowIso,
		});
	const adminList = () =>
		f.app.request(`/api/admin/orgs/org-a/profiles/${role}s`, {
			headers: { Authorization: "Bearer admin-org-a" },
		});
	const adminApprove = () =>
		f.app.request(
			`/api/admin/orgs/org-a/profiles/${role}s/${created.id}/approval`,
			{
				method: "PATCH",
				headers: {
					Authorization: "Bearer admin-org-a",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ approvalStatus: "approved" }),
			},
		);
	return {
		...f,
		customer,
		created,
		createCustomer,
		consent,
		adminList,
		adminApprove,
	};
}

function expectRedacted(profile: Record<string, unknown>) {
	for (const field of ["phone", "email", "zip_code"]) {
		expect(profile).not.toHaveProperty(field);
	}
}

describe("Admin profile moderation consent and audit", () => {
	for (const role of ["teacher", "accompanist"] as const) {
		for (const consentState of [
			"absent",
			"outdated",
			"other organization",
		] as const) {
			it(`retains ${role} moderation with redacted contacts when consent is ${consentState}`, async () => {
				const f = await fixture(role);
				if (consentState === "outdated")
					await f.consent("obsolete-notice-version");
				if (consentState === "other organization") {
					const { customer } = await f.createCustomer(
						f.orgB.id,
						"other-org-session",
					);
					await f.customerRepository.recordStaffAccessConsent({
						organizationId: f.orgB.id,
						customerId: customer.id,
						privacyNoticeVersion: CUSTOMER_STAFF_ACCESS_PRIVACY_NOTICE_VERSION,
						consentedAtIso: nowIso,
					});
				}
				const listResponse = await f.adminList();
				expect(listResponse.status).toBe(200);
				const list = await listResponse.json();
				expect(list).toHaveLength(1);
				expect(list[0]).toMatchObject({
					id: f.created.id,
					display_name: "Private Member",
				});
				expectRedacted(list[0]);
				const approval = await f.adminApprove();
				expect(approval.status).toBe(200);
				const approved = await approval.json();
				expect(approved.approval_status).toBe("approved");
				expectRedacted(approved);
				expect(f.customerRepository.profileAccessAudits).toEqual([]);
				const own = await f.app.request(
					`/api/customer/orgs/org-a/profiles/${role}`,
					{
						headers: { Cookie: `${CUSTOMER_SESSION_COOKIE}=sess-cust-1` },
					},
				);
				expect(own.status).toBe(200);
				const self = await own.json();
				expect(self.zip_code).toBe(postalCode);
				if (role === "accompanist")
					expect(self).toMatchObject({ phone, email });
			});
		}

		it(`preserves consented ${role} repository projections and audits the verified actor`, async () => {
			const f = await fixture(role);
			await f.consent();
			const list = await f.adminList();
			expect(list.status).toBe(200);
			const profiles = await list.json();
			expect(profiles[0].zip_code).toBe(postalCode);
			const approval = await f.adminApprove();
			expect(approval.status).toBe(200);
			const approved = await approval.json();
			expect(approved.zip_code).toBe(postalCode);
			if (role === "accompanist") {
				expect(profiles[0]).toMatchObject({ phone, email });
				expect(approved).toMatchObject({ phone, email });
			}
			expect(f.customerRepository.profileAccessAudits).toEqual(
				[0, 1].map(() => ({
					organizationId: f.orgA.id,
					actorUid: "uid-admin-a",
					action: "view",
					targetCustomerId: f.customer.id,
					occurredAtIso: nowIso,
				})),
			);
		});

		for (const failure of ["read", "audit"] as const) {
			it(`fails closed for ${role} list and approval when the consented ${failure} fails`, async () => {
				const f = await fixture(role);
				await f.consent();
				const fail = async () => {
					throw new Error("private database failure");
				};
				if (failure === "read")
					f.customerRepository.getConsentedCustomer = fail;
				else f.customerRepository.recordCustomerProfileAccessAudit = fail;
				for (const response of [await f.adminList(), await f.adminApprove()]) {
					expect(response.status).toBe(500);
					const body = await response.text();
					for (const secret of [
						phone,
						email,
						postalCode,
						"private database failure",
					]) {
						expect(body).not.toContain(secret);
					}
				}
			});
		}

		it(`redacts ${role} list and approval when CustomerAccountService is unavailable`, async () => {
			const f = await fixture(role);
			await f.consent();
			const service = new ParticipantProfileService(f.repository);
			const profiles =
				role === "teacher"
					? await service.listTeacherProfiles(f.orgA.id, "uid-admin-a")
					: await service.listAccompanistProfiles(f.orgA.id, "uid-admin-a");
			expect(profiles).toHaveLength(1);
			expectRedacted(profiles[0]);
			const approval =
				role === "teacher"
					? await service.updateTeacherProfileApproval(
							f.orgA.id,
							f.created.id,
							{ approvalStatus: "approved" },
							"uid-admin-a",
						)
					: await service.updateAccompanistProfileApproval(
							f.orgA.id,
							f.created.id,
							{ approvalStatus: "approved" },
							"uid-admin-a",
						);
			expect(approval.approval_status).toBe("approved");
			expectRedacted(approval);
			expect(f.customerRepository.profileAccessAudits).toEqual([]);
		});
	}
});
