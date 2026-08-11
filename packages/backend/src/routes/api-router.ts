import type {
	AcceptInviteInput,
	CreateFestivalInput,
	CreateInviteInput,
	CreateOrganizationInput,
} from "@festival/common";
import { Hono } from "hono";
import {
	type ApiVariables,
	assertTenantRole,
	getRequiredIdentity,
	getRequiredTenant,
	readIdentity,
	requireAuth,
	requireTenant,
	requireTenantRole,
	resolveTenantContext,
	toJsonError,
} from "../auth/tenant-context.js";
import type { AuthVerifier } from "../auth/types.js";
import { AppError } from "../errors/app-error.js";
import type { OrganizationService } from "../services/organization-service.js";
import type { ShopifyIntegrationService } from "../shopify/shopify-integration-service.js";
import type { ShopifyMembershipProductService } from "../shopify/shopify-membership-product-service.js";

const FORBIDDEN_MEMBERSHIP_PRODUCT_FIELDS = [
	"organizationId",
	"shopifyProductGid",
	"shopifyVariantGid",
	"variantName",
	"storeDomain",
	"clientId",
	"clientSecret",
	"credentials",
] as const;

const PUBLIC_MEMBERSHIP_PRODUCTS_UNAVAILABLE_MESSAGE =
	"Membership information is temporarily unavailable. Please try again later.";

function assertNoForbiddenMembershipProductFields(payload: unknown): void {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return;
	}

	const forbiddenFields = FORBIDDEN_MEMBERSHIP_PRODUCT_FIELDS.filter((field) =>
		Object.hasOwn(payload, field),
	);
	if (forbiddenFields.length > 0) {
		throw new AppError(
			`Membership product request cannot include browser-controlled fields: ${forbiddenFields.join(", ")}.`,
			400,
		);
	}
}

export function buildApiRouter(
	organizationService: OrganizationService,
	authVerifier: AuthVerifier,
	shopifyIntegrationService?: ShopifyIntegrationService,
	shopifyMembershipProductService?: ShopifyMembershipProductService,
): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();
	const repository = organizationService.repository;

	router.get("/session", async (c) => {
		try {
			const identity = await readIdentity(c, authVerifier);
			return c.json(
				await organizationService.getSession(identity ?? undefined),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.post("/organizations", requireAuth(authVerifier), async (c) => {
		try {
			const payload = (await c.req.json()) as CreateOrganizationInput;
			c.status(201);
			return c.json(
				await organizationService.createOrganization(
					getRequiredIdentity(c),
					payload,
				),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.get("/memberships", requireAuth(authVerifier), async (c) => {
		try {
			return c.json(
				await organizationService.listMemberships(getRequiredIdentity(c)),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.post("/invites", requireAuth(authVerifier), async (c) => {
		try {
			const payload = (await c.req.json()) as CreateInviteInput;
			const tenant = await resolveTenantContext(
				c,
				repository,
				payload.organizationSlug,
			);
			assertTenantRole(tenant, ["Admin"]);
			c.status(201);
			return c.json(
				await organizationService.createInviteForTenant(tenant, payload),
			);
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.get("/invites/:token", async (c) => {
		try {
			return c.json(await organizationService.getInvite(c.req.param("token")));
		} catch (error) {
			return toJsonError(c, error);
		}
	});

	router.post(
		"/invites/:token/accept",
		requireAuth(authVerifier),
		async (c) => {
			try {
				const payload = (await c.req.json()) as AcceptInviteInput;
				c.status(201);
				return c.json(
					await organizationService.acceptInvite(
						getRequiredIdentity(c),
						c.req.param("token"),
						payload,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug",
		requireAuth(authVerifier),
		requireTenant(repository),
		async (c) => {
			try {
				return c.json(
					organizationService.getOrganizationLandingForTenant(
						getRequiredTenant(c),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/welcome/dismiss",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole([
			"Admin",
			"Division Chair",
			"Music Reviewer",
			"Concert Chair",
			"Read Only",
		]),
		async (c) => {
			try {
				return c.json(
					await organizationService.dismissWelcomeForTenant(
						getRequiredTenant(c),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug/admin/users",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.listAdminUsersForTenant(
						getRequiredTenant(c),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.delete(
		"/organizations/:slug/admin/memberships/:membershipId",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.deleteMembershipForTenant(
						getRequiredTenant(c),
						c.req.param("membershipId"),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.delete(
		"/organizations/:slug/admin/invites/:inviteId",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.cancelInviteForTenant(
						getRequiredTenant(c),
						c.req.param("inviteId"),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug/admin/festivals",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				return c.json(
					await organizationService.listFestivalsForTenant(
						getRequiredTenant(c),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/festivals",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				const payload = (await c.req.json()) as CreateFestivalInput;
				c.status(201);
				return c.json(
					await organizationService.createFestivalForTenant(
						getRequiredTenant(c),
						payload,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get(
		"/organizations/:slug/admin/shopify",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				if (!shopifyIntegrationService) {
					throw new AppError("AES_ENCRYPTION_KEY is required.", 500);
				}

				return c.json(
					await shopifyIntegrationService.getSettingsForTenant(
						getRequiredTenant(c),
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/shopify",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				if (!shopifyIntegrationService) {
					throw new AppError("AES_ENCRYPTION_KEY is required.", 500);
				}

				const payload = await c.req.json();
				return c.json(
					await shopifyIntegrationService.saveAndTestForTenant(
						getRequiredTenant(c),
						payload,
					),
				);
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.post(
		"/organizations/:slug/admin/membership-products",
		requireAuth(authVerifier),
		requireTenant(repository),
		requireTenantRole(["Admin"]),
		async (c) => {
			try {
				if (!shopifyMembershipProductService) {
					throw new AppError("AES_ENCRYPTION_KEY is required.", 500);
				}

				const payload = await c.req.json();
				assertNoForbiddenMembershipProductFields(payload);
				const membershipProduct =
					await shopifyMembershipProductService.createMembershipProduct(
						getRequiredTenant(c).organization,
						payload,
					);
				c.status(201);
				return c.json({ membershipProduct });
			} catch (error) {
				return toJsonError(c, error);
			}
		},
	);

	router.get("/organizations/:slug/membership-products", async (c) => {
		try {
			if (!shopifyMembershipProductService) {
				throw new AppError("AES_ENCRYPTION_KEY is required.", 500);
			}

			const organization = await repository.findOrganizationBySlug(
				c.req.param("slug"),
			);
			if (!organization) {
				throw new AppError("Organization not found.", 404);
			}

			const membershipProducts =
				await shopifyMembershipProductService.listMembershipProductsForOrganization(
					organization,
				);

			return c.json({
				organization: {
					id: organization.id,
					slug: organization.slug,
					name: organization.name,
				},
				membershipProducts: membershipProducts.map(
					({
						shopifyProductGid: _shopifyProductGid,
						shopifyVariantGid: _shopifyVariantGid,
						...membershipProduct
					}) => membershipProduct,
				),
			});
		} catch (error) {
			if (
				error instanceof AppError &&
				error.status === 404 &&
				error.message === "Organization not found."
			) {
				return toJsonError(c, error);
			}

			console.error("Public membership product listing failed.", {
				operation: "shopify.membershipProducts.publicList",
				organizationSlug: c.req.param("slug"),
				errorName: error instanceof Error ? error.name : undefined,
				errorMessage: error instanceof Error ? error.message : undefined,
			});
			c.status(502);
			return c.json({
				error: PUBLIC_MEMBERSHIP_PRODUCTS_UNAVAILABLE_MESSAGE,
			});
		}
	});

	return router;
}
