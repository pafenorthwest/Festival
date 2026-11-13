import { createContext, type ParentProps, useContext } from "solid-js";
import type { FestivalAppController } from "./useFestivalAppController.js";

const FestivalShellContext = createContext<FestivalAppController>();

export interface FestivalShellProviderProps extends ParentProps {
	value: FestivalAppController;
}

export function FestivalShellProvider(props: FestivalShellProviderProps) {
	return (
		<FestivalShellContext.Provider value={props.value}>
			{props.children}
		</FestivalShellContext.Provider>
	);
}

export function useOptionalFestivalShell(): FestivalAppController | undefined {
	return useContext(FestivalShellContext);
}

export function useFestivalShell(): FestivalAppController {
	const context = useContext(FestivalShellContext);
	if (!context) {
		throw new Error(
			"useFestivalShell must be used within a FestivalShellProvider.",
		);
	}
	return context;
}
