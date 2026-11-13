import { getAuth } from "firebase-admin/auth";
import type { CreateAppOptions } from "../app.js";
import {
	type CustomClaimsWriter,
	FirebaseCustomClaimsWriter,
	NoopCustomClaimsWriter,
	PostgresCustomClaimsLock,
} from "../auth/custom-claims.js";
import { getFirebaseApp } from "../auth/firebase-app.js";
import { createFirebaseAuthVerifier } from "../auth/firebase-auth-verifier.js";
import {
	FirebaseClaimsReconciliationService as DefaultFirebaseClaimsReconciliationService,
	type FirebaseClaimsReconciliationService,
	PostgresFirebaseClaimsSource,
} from "../auth/firebase-claims-reconciliation.js";
import type { AuthVerifier } from "../auth/types.js";
import type { AppEnv } from "../config/env.js";

export interface AuthComposition {
	authVerifier: AuthVerifier;
	customClaimsWriter: CustomClaimsWriter;
	firebaseClaimsReconciliationService:
		| FirebaseClaimsReconciliationService
		| undefined;
}

function createCustomClaimsWriter(
	options: CreateAppOptions,
	env: AppEnv,
): CustomClaimsWriter {
	// Firebase custom claims can only be written with service-account
	// credentials (firebaseClientEmail + firebasePrivateKey). Without
	// them, fall back to a no-op writer rather than fail startup or
	// throw on every write in local dev / tests.
	return (
		options.customClaimsWriter ??
		(env.firebaseClientEmail && env.firebasePrivateKey
			? new FirebaseCustomClaimsWriter(
					getAuth(getFirebaseApp(env)),
					new PostgresCustomClaimsLock(),
				)
			: new NoopCustomClaimsWriter())
	);
}

function createClaimsReconciliationService(
	options: CreateAppOptions,
	env: AppEnv,
): FirebaseClaimsReconciliationService | undefined {
	return (
		options.firebaseClaimsReconciliationService ??
		(env.databaseSchema && env.firebaseClientEmail && env.firebasePrivateKey
			? new DefaultFirebaseClaimsReconciliationService(
					new PostgresFirebaseClaimsSource(env.databaseSchema),
					new FirebaseCustomClaimsWriter(
						getAuth(getFirebaseApp(env)),
						new PostgresCustomClaimsLock(),
					),
				)
			: undefined)
	);
}

export function createAuthComposition(
	options: CreateAppOptions,
	env: AppEnv,
): AuthComposition {
	const authVerifier =
		options.authVerifier ??
		createFirebaseAuthVerifier(
			env as Required<Pick<AppEnv, "firebaseProjectId">> & AppEnv,
		);
	return {
		authVerifier,
		customClaimsWriter: createCustomClaimsWriter(options, env),
		firebaseClaimsReconciliationService: createClaimsReconciliationService(
			options,
			env,
		),
	};
}
