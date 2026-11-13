import {
	AddRepertoireCatalogWorkInputSchema,
	ClaimRepertoireReviewInputSchema,
	FlagRepertoireReviewInputSchema,
	isRepertoireReviewStatus,
	NormalizeRepertoireReviewInputSchema,
	RepertoireCatalogQuerySchema,
	RepertoireQueueQuerySchema,
	type RepertoireReviewStatus,
	ResolveRepertoireFlagInputSchema,
	validateAddCatalogWorkInput,
	validateClaimReviewInput,
	validateFlagReviewInput,
	validateNormalizeReviewInput,
	validateResolveFlagInput,
} from "@festival/common";
import type { Context } from "hono";
import { Hono } from "hono";
import {
	type ApiVariables,
	getRequiredIdentity,
	getRequiredTenant,
	requireAuth,
	requireTenant,
	toJsonError,
} from "../auth/tenant-context.js";
import type { AuthVerifier } from "../auth/types.js";
import { AppError } from "../errors/app-error.js";
import {
	InMemoryRepertoireRepository,
	type RepertoireRepository,
	type ReviewQueueFilter,
} from "../repertoire/index.js";
import type { OrganizationRepository } from "../repo/organization-repository.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "./shared/route-security-metadata.js";
import {
	jsonValidator,
	preValidationGuard,
	queryValidator,
} from "./shared/schema-validator.js";

const repertoireRoute = (
	method: CoLocatedRouteSecurity["method"],
	path: string,
) =>
	defineRouteSecurity({
		method,
		path,
		authenticationClass: "tenant",
		csrfRequired: false,
		browserAllowed: true,
	});

export const REPERTOIRE_ROUTE_SECURITY = [
	repertoireRoute("GET", "/queue"),
	repertoireRoute("POST", "/queue/:id/claim"),
	repertoireRoute("POST", "/queue/:id/unclaim"),
	repertoireRoute("POST", "/queue/:id/normalize"),
	repertoireRoute("POST", "/queue/:id/flag"),
	repertoireRoute("POST", "/queue/:id/resolve-flag"),
	repertoireRoute("GET", "/catalog"),
	repertoireRoute("POST", "/catalog"),
] as const satisfies readonly CoLocatedRouteSecurity[];

export interface RepertoireRoutesOptions {
	authVerifier: AuthVerifier;
	repository: OrganizationRepository;
	repertoireRepository?: RepertoireRepository;
}

type ApiContext = Context<{ Variables: Partial<ApiVariables> }>;

function parseStatusFilter(
	statusParam: string | undefined,
): RepertoireReviewStatus | RepertoireReviewStatus[] | undefined {
	if (!statusParam) return undefined;
	const parts = statusParam
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	for (const s of parts) {
		if (!isRepertoireReviewStatus(s)) {
			throw new AppError(`Invalid review status: "${s}".`, 400);
		}
	}
	return parts.length === 1
		? (parts[0] as RepertoireReviewStatus)
		: (parts as RepertoireReviewStatus[]);
}

function parsePositiveInt(
	value: string | undefined,
	name: string,
): number | undefined {
	if (!value) return undefined;
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed) || parsed < 1) {
		throw new AppError(`${name} must be a positive integer.`, 400);
	}
	return parsed;
}

function parseNonNegativeInt(
	value: string | undefined,
	name: string,
): number | undefined {
	if (!value) return undefined;
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed) || parsed < 0) {
		throw new AppError(`${name} must be a non-negative integer.`, 400);
	}
	return parsed;
}

function requireReviewItemId(c: ApiContext): string {
	const id = c.req.param("id");
	if (!id?.trim()) {
		throw new AppError("Review item ID is required.", 400);
	}
	return id;
}

function rethrowReviewNotFound(error: unknown): never {
	if (error instanceof Error && error.message === "Review item not found.") {
		throw new AppError("Review item not found.", 404);
	}
	throw error;
}

async function withRepertoireJson<T>(
	c: ApiContext,
	fn: () => Promise<T>,
	status: 200 | 201 = 200,
) {
	try {
		return c.json(await fn(), status);
	} catch (error) {
		return toJsonError(c, error);
	}
}

function handleGetQueue(
	c: ApiContext,
	repertoireRepo: RepertoireRepository,
	query: {
		status?: string;
		claimedByUid?: string;
		flaggedOnly?: string;
		search?: string;
		q?: string;
		limit?: string;
		offset?: string;
		sync?: string;
	},
) {
	return withRepertoireJson(c, async () => {
		const tenant = getRequiredTenant(c);
		const filter: ReviewQueueFilter = {
			status: parseStatusFilter(query.status),
			claimedByUid: query.claimedByUid ?? undefined,
			flaggedOnly: query.flaggedOnly === "true",
			search: query.search ?? query.q ?? undefined,
			limit: parsePositiveInt(query.limit, "Limit"),
			offset: parseNonNegativeInt(query.offset, "Offset"),
		};
		if (query.sync === "true") {
			await repertoireRepo.syncReviewQueue(tenant.organization.id);
		}
		return repertoireRepo.listReviewQueue(tenant.organization.id, filter);
	});
}

