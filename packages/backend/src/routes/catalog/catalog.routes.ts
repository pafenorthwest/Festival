import { type Context, Hono } from "hono";
import {
	type ApiVariables,
	toJsonError,
} from "../../auth/tenant-context.js";
import { AppError } from "../../errors/app-error.js";
import type { PublicMembershipProductService } from "../../shopify/public-membership-product-service.js";

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

async function publicMembershipProductsHandler(
	c: Context<{ Variables: Partial<ApiVariables> }>,
	options: CatalogRoutesOptions,
): Promise<Response> {
	try {
		assertBodylessPublicRead(
			c.req.header("Authorization"),
			c.req.header("Content-Length"),
			c.req.raw.body !== null,
		);
		if (!options.publicMembershipProductService)
			throw new AppError("Membership information is unavailable.", 503);
		const slug = c.req.param("slug");
		if (!slug) throw new AppError("Organization is required.", 400);
		c.header("Cache-Control", "no-store");
		return c.json(await options.publicMembershipProductService.list(slug));
	} catch (error) {
		return toJsonError(c, error);
	}
}

export function buildCatalogRoutes(
	options: CatalogRoutesOptions,
): Hono<{ Variables: Partial<ApiVariables> }> {
	const router = new Hono<{ Variables: Partial<ApiVariables> }>();

	router.get("/membership-products", (c) =>
		publicMembershipProductsHandler(c, options),
	);

	router.on("HEAD", "/membership-products", async (c) => {
		const response = await publicMembershipProductsHandler(c, options);
		return new Response(null, {
			status: response.status,
			headers: response.headers,
		});
	});

	return router;
}
