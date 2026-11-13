import { type Context, Hono } from "hono";
import { type ApiVariables, toJsonError } from "../../auth/tenant-context.js";
import { AppError } from "../../errors/app-error.js";
import type { PublicMembershipProductService } from "../../shopify/public-membership-product-service.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "../shared/route-security-metadata.js";

export const CATALOG_ROUTE_SECURITY = [
	defineRouteSecurity({
		method: "GET",
		path: "/membership-products",
		authenticationClass: "public",
		csrfRequired: false,
		browserAllowed: true,
	}),
	defineRouteSecurity({
		method: "HEAD",
		path: "/membership-products",
		authenticationClass: "public",
		csrfRequired: false,
		browserAllowed: true,
	}),
] as const satisfies readonly CoLocatedRouteSecurity[];

function assertBodylessPublicRead(
	authorization: string | undefined,
	contentLength: string | undefined,
	hasBody: boolean,
): void {
	if (authorization !== undefined) {
		throw new AppError(
			"Authorization is not accepted on this public route.",
			400,
		);
	}
	if (hasBody || (contentLength !== undefined && !/^0+$/.test(contentLength))) {
		throw new AppError(
			"Request body is not accepted on this public route.",
			400,
		);
	}
}

export interface CatalogRoutesOptions {
	publicMembershipProductService?: PublicMembershipProductService;
}

async function handlePublicMembershipProducts(
	c: Context<{ Variables: Partial<ApiVariables> }>,
	options: CatalogRoutesOptions,
) {
	try {
		assertBodylessPublicRead(
			c.req.header("Authorization"),
			c.req.header("Content-Length"),
			c.req.raw.body !== null,
		);
		if (!options.publicMembershipProductService) {
			throw new AppError("Membership information is unavailable.", 503);
		}
		const slug = c.req.param("slug");
		if (!slug) throw new AppError("Organization is required.", 400);
		c.header("Cache-Control", "no-store");
		return c.json(await options.publicMembershipProductService.list(slug));
	} catch (error) {
		return toJsonError(c, error);
	}
}

async function handlePublicMembershipProductsHead(
	c: Context<{ Variables: Partial<ApiVariables> }>,
	options: CatalogRoutesOptions,
) {
	const response = await handlePublicMembershipProducts(c, options);
	return new Response(null, {
		status: response.status,
		headers: response.headers,
	});
}

export function buildCatalogRoutes(options: CatalogRoutesOptions) {
	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get("/membership-products", (c) =>
			handlePublicMembershipProducts(c, options),
		)
		.on("HEAD", "/membership-products", (c) =>
			handlePublicMembershipProductsHead(c, options),
		);
}
