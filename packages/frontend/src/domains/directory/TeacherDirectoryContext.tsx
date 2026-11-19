import type { MembershipProductSummary } from "@festival/common";
import { validateMembershipProductInput } from "@festival/common";
import type { User } from "firebase/auth";
import {
	createContext,
	createEffect,
	createMemo,
	createSignal,
	type ParentProps,
	useContext,
} from "solid-js";
import type { MembershipProductDraft } from "../../app/appTypes.js";
import { getIdToken } from "../../app/createFestivalDataLoaders.js";
import { useOptionalFestivalShell } from "../../app/FestivalShellContext.js";
import {
	createMembershipProduct,
	getAdminMembershipProducts,
} from "../../lib/api.js";

const EMPTY_MEMBERSHIP_PRODUCT_DRAFT: MembershipProductDraft = {
	name: "",
	description: "",
	price: "",
};

export interface TeacherDirectoryProviderProps extends ParentProps {
	slug?: string;
	shopifyPrerequisiteMet?: () => boolean;
}

export interface MembershipProductsLoaderDeps {
	getFirebaseUser: () => User | null;
	getSlug: () => string;
	setIsLoadingMembershipProducts: (value: boolean) => void;
	setMembershipProducts: (value: MembershipProductSummary[]) => void;
	setMembershipProductsLoadError: (value: string) => void;
}

export function createMembershipProductsLoader(
	deps: MembershipProductsLoaderDeps,
) {
	return async function loadMembershipProducts(slugOverride?: string) {
		const targetSlug = slugOverride ?? deps.getSlug();
		const token = await getIdToken(deps.getFirebaseUser());
		if (!token || !targetSlug) {
			return;
		}

		deps.setIsLoadingMembershipProducts(true);
		deps.setMembershipProducts([]);
		deps.setMembershipProductsLoadError("");

		try {
			const response = await getAdminMembershipProducts(token, targetSlug);
			deps.setMembershipProducts(response.membershipProducts);
		} catch {
			deps.setMembershipProductsLoadError(
				"Membership products are temporarily unavailable. Please try again.",
			);
		} finally {
			deps.setIsLoadingMembershipProducts(false);
		}
	};
}

function createTeacherDirectoryState(props: TeacherDirectoryProviderProps) {
	const shell = useOptionalFestivalShell();
	const [membershipProducts, setMembershipProducts] = createSignal<
		MembershipProductSummary[]
	>([]);
	const [isLoadingMembershipProducts, setIsLoadingMembershipProducts] =
		createSignal(false);
	const [membershipProductsLoadError, setMembershipProductsLoadError] =
		createSignal("");
	const [membershipProductDraft, setMembershipProductDraft] =
		createSignal<MembershipProductDraft>({ ...EMPTY_MEMBERSHIP_PRODUCT_DRAFT });
	const [
		createMembershipProductAttempted,
		setCreateMembershipProductAttempted,
	] = createSignal(false);
	const [isCreatingMembershipProduct, setIsCreatingMembershipProduct] =
		createSignal(false);

	const membershipProductValidation = createMemo(() =>
		validateMembershipProductInput(membershipProductDraft()),
	);
	const shouldShowMembershipProductValidation = createMemo(() =>
		createMembershipProductAttempted(),
	);
	const membershipProductValidationMessage = createMemo(() =>
		membershipProductValidation().errors.join(" "),
	);

	const loadMembershipProducts = createMembershipProductsLoader({
		getFirebaseUser: () => shell?.firebaseUser() ?? null,
		getSlug: () => props.slug ?? shell?.slug ?? "",
		setIsLoadingMembershipProducts,
		setMembershipProducts,
		setMembershipProductsLoadError,
	});

	async function handleCreateMembershipProduct() {
		const user = shell?.firebaseUser() ?? null;
		const currentRoute = shell?.route();
		if (
			!user ||
			(currentRoute && currentRoute.kind !== "org-admin-memberships")
		) {
			return;
		}

		const targetSlug = props.slug ?? shell?.slug ?? "";
		if (!targetSlug) {
			return;
		}

		setCreateMembershipProductAttempted(true);
		const validation = membershipProductValidation();
		if (!validation.valid) {
			shell?.setStatusMessage("");
			return;
		}

		const isShopifyReady = props.shopifyPrerequisiteMet?.() ?? false;
		if (!isShopifyReady) {
			shell?.setErrorMessage(
				"Verified Shopify integration is required before creating memberships.",
			);
			return;
		}

		setIsCreatingMembershipProduct(true);
		shell?.clearMessages();
		try {
			const token = await user.getIdToken();
			await createMembershipProduct(token, targetSlug, validation.input);
			setMembershipProductDraft({ ...EMPTY_MEMBERSHIP_PRODUCT_DRAFT });
			setCreateMembershipProductAttempted(false);
			await loadMembershipProducts(targetSlug);
			shell?.setStatusMessage("Membership product created.");
		} catch (error) {
			shell?.setErrorMessage((error as Error).message);
		} finally {
			setIsCreatingMembershipProduct(false);
		}
	}

	createEffect(() => {
		const currentRoute = shell?.route();
		if (
			currentRoute?.kind === "org-admin-memberships" &&
			shell?.isAdminMember() &&
			shell?.firebaseUser()
		) {
			void loadMembershipProducts(currentRoute.slug);
		}
	});

	return {
		membershipProducts,
		setMembershipProducts,
		isLoadingMembershipProducts,
		setIsLoadingMembershipProducts,
		membershipProductsLoadError,
		setMembershipProductsLoadError,
		loadMembershipProducts,
		membershipProductDraft,
		setMembershipProductDraft,
		createMembershipProductAttempted,
		setCreateMembershipProductAttempted,
		isCreatingMembershipProduct,
		setIsCreatingMembershipProduct,
		membershipProductValidation,
		shouldShowMembershipProductValidation,
		membershipProductValidationMessage,
		handleCreateMembershipProduct,
	};
}

export type TeacherDirectoryContextValue = ReturnType<
	typeof createTeacherDirectoryState
>;

const TeacherDirectoryContext = createContext<TeacherDirectoryContextValue>();

export function TeacherDirectoryProvider(props: TeacherDirectoryProviderProps) {
	const value = createTeacherDirectoryState(props);
	return (
		<TeacherDirectoryContext.Provider value={value}>
			{props.children}
		</TeacherDirectoryContext.Provider>
	);
}

export function useOptionalTeacherDirectory():
	| TeacherDirectoryContextValue
	| undefined {
	return useContext(TeacherDirectoryContext);
}

export function useTeacherDirectory(): TeacherDirectoryContextValue {
	const context = useContext(TeacherDirectoryContext);
	if (!context) {
		throw new Error(
			"useTeacherDirectory must be used within a TeacherDirectoryProvider.",
		);
	}
	return context;
}
