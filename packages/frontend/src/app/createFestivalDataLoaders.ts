import type { SessionResponse } from "@festival/common";
import type { User } from "firebase/auth";
import {
	getAdminDivisions,
	getAdminMembershipProducts,
	getAdminTimezone,
	getAdminUsers,
	getBootstrap,
	getFestivals,
	getFirebaseSession,
	getInvite,
	getMemberships,
	getOrganization,
	getShopifySettings,
} from "../lib/api.js";
import { buildOrgPath } from "../lib/routes.js";
import type { FestivalAppState } from "./createFestivalAppState.js";

export async function getIdToken(user: User | null): Promise<string | null> {
	return user ? user.getIdToken() : null;
}

export function createFestivalDataLoaders(state: FestivalAppState) {
	let divisionConfigurationLoadVersion = 0;

	function isCurrentDivisionConfigurationLoad(
		loadVersion: number,
		slug: string,
	): boolean {
		const currentRoute = state.route();
		return (
			loadVersion === divisionConfigurationLoadVersion &&
			currentRoute.kind === "org-admin-divisions" &&
			currentRoute.slug === slug
		);
	}

	async function refreshSession(
		userOverride: User | null = state.firebaseUser(),
	) {
		const token = await getIdToken(userOverride);
		const response = token
			? await getFirebaseSession(token)
			: await getBootstrap();
		state.setSession(response.session);

		if (!token) {
			state.setMemberships([]);
			return response.session;
		}

		const membershipResponse = await getMemberships(token);
		state.setMemberships(membershipResponse.memberships);
		return response.session;
	}

	async function routeAfterSession(
		nextSession: SessionResponse["session"],
		userOverride: User | null = state.firebaseUser(),
	) {
		const token = await getIdToken(userOverride);
		if (!token) {
			return;
		}

		const membershipResponse = await getMemberships(token);
		state.setMemberships(membershipResponse.memberships);

		if (membershipResponse.memberships.length > 1) {
			state.navigate("/");
			return;
		}

		const membership =
			membershipResponse.memberships[0] ?? nextSession.membership ?? null;
		if (membership) {
			state.navigate(buildOrgPath(membership.organizationSlug));
			return;
		}

		state.navigate("/create-organization");
	}

	async function loadOrganization(slug: string) {
		const token = await getIdToken(state.firebaseUser());
		if (!token) {
			return;
		}

		const response = await getOrganization(token, slug);
		state.setOrganization(response.organization);
		state.setSession((current) => ({
			...current,
			membership: response.membership,
		}));
	}

	async function loadAdminUsers(slug: string) {
		const token = await getIdToken(state.firebaseUser());
		if (!token) {
			return;
		}

		const response = await getAdminUsers(token, slug);
		state.setAdminUsers(response.users);
	}

	async function loadFestivals(slug: string) {
		const token = await getIdToken(state.firebaseUser());
		if (!token) {
			return;
		}

		const response = await getFestivals(token, slug);
		state.setFestivals(response.festivals);
	}

	async function loadDivisionConfiguration(slug: string) {
		const loadVersion = ++divisionConfigurationLoadVersion;
		const token = await getIdToken(state.firebaseUser());
		if (!token) {
			if (isCurrentDivisionConfigurationLoad(loadVersion, slug)) {
				state.setIsLoadingDivisionConfiguration(false);
			}
			return;
		}
		if (!isCurrentDivisionConfigurationLoad(loadVersion, slug)) {
			return;
		}

		state.setIsLoadingDivisionConfiguration(true);
		state.setDivisionConfigurationLoadError("");
		state.setDivisions([]);
		state.setDivisionRenameDrafts({});
		state.setOrganizationTimezone("");
		state.setTimezoneDraft("");

		try {
			const [divisionResponse, timezoneResponse] = await Promise.all([
				getAdminDivisions(token, slug),
				getAdminTimezone(token, slug),
			]);
			if (!isCurrentDivisionConfigurationLoad(loadVersion, slug)) return;
			state.setDivisions(divisionResponse.divisions);
			state.setDivisionRenameDrafts(
				Object.fromEntries(
					divisionResponse.divisions.map((division) => [
						division.id,
						division.displayName,
					]),
				),
			);
			state.setOrganizationTimezone(timezoneResponse.timezone);
			state.setTimezoneDraft(timezoneResponse.timezone);
		} catch {
			if (!isCurrentDivisionConfigurationLoad(loadVersion, slug)) return;
			state.setDivisionConfigurationLoadError(
				"Division configuration is temporarily unavailable. Please try again.",
			);
		} finally {
			if (isCurrentDivisionConfigurationLoad(loadVersion, slug)) {
				state.setIsLoadingDivisionConfiguration(false);
			}
		}
	}

	async function loadMembershipProducts(slug: string) {
		const token = await getIdToken(state.firebaseUser());
		if (!token) {
			return;
		}

		state.setIsLoadingMembershipProducts(true);
		state.setMembershipProducts([]);
		state.setMembershipProductsLoadError("");

		try {
			const response = await getAdminMembershipProducts(token, slug);
			state.setMembershipProducts(response.membershipProducts);
		} catch {
			state.setMembershipProductsLoadError(
				"Membership products are temporarily unavailable. Please try again.",
			);
		} finally {
			state.setIsLoadingMembershipProducts(false);
		}
	}

	async function loadShopifySettings(slug: string) {
		const token = await getIdToken(state.firebaseUser());
		if (!token) {
			return;
		}

		const response = await getShopifySettings(token, slug);
		state.setShopifySettings(response.settings);
		state.setShopifyDraft({
			storeUrl: response.settings?.storeDomain ?? "",
			clientId: response.settings?.clientId ?? "",
			clientSecret: "",
		});
	}

	async function loadInvite(token: string) {
		try {
			const response = await getInvite(token);
			state.setInvite(response.invite);
		} catch (error) {
			state.setErrorMessage((error as Error).message);
		}
	}

	return {
		loadAdminUsers,
		loadDivisionConfiguration,
		loadFestivals,
		loadInvite,
		loadMembershipProducts,
		loadOrganization,
		loadShopifySettings,
		refreshSession,
		routeAfterSession,
	};
}

export type FestivalDataLoaders = ReturnType<typeof createFestivalDataLoaders>;
