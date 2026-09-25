import { describe, expect, it } from "bun:test";
import {
	type CustomClaimsLock,
	type FirebaseAuthLike,
	FirebaseCustomClaimsWriter,
	NoopCustomClaimsWriter,
	type VolunteerIntentClaims,
} from "../src/auth/custom-claims.js";

class NoopCustomClaimsLock implements CustomClaimsLock {
	async withLock<T>(_: string, operation: () => Promise<T>): Promise<T> {
		return operation();
	}
}

class SerialCustomClaimsLock implements CustomClaimsLock {
	private readonly tails = new Map<string, Promise<void>>();

	async withLock<T>(uid: string, operation: () => Promise<T>): Promise<T> {
		const previous = this.tails.get(uid) ?? Promise.resolve();
		let release: () => void = () => {};
		const current = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.tails.set(
			uid,
			previous.then(() => current),
		);
		await previous;
		try {
			return await operation();
		} finally {
			release();
		}
	}
}

class FakeFirebaseAuth implements FirebaseAuthLike {
	protected claims: Record<string, VolunteerIntentClaims> = {};
	getUserCalls = 0;
	setCustomUserClaimsCalls = 0;

	seed(uid: string, claims: VolunteerIntentClaims) {
		this.claims[uid] = claims;
	}

	async getUser(uid: string) {
		this.getUserCalls += 1;
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

class FlakyFirebaseAuth extends FakeFirebaseAuth {
	constructor(private failuresRemaining: number) {
		super();
	}

	async setCustomUserClaims(uid: string, claims: object | null) {
		this.setCustomUserClaimsCalls += 1;
		if (this.failuresRemaining > 0) {
			this.failuresRemaining -= 1;
			throw new Error("Temporary Admin SDK failure");
		}
		this.claims[uid] = (claims ?? {}) as VolunteerIntentClaims;
	}
}

class CountingCustomClaimsLock implements CustomClaimsLock {
	calls = 0;

	async withLock<T>(_: string, operation: () => Promise<T>): Promise<T> {
		this.calls += 1;
		return operation();
	}
}

class TrackingCustomClaimsLock implements CustomClaimsLock {
	held = false;

	async withLock<T>(_: string, operation: () => Promise<T>): Promise<T> {
		this.held = true;
		try {
			return await operation();
		} finally {
			this.held = false;
		}
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

class AsyncSnapshotFirebaseAuth extends FakeFirebaseAuth {
	async getUser(uid: string) {
		const user = await super.getUser(uid);
		await Promise.resolve();
		return user;
	}
}

describe("FirebaseCustomClaimsWriter", () => {
	it("sets an org role on a user with no existing claims", async () => {
		const auth = new FakeFirebaseAuth();
		const writer = new FirebaseCustomClaimsWriter(
			auth,
			new NoopCustomClaimsLock(),
		);

		await writer.setOrgRole("uid-1", "org-a", "Admin");

		expect(auth.get("uid-1")).toEqual({ orgRoles: { "org-a": "Admin" } });
	});

	it("merges a new org role in without clobbering existing org roles", async () => {
		const auth = new FakeFirebaseAuth();
		auth.seed("uid-1", { orgRoles: { "org-a": "Admin" } });
		const writer = new FirebaseCustomClaimsWriter(
			auth,
			new NoopCustomClaimsLock(),
		);

		await writer.setOrgRole("uid-1", "org-b", "Division Chair");

		expect(auth.get("uid-1")).toEqual({
			orgRoles: { "org-a": "Admin", "org-b": "Division Chair" },
		});
	});

	it("overwrites the role for the same organization", async () => {
		const auth = new FakeFirebaseAuth();
		auth.seed("uid-1", { orgRoles: { "org-a": "Read Only" } });
		const writer = new FirebaseCustomClaimsWriter(
			auth,
			new NoopCustomClaimsLock(),
		);

		await writer.setOrgRole("uid-1", "org-a", "Admin");

		expect(auth.get("uid-1")).toEqual({ orgRoles: { "org-a": "Admin" } });
	});

	it("adds a volunteer festival without clobbering org roles or other festivals", async () => {
		const auth = new FakeFirebaseAuth();
		auth.seed("uid-1", {
			orgRoles: { "org-a": "Admin" },
			volunteerFestivals: { "org-a": ["festival-spring"] },
		});
		const writer = new FirebaseCustomClaimsWriter(
			auth,
			new NoopCustomClaimsLock(),
		);

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
		const writer = new FirebaseCustomClaimsWriter(
			auth,
			new NoopCustomClaimsLock(),
		);

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
		const writer = new FirebaseCustomClaimsWriter(
			auth,
			new NoopCustomClaimsLock(),
		);

		await writer.addVolunteerFestival("uid-1", "org-b", "festival-winter");

		expect(auth.get("uid-1")).toEqual({
			volunteerFestivals: {
				"org-a": ["festival-spring"],
				"org-b": ["festival-winter"],
			},
		});
	});

	it("never throws when the Admin SDK is unreachable", async () => {
		const writer = new FirebaseCustomClaimsWriter(
			new ThrowingFirebaseAuth(),
			new NoopCustomClaimsLock(),
		);

		await expect(
			writer.setOrgRole("uid-1", "org-a", "Admin"),
		).resolves.toBeUndefined();
		await expect(
			writer.addVolunteerFestival("uid-1", "org-a", "festival-spring"),
		).resolves.toBeUndefined();
	});

	it("retries failed writes with a fresh locked read", async () => {
		const auth = new FlakyFirebaseAuth(2);
		const lock = new CountingCustomClaimsLock();
		const writer = new FirebaseCustomClaimsWriter(auth, lock);

		await writer.setOrgRole("uid-1", "org-a", "Admin");

		expect(auth.getUserCalls).toBe(3);
		expect(auth.setCustomUserClaimsCalls).toBe(3);
		expect(lock.calls).toBe(3);
		expect(auth.get("uid-1")).toEqual({ orgRoles: { "org-a": "Admin" } });
	});

	it("serializes simultaneous updates for the same user", async () => {
		const auth = new AsyncSnapshotFirebaseAuth();
		const writer = new FirebaseCustomClaimsWriter(
			auth,
			new SerialCustomClaimsLock(),
		);

		await Promise.all([
			writer.setOrgRole("uid-1", "org-a", "Admin"),
			writer.addVolunteerFestival("uid-1", "org-a", "festival-spring"),
		]);

		expect(auth.get("uid-1")).toEqual({
			orgRoles: { "org-a": "Admin" },
			volunteerFestivals: { "org-a": ["festival-spring"] },
		});
	});

	it("replaces stale Festival-managed claims while preserving unrelated claims", async () => {
		const auth = new FakeFirebaseAuth();
		auth.seed("uid-1", {
			orgRoles: { "old-org": "Admin" },
			volunteerFestivals: { "old-org": ["old-festival"] },
			otherSystem: "retained",
		} as VolunteerIntentClaims);
		const writer = new FirebaseCustomClaimsWriter(
			auth,
			new NoopCustomClaimsLock(),
		);

		await writer.replaceVolunteerIntentClaims("uid-1", async () => ({
			orgRoles: { "current-org": "Read Only" },
		}));

		expect(auth.get("uid-1")).toEqual({
			otherSystem: "retained",
			orgRoles: { "current-org": "Read Only" },
		});
	});

	it("loads reconciliation claims after acquiring the UID lock", async () => {
		const auth = new FakeFirebaseAuth();
		const lock = new TrackingCustomClaimsLock();
		const writer = new FirebaseCustomClaimsWriter(auth, lock);

		await writer.replaceVolunteerIntentClaims("uid-1", async () => {
			expect(lock.held).toBe(true);
			return { orgRoles: { "current-org": "Admin" } };
		});

		expect(auth.get("uid-1")).toEqual({
			orgRoles: { "current-org": "Admin" },
		});
	});

	it("retries reconciliation writes and reports the final failure", async () => {
		const auth = new FlakyFirebaseAuth(3);
		const lock = new CountingCustomClaimsLock();
		const writer = new FirebaseCustomClaimsWriter(auth, lock);

		await expect(
			writer.replaceVolunteerIntentClaims("uid-1", async () => ({
				orgRoles: { "org-a": "Admin" },
			})),
		).rejects.toThrow("Temporary Admin SDK failure");
		expect(auth.getUserCalls).toBe(3);
		expect(auth.setCustomUserClaimsCalls).toBe(3);
		expect(lock.calls).toBe(3);
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
