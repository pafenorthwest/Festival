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

const WEEKDAY_ABBREVIATIONS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatScheduleDate(value: string): string {
	const [yearText, monthText, dayText] = value.split("-");
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	if (!year || !month || !day) {
		return value;
	}

	const weekday =
		WEEKDAY_ABBREVIATIONS[new Date(year, month - 1, day).getDay()];
	const paddedMonth = String(month).padStart(2, "0");
	const paddedDay = String(day).padStart(2, "0");
	return `${weekday} ${paddedMonth}/${paddedDay}`;
}

export function shortUserLabel(user: AuthenticatedUser | undefined): string {
	const label = user?.displayName || user?.email || "";
	return label.slice(0, 8);
}
