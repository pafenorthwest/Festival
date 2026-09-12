export type AccompanistMembershipSource = "accompanist_form";
export type AccompanistMembershipGrantStatus =
	| "active"
	| "superseded"
	| "expired";

export interface AccompanistContactSnapshot {
	name: string;
	email: string;
	city: string;
	phone: string;
}

export interface AccompanistDivisionSnapshot {
	divisionId: string;
	divisionName: string;
}

export interface AccompanistMembershipGrant {
	id: string;
	organizationId: string;
	customerId: string;
	normalizedEmail: string;
	offeringId: string;
	offeringNameSnapshot: string;
	source: AccompanistMembershipSource;
	contact: AccompanistContactSnapshot;
	divisions: AccompanistDivisionSnapshot[];
	startsOn: string;
	endsOn: string;
	status: AccompanistMembershipGrantStatus;
	isCurrent: boolean;
	createdAtIso: string;
}

export function validateAccompanistContact(
	input: unknown,
): AccompanistContactSnapshot {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new Error("Accompanist contact is invalid.");
	}
	const value = input as Record<string, unknown>;
	const text = (field: "name" | "email" | "city" | "phone") => {
		const raw = value[field];
		if (typeof raw !== "string" || !raw.trim() || raw.trim().length > 255) {
			throw new Error(`Accompanist ${field} is required.`);
		}
		return raw.trim();
	};
	const email = text("email").toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new Error("Accompanist email is invalid.");
	}
	return {
		name: text("name"),
		email,
		city: text("city"),
		phone: text("phone"),
	};
}