function handleClaimItem(
	c: ApiContext,
	repertoireRepo: RepertoireRepository,
	body: { reviewerName?: string },
) {
	return withRepertoireJson(c, async () => {
		const tenant = getRequiredTenant(c);
		const identity = getRequiredIdentity(c);
		const id = requireReviewItemId(c);
		const claimedByName =
			typeof body.reviewerName === "string" &&
			body.reviewerName.trim().length > 0
				? body.reviewerName.trim()
				: identity.displayName || identity.email;
		const validation = validateClaimReviewInput({
			reviewItemId: id,
			reviewerId: identity.uid,
			reviewerName: claimedByName,
			organizationId: tenant.organization.id,
		});
		if (!validation.valid) {
			throw new AppError(validation.errors.join(" "), 400);
		}
		const outcome = await repertoireRepo.claimReviewItem({
			organizationId: tenant.organization.id,
			reviewItemId: id,
			claimedByUid: identity.uid,
			claimedByName,
		});
		if (outcome.kind === "not_found") throw new AppError(outcome.message, 404);
		if (outcome.kind === "conflict") throw new AppError(outcome.message, 409);
		return { item: outcome.item };
	});
}

function handleUnclaimItem(
	c: ApiContext,
	repertoireRepo: RepertoireRepository,
) {
	return withRepertoireJson(c, async () => {
		const tenant = getRequiredTenant(c);
		const identity = getRequiredIdentity(c);
		const id = requireReviewItemId(c);
		const item = await repertoireRepo.unclaimReviewItem({
			organizationId: tenant.organization.id,
			reviewItemId: id,
			claimedByUid: tenant.role === "Admin" ? undefined : identity.uid,
		});
		if (!item) {
			throw new AppError("Review item not found or not claimed by you.", 404);
		}
		return { item };
	});
}

function handleNormalizeItem(
	c: ApiContext,
	repertoireRepo: RepertoireRepository,
	body: Record<string, unknown>,
) {
	return withRepertoireJson(c, async () => {
		const tenant = getRequiredTenant(c);
		const identity = getRequiredIdentity(c);
		const id = requireReviewItemId(c);
		const validation = validateNormalizeReviewInput({
			...body,
			reviewItemId: id,
			reviewerId: identity.uid,
			organizationId: tenant.organization.id,
		});
		if (!validation.valid || !validation.data) {
			throw new AppError(validation.errors.join(" "), 400);
		}
		try {
			const item = await repertoireRepo.normalizeAndApprove({
				organizationId: tenant.organization.id,
				reviewItemId: id,
				normalizedTitle: validation.data.normalizedTitle,
				normalizedComposer: validation.data.normalizedComposer,
				imslpUrl: validation.data.imslpUrl,
				notes: validation.data.notes,
				reviewerId: identity.uid,
			});
			return { item };
		} catch (repoError) {
			return rethrowReviewNotFound(repoError);
		}
	});
}

function handleFlagItem(
	c: ApiContext,
	repertoireRepo: RepertoireRepository,
	body: Record<string, unknown>,
) {
	return withRepertoireJson(c, async () => {
		const tenant = getRequiredTenant(c);
		const identity = getRequiredIdentity(c);
		const id = requireReviewItemId(c);
		const validation = validateFlagReviewInput({
			...body,
			reviewItemId: id,
			flaggedBy: identity.uid,
			organizationId: tenant.organization.id,
		});
		if (!validation.valid || !validation.data) {
			throw new AppError(validation.errors.join(" "), 400);
		}
		try {
			const item = await repertoireRepo.flagReviewItem({
				organizationId: tenant.organization.id,
				reviewItemId: id,
				reason: validation.data.reason,
				notes: validation.data.notes,
				flaggedByUid: identity.uid,
			});
			return { item };
		} catch (repoError) {
			return rethrowReviewNotFound(repoError);
		}
	});
}

