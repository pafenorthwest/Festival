import { describe, expect, it } from "bun:test";
import {
	type FirebaseAuthLike,
	FirebaseCustomClaimsWriter,
	NoopCustomClaimsWriter,
	type VolunteerIntentClaims,
} from "../src/auth/custom-claims.js";

class FakeFirebaseAuth implements FirebaseAuthLike {
	private claims: Record<string, VolunteerIntentClaims> = {};
	setCustomUserClaimsCalls = 0;

	seed(uid: string, claims: VolunteerIntentClaims) {
		this.claims[uid] = claims;
	}

	async getUser(uid: string) {
		return { customClaims: this.claims[uid] };
	}

	async setCustomUserClaims(uid: string, claims: object | null) {
		this.setCustomUserClaimsCalls += 1;
		this.claims[uid] = (claims ?? {}) as VolunteerIntentClaims;
	}

	get(uid: string): VolunteerIntentClaims | undefined {
		return this.claims[uid];
	}
}

class ThrowingFirebaseAuth implements FirebaseAuthLike {
	async getUser(): Promise<never> {
		throw new Error("Admin SDK unreachable");
	}
	async setCustomUserClaims(): Promise<never> {
		throw new Error("Admin SDK unreachable");
	}
}

describe("FirebaseCustomClaimsWriter", () => {
	it("sets an org role on a user with no existing claims", async () => {
		const auth = new FakeFirebaseAuth();
		const writer = new FirebaseCustomClaimsWriter(auth);

		await writer.setOrgRole("uid-1", "org-a", "Admin");

		expect(auth.get("uid-1")).toEqual({ orgRoles: { "org-a": "Admin" } });
	});

	it("merges a new org role in without clobbering existing org roles", async () => {
		const auth = new FakeFirebaseAuth();
		auth.seed("uid-1", { orgRoles: { "org-a": "Admin" } });
		const writer = new FirebaseCustomClaimsWriter(auth);

		await writer.setOrgRole("uid-1", "org-b", "Division Chair");

		expect(auth.get("uid-1")).toEqual({
			orgRoles: { "org-a": "Admin", "org-b": "Division Chair" },
		});
	});

	it("overwrites the role for the same organization", async () => {
		const auth = new FakeFirebaseAuth();
		auth.seed("uid-1", { orgRoles: { "org-a": "Read Only" } });
		const writer = new FirebaseCustomClaimsWriter(auth);

		await writer.setOrgRole("uid-1", "org-a", "Admin");

		expect(auth.get("uid-1")).toEqual({ orgRoles: { "org-a": "Admin" } });
	});

	it("adds a volunteer festival without clobbering org roles or other festivals", async () => {
		const auth = new FakeFirebaseAuth();
		auth.seed("uid-1", {
			orgRoles: { "org-a": "Admin" },
			volunteerFestivals: { "org-a": ["festival-spring"] },
		});
		const writer = new FirebaseCustomClaimsWriter(auth);

		await writer.addVolunteerFestival("uid-1", "org-a", "festival-fall");

		expect(auth.get("uid-1")).toEqual({
			orgRoles: { "org-a": "Admin" },
			volunteerFestivals: {
				"org-a": ["festival-spring", "festival-fall"],
			},
		});
	});

	it("does not duplicate a festival already on the claim", async () => {
		const auth = new FakeFirebaseAuth();
		auth.seed("uid-1", {
			volunteerFestivals: { "org-a": ["festival-spring"] },
		});
		const writer = new FirebaseCustomClaimsWriter(auth);

		await writer.addVolunteerFestival("uid-1", "org-a", "festival-spring");

		expect(auth.get("uid-1")).toEqual({
			volunteerFestivals: { "org-a": ["festival-spring"] },
		});
		expect(auth.setCustomUserClaimsCalls).toBe(1);
	});

	it("keeps volunteer festivals for other organizations separate", async () => {
		const auth = new FakeFirebaseAuth();
		auth.seed("uid-1", {
			volunteerFestivals: { "org-a": ["festival-spring"] },
		});
		const writer = new FirebaseCustomClaimsWriter(auth);

		await writer.addVolunteerFestival("uid-1", "org-b", "festival-winter");

		expect(auth.get("uid-1")).toEqual({
			volunteerFestivals: {
				"org-a": ["festival-spring"],
				"org-b": ["festival-winter"],
			},
		});
	});

	it("never throws when the Admin SDK is unreachable", async () => {
		const writer = new FirebaseCustomClaimsWriter(new ThrowingFirebaseAuth());

		await expect(
			writer.setOrgRole("uid-1", "org-a", "Admin"),
		).resolves.toBeUndefined();
		await expect(
			writer.addVolunteerFestival("uid-1", "org-a", "festival-spring"),
		).resolves.toBeUndefined();
	});
});

describe("NoopCustomClaimsWriter", () => {
	it("never throws and does nothing", async () => {
		const writer = new NoopCustomClaimsWriter();

		await expect(
			writer.setOrgRole("uid-1", "org-a", "Admin"),
		).resolves.toBeUndefined();
		await expect(
			writer.addVolunteerFestival("uid-1", "org-a", "festival-spring"),
		).resolves.toBeUndefined();
	});
});
