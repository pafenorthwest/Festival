import {
	createContext,
	createMemo,
	type ParentProps,
	useContext,
} from "solid-js";
import type { SignInModalKind } from "../../app/appTypes.js";
import { useOptionalFestivalShell } from "../../app/FestivalShellContext.js";

export interface ClassRegistrationProviderProps extends ParentProps {
	slug?: string;
	festivalSlug?: string;
	isDropTransferEnabled?: boolean;
	openSignInModal?: (kind: SignInModalKind) => void;
}

function createClassRegistrationState(props: ClassRegistrationProviderProps) {
	const shell = useOptionalFestivalShell();

	const isDropTransferEnabled = createMemo(() => {
		if (typeof props.isDropTransferEnabled === "boolean") {
			return props.isDropTransferEnabled;
		}
		return shell?.isDropTransferEnabled() ?? false;
	});

	function openSignInModal(kind: SignInModalKind) {
		if (props.openSignInModal) {
			props.openSignInModal(kind);
			return;
		}
		shell?.openSignInModal(kind);
	}

	return {
		get slug() {
			return props.slug ?? shell?.slug ?? "";
		},
		get festivalSlug() {
			return props.festivalSlug ?? "";
		},
		isDropTransferEnabled,
		openSignInModal,
	};
}

export type ClassRegistrationContextValue = ReturnType<
	typeof createClassRegistrationState
>;

const ClassRegistrationContext = createContext<ClassRegistrationContextValue>();

export function ClassRegistrationProvider(
	props: ClassRegistrationProviderProps,
) {
	const value = createClassRegistrationState(props);
	return (
		<ClassRegistrationContext.Provider value={value}>
			{props.children}
		</ClassRegistrationContext.Provider>
	);
}

export function useClassRegistration(): ClassRegistrationContextValue {
	const context = useContext(ClassRegistrationContext);
	if (!context) {
		throw new Error(
			"useClassRegistration must be used within a ClassRegistrationProvider.",
		);
	}
	return context;
}
