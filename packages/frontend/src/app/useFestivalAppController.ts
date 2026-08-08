import { createFestivalActions } from "./createFestivalActions.js";
import { createFestivalAppState } from "./createFestivalAppState.js";
import { createFestivalDataLoaders } from "./createFestivalDataLoaders.js";
import { useFestivalLifecycle } from "./useFestivalLifecycle.js";

export function useFestivalAppController() {
	const state = createFestivalAppState();
	const loaders = createFestivalDataLoaders(state);
	const actions = createFestivalActions(state, loaders);

	useFestivalLifecycle(state, loaders);

	return {
		...state,
		...actions,
	};
}

export type FestivalAppController = ReturnType<typeof useFestivalAppController>;
