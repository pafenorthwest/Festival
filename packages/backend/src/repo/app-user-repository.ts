import type {
	AppUserRecord,
	AuthenticatedUser,
	AuthLoginProvider,
} from "@festival/common";

export interface UpsertAppUserInput {
	firebaseUid: string;
	email: string;
	fullName?: string;
}

export interface InsertLoginEventInput {
	userId: string;
	firebaseUid: string;
	provider: AuthLoginProvider;
	ipAddress?: string;
	userAgent?: string;
}

export interface AppUserRepository {
	ensureReady(): Promise<void>;
	findAppUserByFirebaseUid(firebaseUid: string): Promise<AppUserRecord | null>;
	upsertAppUser(input: UpsertAppUserInput): Promise<AppUserRecord>;
	insertLoginEvent(input: InsertLoginEventInput): Promise<void>;
}

export function appUserInputFromIdentity(
	identity: AuthenticatedUser,
): UpsertAppUserInput {
	return {
		firebaseUid: identity.uid,
		email: identity.email,
		fullName: identity.displayName,
	};
}
