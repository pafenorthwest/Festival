import type { ShopifyIntegrationSettings } from "@festival/common";
import {
	createContext,
	createEffect,
	createMemo,
	createSignal,
	type ParentProps,
	useContext,
} from "solid-js";
import type { ShopifyDraft } from "../../app/appTypes.js";
import { getIdToken } from "../../app/createFestivalDataLoaders.js";
import { useOptionalFestivalShell } from "../../app/FestivalShellContext.js";
import { getShopifySettings, saveShopifySettings } from "../../lib/api.js";

const EMPTY_SHOPIFY_DRAFT: ShopifyDraft = {
	storeUrl: "",
	clientId: "",
	clientSecret: "",
	storefrontPrivateToken: "",
};

export interface AdminCommerceProviderProps extends ParentProps {
	slug?: string;
}

function createAdminCommerceState(props: AdminCommerceProviderProps) {
	const shell = useOptionalFestivalShell();
	const [shopifySettings, setShopifySettings] =
		createSignal<ShopifyIntegrationSettings | null>(null);
	const [shopifyDraft, setShopifyDraft] = createSignal<ShopifyDraft>({
		...EMPTY_SHOPIFY_DRAFT,
	});
	const [isShopifyTesting, setIsShopifyTesting] = createSignal(false);

	const shopifyPrerequisiteMet = createMemo(() => {
		const settings = shopifySettings();
		return (
			settings?.verificationStatus === "ok" &&
			settings.capabilities.read_products === "granted" &&
			settings.capabilities.write_products === "granted" &&
			settings.capabilities.write_inventory === "granted"
		);
	});

	async function loadShopifySettings(slugOverride?: string) {
		const targetSlug = slugOverride ?? props.slug ?? shell?.slug ?? "";
		const token = await getIdToken(shell?.firebaseUser() ?? null);
		if (!token || !targetSlug) {
			return;
		}

		const response = await getShopifySettings(token, targetSlug);
		setShopifySettings(response.settings);
		setShopifyDraft({
			storeUrl: response.settings?.storeDomain ?? "",
			clientId: response.settings?.clientId ?? "",
			clientSecret: "",
			storefrontPrivateToken: "",
		});
	}

	async function handleSaveShopifySettings() {
		const user = shell?.firebaseUser() ?? null;
		const currentRoute = shell?.route();
		if (
			!user ||
			(currentRoute && currentRoute.kind !== "org-admin-integrations")
		) {
			return;
		}

		const targetSlug = props.slug ?? shell?.slug ?? "";
		if (!targetSlug) {
			return;
		}

		setIsShopifyTesting(true);
		shell?.clearMessages();
		try {
			const token = await user.getIdToken();
			const draft = shopifyDraft();
			const response = await saveShopifySettings(token, targetSlug, {
				storeUrl: draft.storeUrl,
				clientId: draft.clientId,
				clientSecret: draft.clientSecret,
				storefrontPrivateToken: draft.storefrontPrivateToken,
			});
			setShopifySettings(response.settings);
			setShopifyDraft({
				storeUrl: response.settings.storeDomain,
				clientId: response.settings.clientId,
				clientSecret: "",
				storefrontPrivateToken: "",
			});
			shell?.setStatusMessage(
				response.settings.verificationStatus === "ok"
					? response.ordersPaidWebhook.status === "ready"
						? "Shopify credentials and paid-order webhook are ready."
						: "Shopify credentials are verified; the paid-order webhook needs attention."
					: "Shopify credentials saved, but verification failed.",
			);
		} catch (error) {
			shell?.setErrorMessage((error as Error).message);
		} finally {
			setIsShopifyTesting(false);
		}
	}

	createEffect(() => {
		const currentRoute = shell?.route();
		if (
			(currentRoute?.kind === "org-admin-integrations" ||
				currentRoute?.kind === "org-admin-memberships") &&
			shell?.isAdminMember() &&
			shell?.firebaseUser()
		) {
			void loadShopifySettings(currentRoute.slug).catch((error) => {
				shell?.setErrorMessage((error as Error).message);
			});
		}
	});

	return {
		shopifySettings,
		setShopifySettings,
		loadShopifySettings,
		shopifyDraft,
		setShopifyDraft,
		isShopifyTesting,
		setIsShopifyTesting,
		shopifyPrerequisiteMet,
		handleSaveShopifySettings,
	};
}

export type AdminCommerceContextValue = ReturnType<
	typeof createAdminCommerceState
>;

const AdminCommerceContext = createContext<AdminCommerceContextValue>();

export function AdminCommerceProvider(props: AdminCommerceProviderProps) {
	const value = createAdminCommerceState(props);
	return (
		<AdminCommerceContext.Provider value={value}>
			{props.children}
		</AdminCommerceContext.Provider>
	);
}

export function useAdminCommerce(): AdminCommerceContextValue {
	const context = useContext(AdminCommerceContext);
	if (!context) {
		throw new Error(
			"useAdminCommerce must be used within an AdminCommerceProvider.",
		);
	}
	return context;
}
