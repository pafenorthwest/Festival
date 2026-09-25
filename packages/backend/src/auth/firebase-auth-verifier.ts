import type { AuthenticatedUser } from "@festival/common";
import { getAuth } from "firebase-admin/auth";
import type { AppEnv } from "../config/env.js";
import { AppError } from "../errors/app-error.js";
import { getFirebaseApp } from "./firebase-app.js";
import type { AuthVerifier } from "./types.js";

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

				throw new AppError("Firebase authentication failed.", 401);
			}
		},
	};
}
