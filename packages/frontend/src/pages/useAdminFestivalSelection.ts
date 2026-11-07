import type { FestivalSummary } from "@festival/common";
import { type Accessor, createMemo, createSignal, onCleanup } from "solid-js";
import { subscribeToAuthChanges } from "../lib/firebase-auth.js";

export function useAdminFestivalSelection(
	festivals: Accessor<FestivalSummary[]>,
) {
	const [idToken, setIdToken] = createSignal<string | null>(null);
	const [selectedFestivalShortName, setSelectedFestivalShortName] =
		createSignal("");
	const selectedFestival = createMemo(() => {
		const available = festivals();
		return (
			available.find(
				(festival) => festival.shortName === selectedFestivalShortName(),
			) ??
			available.find((festival) => festival.isPrimary) ??
			available[0]
		);
	});

	const unsubscribe = subscribeToAuthChanges(async (user) => {
		setIdToken(user ? await user.getIdToken() : null);
	});
	onCleanup(unsubscribe);

	return { idToken, selectedFestival, setSelectedFestivalShortName };
}
