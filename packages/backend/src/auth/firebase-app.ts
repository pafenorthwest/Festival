import type { App } from "firebase-admin/app";
import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import type { AppEnv } from "../config/env.js";

/**
 * Returns the shared Firebase Admin app instance, initializing it on
 * first use. Shared between firebase-auth-verifier.ts (verifying
 * tokens) and custom-claims.ts (writing them), so both use the same
 * credentials and Firebase only ever initializes one default app.
 */
export function getFirebaseApp(env: AppEnv): App {
	if (getApps().length > 0) {
		return getApp();
	}

	if (env.firebaseClientEmail && env.firebasePrivateKey) {
		return initializeApp({
			credential: cert({
				projectId: env.firebaseProjectId,
				clientEmail: env.firebaseClientEmail,
				privateKey: env.firebasePrivateKey,
			}),
			projectId: env.firebaseProjectId,
		});
	}

	return initializeApp({
		projectId: env.firebaseProjectId,
	});
}
