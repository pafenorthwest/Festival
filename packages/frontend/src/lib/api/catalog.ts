import type {
	AddRepertoireCatalogWorkInput,
	CanonicalWork,
	CreateFestivalClassInput,
	CreateRoomInput,
	FestivalClassConfigurationDto,
	FestivalSummary,
	FlagRepertoireReviewInput,
	NormalizeRepertoireReviewInput,
	PublicMembershipProductsListResponse,
	PublicOrganizationDivisionListResponse,
	PublicOrganizationLandingResponse,
	RegistrationAgeConfiguration,
	RegistrationCatalogValue,
	RepertoireReviewItem,
	RepertoireReviewQueueFilter,
	RepertoireReviewQueueSummary,
	ResolveRepertoireFlagInput,
	Room,
	UpdateFestivalClassInput,
} from "@festival/common";
import { hc } from "hono/client";
import type { CatalogRoutesType } from "../../../../backend/dist/routes/api-router.js";
import {
	apiPrefix,
	createRpcFetch,
	resolveAuthToken,
	rpcCall,
} from "./client.js";

export type {
	AddRepertoireCatalogWorkInput,
	CanonicalContributor,
	CanonicalWork,
	CreateFestivalClassInput,
	CreateRoomInput,
	FestivalClassConfigurationDto,
	FestivalSummary,
	FlagRepertoireReviewInput,
	NormalizeRepertoireReviewInput,
	PianoType,
	PublicMembershipProductsListResponse,
	PublicOrganizationDivisionListResponse,
	PublicOrganizationLandingResponse,
	RegistrationAgeConfiguration,
	RegistrationCatalogValue,
	RepertoireFlagReason,
	RepertoirePiece,
	RepertoireReviewItem,
	RepertoireReviewQueueFilter,
	RepertoireReviewQueueSummary,
	RepertoireReviewStatus,
	ResolveRepertoireFlagInput,
	Room,
	RoomPianoConfiguration,
	UpdateFestivalClassInput,
} from "@festival/common";

type RepertoireQueueListFilter = RepertoireReviewQueueFilter & {
	claimedByUid?: string | null;
	flaggedOnly?: boolean;
	offset?: number;
	sync?: boolean;
};

function catalogOrg(
	options: { idToken?: string | null; useApiBase?: boolean } = {},
) {
	return hc<CatalogRoutesType>(apiPrefix(options.useApiBase ?? true), {
		fetch: createRpcFetch({ idToken: options.idToken }),
	}).organizations[":slug"];
}

const slugParam = (slug: string) => ({ slug: encodeURIComponent(slug) });
const festivalParam = (slug: string, festivalSlug: string) => ({
	slug: encodeURIComponent(slug),
	festivalShortName: encodeURIComponent(festivalSlug),
});
const reviewQueueParam = (slug: string, reviewId: string) => ({
	slug: encodeURIComponent(slug),
	id: encodeURIComponent(reviewId),
});

function buildRepertoireQueueQuery(filter?: RepertoireQueueListFilter) {
	if (!filter) return undefined;
	const status = Array.isArray(filter.status)
		? filter.status.join(",")
		: filter.status;
	const search = filter.search ?? filter.searchQuery;
	const flaggedOnly =
		filter.flaggedOnly !== undefined
			? String(filter.flaggedOnly)
			: filter.isFlagged !== undefined
				? String(filter.isFlagged)
				: undefined;
	const query: {
		status?: string;
		claimedByUid?: string;
		flaggedOnly?: string;
		search?: string;
		limit?: string;
		offset?: string;
		sync?: string;
	} = {};
	if (status) query.status = status;
	if (filter.claimedByUid) query.claimedByUid = filter.claimedByUid;
	if (flaggedOnly !== undefined) query.flaggedOnly = flaggedOnly;
	if (search) query.search = search;
	if (typeof filter.limit === "number") query.limit = String(filter.limit);
	if (typeof filter.offset === "number") query.offset = String(filter.offset);
	if (filter.sync !== undefined) query.sync = String(filter.sync);
	return Object.keys(query).length > 0 ? query : undefined;
}

function rpcQueryArgs<P, Q>(param: P, query?: Q): { param: P; query: Q } {
	return (query ? { param, query } : { param }) as { param: P; query: Q };
}

export function getPublicOrganizationLanding(
	slug: string,
): Promise<PublicOrganizationLandingResponse> {
	const endpoint = catalogOrg().landing;
	const param = slugParam(slug);
	return rpcCall(endpoint.$get({ param }), endpoint.$path({ param }));
}

export function getPrimaryFestivalPath(
	slug: string,
): Promise<{ status: 301 | 404; path: string }> {
	const endpoint = catalogOrg().primary;
	const param = slugParam(slug);
	return rpcCall(endpoint.$get({ param }), endpoint.$path({ param }));
}

