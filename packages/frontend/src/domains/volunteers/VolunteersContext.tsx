import type { FestivalSummary } from "@festival/common";
import {
	createContext,
	createEffect,
	createMemo,
	createSignal,
	type ParentProps,
	useContext,
} from "solid-js";
import { getIdToken } from "../../app/createFestivalDataLoaders.js";
import { useOptionalFestivalShell } from "../../app/FestivalShellContext.js";
import { getFestivals } from "../../lib/api.js";

const VOLUNTEER_ADMIN_ROLES = ["Admin", "Division Chair", "Concert Chair"];

export interface VolunteersProviderProps extends ParentProps {
	slug?: string;
}

function createVolunteersState(props: VolunteersProviderProps) {
	const shell = useOptionalFestivalShell();
	const [festivals, setFestivals] = createSignal<FestivalSummary[]>([]);

	// Volunteer administration follows the product's admin intent, which is
	// broader than the organization-wide Admin role used by other admin areas.
	const hasVolunteerAdminIntent = createMemo(() =>
		VOLUNTEER_ADMIN_ROLES.includes(shell?.sessionMembership()?.role ?? ""),
	);

	async function loadFestivals(slugOverride?: string) {
		const targetSlug = slugOverride ?? props.slug ?? shell?.slug ?? "";
		const token = await getIdToken(shell?.firebaseUser() ?? null);
		if (!token || !targetSlug) {
			return;
		}

		const response = await getFestivals(token, targetSlug);
		setFestivals(response.festivals);
	}

	createEffect(() => {
		const currentRoute = shell?.route();
		if (
			currentRoute?.kind === "org-admin-volunteers" &&
			hasVolunteerAdminIntent() &&
			shell?.firebaseUser()
		) {
			void loadFestivals(currentRoute.slug);
		}
	});

	return {
		hasVolunteerAdminIntent,
		festivals,
		setFestivals,
		loadFestivals,
	};
}

export type VolunteersContextValue = ReturnType<typeof createVolunteersState>;

const VolunteersContext = createContext<VolunteersContextValue>();

export function VolunteersProvider(props: VolunteersProviderProps) {
	const value = createVolunteersState(props);
	return (
		<VolunteersContext.Provider value={value}>
			{props.children}
		</VolunteersContext.Provider>
	);
}

export function useVolunteers(): VolunteersContextValue {
	const context = useContext(VolunteersContext);
	if (!context) {
		throw new Error("useVolunteers must be used within a VolunteersProvider.");
	}
	return context;
}
