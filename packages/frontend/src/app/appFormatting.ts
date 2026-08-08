import type { AuthenticatedUser } from "@festival/common";
import type { User } from "firebase/auth";

export function toAuthenticatedUser(user: User): AuthenticatedUser {
	return {
		uid: user.uid,
		email: user.email ?? "",
		displayName: user.displayName ?? user.email ?? user.uid,
	};
}

export function formatDateOnly(value: string): string {
	const [year, month, day] = value.split("-");
	if (!year || !month || !day) {
		return value;
	}

	return `${month}/${day}/${year}`;
}

export function shortUserLabel(user: AuthenticatedUser | undefined): string {
	const label = user?.displayName || user?.email || "";
	return label.slice(0, 8);
}
