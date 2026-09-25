import { describe, expect, it } from "bun:test";
import type { VolunteerIntentClaims } from "../src/auth/custom-claims.js";
import {
	FirebaseClaimsReconciliationService,
	type FirebaseClaimsReconciliationWriter,
	type FirebaseClaimsSource,
} from "../src/auth/firebase-claims-reconciliation.js";

class Source implements FirebaseClaimsSource {
	constructor(
		private readonly claimsByUid: Map<string, VolunteerIntentClaims>,
	) {}

	async listUids() {
		return [...this.claimsByUid.keys()];
	}

	async loadClaims(uid: string) {
		return this.claimsByUid.get(uid) ?? {};
	}
}

class Writer implements FirebaseClaimsReconciliationWriter {
	calls: Array<{ uid: string; claims: VolunteerIntentClaims }> = [];

	constructor(private readonly rejectedUids = new Set<string>()) {}

	async replaceVolunteerIntentClaims(
		uid: string,
		loadClaims: () => Promise<VolunteerIntentClaims>,
	) {
		const claims = await loadClaims();
		this.calls.push({ uid, claims });
		if (this.rejectedUids.has(uid)) throw new Error("Firebase unavailable");
	}
}

describe("FirebaseClaimsReconciliationService", () => {
	it("rebuilds every discovered user's managed claims", async () => {
		const writer = new Writer();
		const service = new FirebaseClaimsReconciliationService(
			new Source(
				new Map([
					[
						"uid-a",
						{
							orgRoles: { "org-a": "Admin" },
							volunteerFestivals: { "org-a": ["festival-a"] },
						},
					],
					["uid-b", {}],
				]),
			),
			writer,
		);

		expect(await service.reconcile()).toEqual({
			discoveredCount: 2,
			processedCount: 2,
			failedCount: 0,
		});
		expect(writer.calls).toHaveLength(2);
	});

	it("continues after a failed user and returns an actionable count", async () => {
		const writer = new Writer(new Set(["uid-a"]));
		const service = new FirebaseClaimsReconciliationService(
			new Source(
				new Map([
					["uid-a", {}],
					["uid-b", {}],
				]),
			),
			writer,
		);

		expect(await service.reconcile()).toEqual({
			discoveredCount: 2,
			processedCount: 1,
			failedCount: 1,
		});
		expect(writer.calls).toHaveLength(2);
	});
});