export function getPublicFestival(
	slug: string,
	festivalSlug: string,
): Promise<{ festival: FestivalSummary }> {
	const endpoint = catalogOrg().festivals[":festivalShortName"];
	const param = festivalParam(slug, festivalSlug);
	return rpcCall(endpoint.$get({ param }), endpoint.$path({ param }));
}

export function getMembershipProducts(
	slug: string,
): Promise<PublicMembershipProductsListResponse> {
	const param = slugParam(slug);
	return rpcCall(
		catalogOrg()["membership-products"].$get({ param }),
		catalogOrg()["membership-products"].$path({ param }),
	);
}

export function getPublicDivisions(
	slug: string,
): Promise<PublicOrganizationDivisionListResponse> {
	const endpoint = catalogOrg({ useApiBase: false }).divisions;
	const param = slugParam(slug);
	return rpcCall(endpoint.$get({ param }), endpoint.$path({ param }));
}

export function getAdminRegistrationConfiguration(
	idToken: string,
	slug: string,
): Promise<{
	ageConfiguration: RegistrationAgeConfiguration | null;
	classSubtypes: RegistrationCatalogValue[];
	instruments: RegistrationCatalogValue[];
}> {
	const endpoint = catalogOrg({ idToken }).admin["registration-configuration"];
	const param = slugParam(slug);
	return rpcCall(endpoint.$get({ param }), endpoint.$path({ param }));
}

export function listFestivalClassSubtypes(
	idToken: string,
	slug: string,
	festivalSlug: string,
): Promise<{ classSubtypes: RegistrationCatalogValue[] }> {
	const endpoint = catalogOrg({ idToken }).admin.festivals[
		":festivalShortName"
	]["class-subtypes"];
	const param = festivalParam(slug, festivalSlug);
	return rpcCall(endpoint.$get({ param }), endpoint.$path({ param }));
}

export function createFestivalClassSubtype(
	idToken: string,
	slug: string,
	festivalSlug: string,
	displayName: string,
	requiredSubtypeId?: string | null,
): Promise<{ value: RegistrationCatalogValue }> {
	const endpoint = catalogOrg({ idToken }).admin.festivals[
		":festivalShortName"
	]["class-subtypes"];
	const param = festivalParam(slug, festivalSlug);
	const json = {
		displayName,
		...(requiredSubtypeId !== undefined
			? { requiredSubtypeId: requiredSubtypeId || null }
			: {}),
	};
	return rpcCall(endpoint.$post({ param, json }), endpoint.$path({ param }));
}

export function updateAdminClassSubtype(
	idToken: string,
	slug: string,
	id: string,
	input: {
		displayName?: string;
		isActive?: boolean;
		requiredSubtypeId?: string | null;
	},
): Promise<{ value: RegistrationCatalogValue }> {
	const endpoint = catalogOrg({ idToken }).admin["class-subtypes"][":id"];
	const param = { ...slugParam(slug), id: encodeURIComponent(id) };
	return rpcCall(
		endpoint.$post({ param, json: input }),
		endpoint.$path({ param }),
	);
}

export function updateAdminRegistrationAgeDate(
	idToken: string,
	slug: string,
	registrationAgeDate: string,
): Promise<{ ageConfiguration: RegistrationAgeConfiguration }> {
	const endpoint = catalogOrg({ idToken }).admin["registration-age-date"];
	const param = slugParam(slug);
	return rpcCall(
		endpoint.$post({ param, json: { registrationAgeDate } }),
		endpoint.$path({ param }),
	);
}

export function listRooms(
	idToken: string,
	slug: string,
	festivalSlug: string,
): Promise<{ rooms: Room[] }> {
	const endpoint = catalogOrg({ idToken }).admin.festivals[":festivalShortName"]
		.rooms;
	const param = festivalParam(slug, festivalSlug);
	return rpcCall(endpoint.$get({ param }), endpoint.$path({ param }));
}

export function createRoom(
	idToken: string,
	slug: string,
	festivalSlug: string,
	input: CreateRoomInput,
): Promise<Room> {
	const endpoint = catalogOrg({ idToken }).admin.festivals[":festivalShortName"]
		.rooms;
	const param = festivalParam(slug, festivalSlug);
	return rpcCall(
		endpoint.$post({ param, json: input }),
		endpoint.$path({ param }),
	);
}

export function listFestivalClasses(
	idToken: string,
	slug: string,
	festivalSlug: string,
): Promise<FestivalClassConfigurationDto[]> {
	const endpoint = catalogOrg({ idToken }).admin.festivals[":festivalShortName"]
		.classes;
	const param = festivalParam(slug, festivalSlug);
	return rpcCall(endpoint.$get({ param }), endpoint.$path({ param }));
}

export function createFestivalClass(
	idToken: string,
	slug: string,
	festivalSlug: string,
	input: CreateFestivalClassInput,
): Promise<FestivalClassConfigurationDto> {
	const endpoint = catalogOrg({ idToken }).admin.festivals[":festivalShortName"]
		.classes;
	const param = festivalParam(slug, festivalSlug);
	return rpcCall(
		endpoint.$post({ param, json: input }),
		endpoint.$path({ param }),
	);
}

