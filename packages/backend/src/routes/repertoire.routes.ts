import {
	isRepertoireReviewStatus,
	type RepertoireReviewStatus,
	validateAddCatalogWorkInput,
	validateClaimReviewInput,
	validateFlagReviewInput,
	validateNormalizeReviewInput,
	validateResolveFlagInput,
} from "@festival/common";
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

export interface RepertoireRoutesOptions {
	authVerifier: AuthVerifier;
	repository: OrganizationRepository;
	repertoireRepository?: RepertoireRepository;
}

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

export function buildRepertoireRoutes(
	options: RepertoireRoutesOptions,
): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();
	const { authVerifier, repository } = options;
	const repertoireRepo =
		options.repertoireRepository ?? new InMemoryRepertoireRepository();

	// 1. GET /queue: list review items with filter, queue metrics
	router.get(
		"/queue",
		requireAuth(authVerifier),
		requireTenant(repository),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const status = parseStatusFilter(c.req.query("status"));
				const limit = parsePositiveInt(c.req.query("limit"), "Limit");
				const offset = parseNonNegativeInt(c.req.query("offset"), "Offset");

				const filter: ReviewQueueFilter = {
					status,
					claimedByUid: c.req.query("claimedByUid") ?? undefined,
					flaggedOnly: c.req.query("flaggedOnly") === "true",
					search: c.req.query("search") ?? c.req.query("q") ?? undefined,
					limit,
					offset,
				};

				if (c.req.query("sync") === "true") {
					await repertoireRepo.syncReviewQueue(tenant.organization.id);
				}

				const result = await repertoireRepo.listReviewQueue(
					tenant.organization.id,
					filter,
				);
				return c.json(result);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	// 2. POST /queue/:id/claim: claim item
	router.post(
		"/queue/:id/claim",
		requireAuth(authVerifier),
		requireTenant(repository),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const identity = getRequiredIdentity(c);
				const id = c.req.param("id");
				if (!id?.trim()) {
					throw new AppError("Review item ID is required.", 400);
				}

				let body: Record<string, unknown> = {};
				try {
					body = (await c.req.json()) ?? {};
				} catch {
					body = {};
				}

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

				if (outcome.kind === "not_found") {
					throw new AppError(outcome.message, 404);
				}
				if (outcome.kind === "conflict") {
					throw new AppError(outcome.message, 409);
				}
				return c.json({ item: outcome.item });
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	// 3. POST /queue/:id/unclaim: release item
	router.post(
		"/queue/:id/unclaim",
		requireAuth(authVerifier),
		requireTenant(repository),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const identity = getRequiredIdentity(c);
				const id = c.req.param("id");
				if (!id?.trim()) {
					throw new AppError("Review item ID is required.", 400);
				}

				const item = await repertoireRepo.unclaimReviewItem({
					organizationId: tenant.organization.id,
					reviewItemId: id,
					claimedByUid: tenant.role === "Admin" ? undefined : identity.uid,
				});

				if (!item) {
					throw new AppError(
						"Review item not found or not claimed by you.",
						404,
					);
				}
				return c.json({ item });
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	// 4. POST /queue/:id/normalize: normalize and approve item with canonical composer/work/IMSLP
	router.post(
		"/queue/:id/normalize",
		requireAuth(authVerifier),
		requireTenant(repository),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const identity = getRequiredIdentity(c);
				const id = c.req.param("id");
				if (!id?.trim()) {
					throw new AppError("Review item ID is required.", 400);
				}

				let body: unknown;
				try {
					body = await c.req.json();
				} catch {
					throw new AppError("Invalid JSON payload.", 400);
				}

				const validation = validateNormalizeReviewInput({
					...(typeof body === "object" && body !== null ? body : {}),
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
					return c.json({ item });
				} catch (repoError) {
					if (
						repoError instanceof Error &&
						repoError.message === "Review item not found."
					) {
						throw new AppError("Review item not found.", 404);
					}
					throw repoError;
				}
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	// 5. POST /queue/:id/flag: flag item with reason/notes
	router.post(
		"/queue/:id/flag",
		requireAuth(authVerifier),
		requireTenant(repository),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const identity = getRequiredIdentity(c);
				const id = c.req.param("id");
				if (!id?.trim()) {
					throw new AppError("Review item ID is required.", 400);
				}

				let body: unknown;
				try {
					body = await c.req.json();
				} catch {
					throw new AppError("Invalid JSON payload.", 400);
				}

				const validation = validateFlagReviewInput({
					...(typeof body === "object" && body !== null ? body : {}),
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
					return c.json({ item });
				} catch (repoError) {
					if (
						repoError instanceof Error &&
						repoError.message === "Review item not found."
					) {
						throw new AppError("Review item not found.", 404);
					}
					throw repoError;
				}
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	// 6. POST /queue/:id/resolve-flag: resolve flagged item
	router.post(
		"/queue/:id/resolve-flag",
		requireAuth(authVerifier),
		requireTenant(repository),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const identity = getRequiredIdentity(c);
				const id = c.req.param("id");
				if (!id?.trim()) {
					throw new AppError("Review item ID is required.", 400);
				}

				let body: unknown = {};
				try {
					body = (await c.req.json()) ?? {};
				} catch {
					body = {};
				}

				const validation = validateResolveFlagInput({
					...(typeof body === "object" && body !== null ? body : {}),
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
					return c.json({ item });
				} catch (repoError) {
					if (
						repoError instanceof Error &&
						repoError.message === "Review item not found."
					) {
						throw new AppError("Review item not found.", 404);
					}
					throw repoError;
				}
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	// 7. GET /catalog: search canonical works and composers
	router.get(
		"/catalog",
		requireAuth(authVerifier),
		requireTenant(repository),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				const query =
					c.req.query("q") ??
					c.req.query("query") ??
					c.req.query("search") ??
					"";
				const limit = parsePositiveInt(c.req.query("limit"), "Limit");

				const works = await repertoireRepo.searchCatalogWorks({
					organizationId: tenant.organization.id,
					query,
					limit,
				});
				return c.json({ works });
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	// 8. POST /catalog: add canonical work to catalog
	router.post(
		"/catalog",
		requireAuth(authVerifier),
		requireTenant(repository),
		async (c) => {
			try {
				const tenant = getRequiredTenant(c);
				let body: unknown;
				try {
					body = await c.req.json();
				} catch {
					throw new AppError("Invalid JSON payload.", 400);
				}

				const validation = validateAddCatalogWorkInput({
					...(typeof body === "object" && body !== null ? body : {}),
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
				});
				c.status(201);
				return c.json({ work });
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	return router;
}
