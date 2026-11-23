import {
	type ImportConcertoRepertoireCsvRequestDto,
	ImportConcertoRepertoireCsvRequestSchema,
	type PreviewConcertoRepertoireCsvRequestDto,
	PreviewConcertoRepertoireCsvRequestSchema,
} from "@festival/common";
import type { Context } from "hono";
import { Hono } from "hono";
import {
	type ApiVariables,
	getRequiredTenant,
	requireAuth,
	requireTenant,
	requireTenantRole,
	toJsonError,
} from "../../auth/tenant-context.js";
import type { AuthVerifier } from "../../auth/types.js";
import { RepertoireService } from "../../domains/catalog-repertoire/index.js";
import {
	InMemoryRepertoireRepository,
	type RepertoireRepository,
} from "../../repertoire/index.js";
import type { OrganizationRepository } from "../../repo/organization-repository.js";
import {
	type CoLocatedRouteSecurity,
	defineRouteSecurity,
} from "../shared/route-security-metadata.js";
import { jsonValidator } from "../shared/schema-validator.js";
import { withAdminOrgJson } from "./admin-festival-catalog.routes.js";

const adminConcertoRoute = (
	method: CoLocatedRouteSecurity["method"],
	path: string,
) =>
	defineRouteSecurity({
		method,
		path,
		authenticationClass: "admin",
		csrfRequired: false,
		browserAllowed: true,
	});

export const ADMIN_CONCERTO_REPERTOIRE_ROUTE_SECURITY = [
	adminConcertoRoute(
		"GET",
		"/organizations/:slug/admin/concerto-repertoire/template",
	),
	adminConcertoRoute(
		"GET",
		"/organizations/:slug/admin/concerto-repertoire/export",
	),
	adminConcertoRoute(
		"POST",
		"/organizations/:slug/admin/concerto-repertoire/preview",
	),
	adminConcertoRoute(
		"POST",
		"/organizations/:slug/admin/concerto-repertoire/import",
	),
] as const satisfies readonly CoLocatedRouteSecurity[];

export interface AdminConcertoRepertoireRoutesOptions {
	authVerifier: AuthVerifier;
	repository: OrganizationRepository;
	repertoireService?: RepertoireService;
	repertoireRepository?: RepertoireRepository;
}

type ApiContext = Context<{ Variables: Partial<ApiVariables> }>;

function sanitizeCsvFilenameSlug(slug: string): string {
	return slug.replace(/[^A-Za-z0-9_-]/g, "-") || "organization";
}

function sendCsvAttachment(
	c: ApiContext,
	csvBody: string,
	filename: string,
): Response {
	return c.body(csvBody, 200, {
		"Content-Type": "text/csv; charset=utf-8",
		"Cache-Control": "no-store",
		"Content-Disposition": `attachment; filename="${filename}"`,
	});
}

async function handleExportConcertoCsv(
	c: ApiContext,
	service: RepertoireService,
): Promise<Response> {
	try {
		const tenant = getRequiredTenant(c);
		const csv = await service.exportConcertoCatalogCsv(tenant.organization.id);
		const slug = sanitizeCsvFilenameSlug(tenant.organization.slug);
		return sendCsvAttachment(c, csv, `${slug}-concerto-repertoire.csv`);
	} catch (error) {
		return toJsonError(c, error);
	}
}

function handlePreviewConcertoCsv(
	c: ApiContext,
	service: RepertoireService,
	payload: PreviewConcertoRepertoireCsvRequestDto,
) {
	c.header("Cache-Control", "no-store");
	return withAdminOrgJson(c, () =>
		service.previewConcertoCatalogCsv({
			organizationId: getRequiredTenant(c).organization.id,
			csvText: payload.csvText,
		}),
	);
}

function handleImportConcertoCsv(
	c: ApiContext,
	service: RepertoireService,
	payload: ImportConcertoRepertoireCsvRequestDto,
) {
	c.header("Cache-Control", "no-store");
	return withAdminOrgJson(c, () => {
		const tenant = getRequiredTenant(c);
		return service.importConcertoCatalogCsv({
			organizationId: tenant.organization.id,
			slug: tenant.organization.slug,
			csvText: payload.csvText,
			expectedCatalogDigest: payload.expectedCatalogDigest,
			confirmClearAll: payload.confirmClearAll,
		});
	});
}

export function buildAdminConcertoRepertoireRoutes(
	options: AdminConcertoRepertoireRoutesOptions,
) {
	const repo =
		options.repertoireRepository ?? new InMemoryRepertoireRepository();
	const service =
		options.repertoireService ?? new RepertoireService(repo, repo);
	const auth = requireAuth(options.authVerifier);
	const tenant = requireTenant(options.repository);
	const admin = requireTenantRole(["Admin"]);

	return new Hono<{ Variables: Partial<ApiVariables> }>()
		.get(
			"/organizations/:slug/admin/concerto-repertoire/template",
			auth,
			tenant,
			admin,
			(c) =>
				sendCsvAttachment(
					c,
					service.getConcertoCatalogCsvTemplate(),
					"concerto-repertoire-template.csv",
				),
		)
		.get(
			"/organizations/:slug/admin/concerto-repertoire/export",
			auth,
			tenant,
			admin,
			(c) => handleExportConcertoCsv(c, service),
		)
		.post(
			"/organizations/:slug/admin/concerto-repertoire/preview",
			auth,
			tenant,
			admin,
			jsonValidator(PreviewConcertoRepertoireCsvRequestSchema),
			(c) => handlePreviewConcertoCsv(c, service, c.req.valid("json")),
		)
		.post(
			"/organizations/:slug/admin/concerto-repertoire/import",
			auth,
			tenant,
			admin,
			jsonValidator(ImportConcertoRepertoireCsvRequestSchema),
			(c) => handleImportConcertoCsv(c, service, c.req.valid("json")),
		);
}