export function updateFestivalClass(
	idToken: string,
	slug: string,
	festivalSlug: string,
	classId: string,
	input: UpdateFestivalClassInput,
): Promise<FestivalClassConfigurationDto> {
	const endpoint = catalogOrg({ idToken }).admin.festivals[":festivalShortName"]
		.classes[":classId"];
	const param = {
		...festivalParam(slug, festivalSlug),
		classId: encodeURIComponent(classId),
	};
	return rpcCall(
		endpoint.$patch({ param, json: input }),
		endpoint.$path({ param }),
	);
}

export async function listRepertoireReviewQueue(
	slug: string,
	filter?: RepertoireQueueListFilter,
	idToken?: string,
): Promise<{
	items: RepertoireReviewItem[];
	summary: RepertoireReviewQueueSummary;
}> {
	const token = await resolveAuthToken(idToken);
	const endpoint = catalogOrg({ idToken: token }).repertoire.queue;
	const param = slugParam(slug);
	const query = buildRepertoireQueueQuery(filter);
	const args = rpcQueryArgs(param, query);
	return rpcCall(endpoint.$get(args), endpoint.$path(args));
}

export async function claimRepertoireReview(
	slug: string,
	reviewId: string,
	options?: { reviewerName?: string; idToken?: string },
): Promise<{ item: RepertoireReviewItem }> {
	const token = await resolveAuthToken(options?.idToken);
	const endpoint = catalogOrg({ idToken: token }).repertoire.queue[":id"].claim;
	const param = reviewQueueParam(slug, reviewId);
	const json = options?.reviewerName
		? { reviewerName: options.reviewerName }
		: {};
	return rpcCall(endpoint.$post({ param, json }), endpoint.$path({ param }));
}

export async function unclaimRepertoireReview(
	slug: string,
	reviewId: string,
	idToken?: string,
): Promise<{ item: RepertoireReviewItem }> {
	const token = await resolveAuthToken(idToken);
	const endpoint = catalogOrg({ idToken: token }).repertoire.queue[":id"]
		.unclaim;
	const param = reviewQueueParam(slug, reviewId);
	return rpcCall(endpoint.$post({ param }), endpoint.$path({ param }));
}

export async function normalizeRepertoireReview(
	slug: string,
	reviewId: string,
	input: NormalizeRepertoireReviewInput,
	idToken?: string,
): Promise<{ item: RepertoireReviewItem }> {
	const token = await resolveAuthToken(idToken);
	const endpoint = catalogOrg({ idToken: token }).repertoire.queue[":id"]
		.normalize;
	const param = reviewQueueParam(slug, reviewId);
	return rpcCall(
		endpoint.$post({ param, json: input }),
		endpoint.$path({ param }),
	);
}

export async function flagRepertoireReview(
	slug: string,
	reviewId: string,
	input: FlagRepertoireReviewInput,
	idToken?: string,
): Promise<{ item: RepertoireReviewItem }> {
	const token = await resolveAuthToken(idToken);
	const endpoint = catalogOrg({ idToken: token }).repertoire.queue[":id"].flag;
	const param = reviewQueueParam(slug, reviewId);
	return rpcCall(
		endpoint.$post({ param, json: input }),
		endpoint.$path({ param }),
	);
}

export async function resolveRepertoireFlag(
	slug: string,
	reviewId: string,
	input?: ResolveRepertoireFlagInput,
	idToken?: string,
): Promise<{ item: RepertoireReviewItem }> {
	const token = await resolveAuthToken(idToken);
	const endpoint = catalogOrg({ idToken: token }).repertoire.queue[":id"][
		"resolve-flag"
	];
	const param = reviewQueueParam(slug, reviewId);
	return rpcCall(
		endpoint.$post({ param, json: input ?? {} }),
		endpoint.$path({ param }),
	);
}

export async function searchRepertoireCatalog(
	slug: string,
	query: string,
	options?: { limit?: number; idToken?: string },
): Promise<{ works: CanonicalWork[] }> {
	const token = await resolveAuthToken(options?.idToken);
	const endpoint = catalogOrg({ idToken: token }).repertoire.catalog;
	const param = slugParam(slug);
	const rpcQuery = {
		q: query,
		...(typeof options?.limit === "number"
			? { limit: String(options.limit) }
			: {}),
	};
	return rpcCall(
		endpoint.$get({ param, query: rpcQuery }),
		endpoint.$path({ param, query: rpcQuery }),
	);
}

export async function addRepertoireCatalogWork(
	slug: string,
	input: AddRepertoireCatalogWorkInput,
	idToken?: string,
): Promise<{ work: CanonicalWork }> {
	const token = await resolveAuthToken(idToken);
	const endpoint = catalogOrg({ idToken: token }).repertoire.catalog;
	const param = slugParam(slug);
	return rpcCall(
		endpoint.$post({ param, json: input }),
		endpoint.$path({ param }),
	);
}