function handleResolveFlag(
	c: ApiContext,
	repertoireRepo: RepertoireRepository,
	body: Record<string, unknown>,
) {
	return withRepertoireJson(c, async () => {
		const tenant = getRequiredTenant(c);
		const identity = getRequiredIdentity(c);
		const id = requireReviewItemId(c);
		const validation = validateResolveFlagInput({
			...body,
			reviewItemId: id,
			resolvedBy: identity.uid,
			organizationId: tenant.organization.id,
		});
		if (!validation.valid || !validation.data) {
			throw new AppError(validation.errors.join(" "), 400);
		}
		try {
			const item = await repertoireRepo.resolveFlag({
				organizationId: tenant.organization.id,
				reviewItemId: id,
				resolutionNotes: validation.data.resolutionNotes,
				status: validation.data.status,
				resolvedByUid: identity.uid,
			});
			return { item };
		} catch (repoError) {
			return rethrowReviewNotFound(repoError);
		}
	});
}

function handleSearchCatalog(
	c: ApiContext,
	repertoireRepo: RepertoireRepository,
	q: { q?: string; query?: string; search?: string; limit?: string },
) {
	return withRepertoireJson(c, async () => {
		const tenant = getRequiredTenant(c);
		const query = q.q ?? q.query ?? q.search ?? "";
		const limit = parsePositiveInt(q.limit, "Limit");
		const works = await repertoireRepo.searchCatalogWorks({
			organizationId: tenant.organization.id,
			query,
			limit,
		});
		return { works };
	});
}

function handleAddCatalogWork(
	c: ApiContext,
	repertoireRepo: RepertoireRepository,
	body: Record<string, unknown>,
) {
	return withRepertoireJson(
		c,
		async () => {
			const tenant = getRequiredTenant(c);
			const validation = validateAddCatalogWorkInput({
				...body,
				organizationId: tenant.organization.id,
			});
			if (!validation.valid || !validation.data) {
				throw new AppError(validation.errors.join(" "), 400);
			}
			const work = await repertoireRepo.addCatalogWork({
				organizationId: tenant.organization.id,
				title: validation.data.title,
				composerName: validation.data.composer,
				imslpUrl: validation.data.imslpUrl,
				classifications: validation.data.classifications,
			});
			return { work };
		},
		201,
	);
}

function buildRepertoireQueueRoutes(
	options: RepertoireRoutesOptions,
	repertoireRepo: RepertoireRepository,
) {
	const auth = requireAuth(options.authVerifier);
	const tenant = requireTenant(options.repository);
	const requireItemId = preValidationGuard<{
		Variables: Partial<ApiVariables>;
	}>((c) => {
		requireReviewItemId(c);
	});
	const emptyJson = { allowEmptyJsonObject: true } as const;

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get(
			"/queue",
			auth,
			tenant,
			queryValidator(RepertoireQueueQuerySchema),
			(c) => handleGetQueue(c, repertoireRepo, c.req.valid("query")),
		)
		.post(
			"/queue/:id/claim",
			auth,
			tenant,
			requireItemId,
			jsonValidator(ClaimRepertoireReviewInputSchema, emptyJson),
			(c) => handleClaimItem(c, repertoireRepo, c.req.valid("json")),
		)
		.post("/queue/:id/unclaim", auth, tenant, (c) =>
			handleUnclaimItem(c, repertoireRepo),
		)
		.post(
			"/queue/:id/normalize",
			auth,
			tenant,
			requireItemId,
			jsonValidator(NormalizeRepertoireReviewInputSchema),
			(c) => handleNormalizeItem(c, repertoireRepo, c.req.valid("json")),
		)
		.post(
			"/queue/:id/flag",
			auth,
			tenant,
			requireItemId,
			jsonValidator(FlagRepertoireReviewInputSchema),
			(c) => handleFlagItem(c, repertoireRepo, c.req.valid("json")),
		)
		.post(
			"/queue/:id/resolve-flag",
			auth,
			tenant,
			requireItemId,
			jsonValidator(ResolveRepertoireFlagInputSchema, emptyJson),
			(c) => handleResolveFlag(c, repertoireRepo, c.req.valid("json")),
		);
}

export function buildRepertoireRoutes(options: RepertoireRoutesOptions) {
	const repertoireRepo =
		options.repertoireRepository ?? new InMemoryRepertoireRepository();
	const auth = requireAuth(options.authVerifier);
	const tenant = requireTenant(options.repository);

	return buildRepertoireQueueRoutes(options, repertoireRepo)
		.get(
			"/catalog",
			auth,
			tenant,
			queryValidator(RepertoireCatalogQuerySchema),
			(c) => handleSearchCatalog(c, repertoireRepo, c.req.valid("query")),
		)
		.post(
			"/catalog",
			auth,
			tenant,
			jsonValidator(AddRepertoireCatalogWorkInputSchema),
			(c) => handleAddCatalogWork(c, repertoireRepo, c.req.valid("json")),
		);
}
