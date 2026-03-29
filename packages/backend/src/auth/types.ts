import type { AuthenticatedUser } from "@festival/common";

export interface AuthVerifier {
	verify(token: string): Promise<AuthenticatedUser>;
}
