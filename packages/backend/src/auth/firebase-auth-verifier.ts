import type { AuthenticatedUser } from "@festival/common";
import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { AppEnv } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import type { AuthVerifier } from "./types.js";

function getFirebaseApp(env: AppEnv) {
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

export function createFirebaseAuthVerifier(env: AppEnv): AuthVerifier {
	const app = getFirebaseApp(env);
	const auth = getAuth(app);

	return {
		async verify(token: string): Promise<AuthenticatedUser> {
			try {
				const decoded = await auth.verifyIdToken(token);
				const email = decoded.email?.trim().toLowerCase();
				if (!email) {
					throw new AppError(
						"Authenticated Firebase user is missing an email address.",
						401,
					);
				}

				return {
					uid: decoded.uid,
					email,
					displayName: decoded.name ?? email.split("@")[0] ?? decoded.uid,
				};
			} catch (error) {
				if (error instanceof AppError) {
					throw error;
				}

				throw new AppError(
					`Failed to verify Firebase ID token: ${(error as Error).message}`,
					401,
				);
			}
		},
	};
}
