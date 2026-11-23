import type {
	ConcertoCsvAddedItemDto,
	ConcertoCsvCatalogItemDto,
	ConcertoCsvErrorField,
	ConcertoCsvFieldChangeDto,
	ConcertoCsvPreviewSummaryDto,
	ConcertoCsvUpdatedItemDto,
	ConcertoCsvValidationErrorDto,
	ConcertoRepertoireCsvImportResultDto,
	ConcertoRepertoireCsvPreviewDto,
	ImportConcertoRepertoireCsvRequestDto,
	PreviewConcertoRepertoireCsvRequestDto,
} from "@festival/common";
import { hc } from "hono/client";
import type { CatalogRoutesType } from "../../../../backend/dist/routes/api-router.js";
import { ApiError, apiPrefix, createRpcFetch } from "./client.js";

export type {
	ConcertoCsvAddedItemDto,
	ConcertoCsvCatalogItemDto,
	ConcertoCsvErrorField,
	ConcertoCsvFieldChangeDto,
	ConcertoCsvPreviewSummaryDto,
	ConcertoCsvUpdatedItemDto,
	ConcertoCsvValidationErrorDto,
	ConcertoRepertoireCsvImportResultDto,
	ConcertoRepertoireCsvPreviewDto,
	ImportConcertoRepertoireCsvRequestDto,
	PreviewConcertoRepertoireCsvRequestDto,
};

export interface ConcertoCsvApiErrorDetails {
	status: number;
	code?: string;
	catalogDigest?: string;
	errors?: ConcertoCsvValidationErrorDto[];
}

interface ConcertoErrorPayload {
	error?: string;
	code?: string;
	catalogDigest?: string;
	currentCatalogDigest?: string;
	errors?: ConcertoCsvValidationErrorDto[];
}

export class ConcertoCsvApiError extends ApiError {
	readonly catalogDigest?: string;
	readonly errors: ConcertoCsvValidationErrorDto[];

	constructor(message: string, details: ConcertoCsvApiErrorDetails) {
		super(message, details.status, details.code);
		this.name = "ConcertoCsvApiError";
		this.catalogDigest = details.catalogDigest;
		this.errors = details.errors ?? [];
	}
}

function concertoRepertoireClient(idToken: string) {
	return hc<CatalogRoutesType>(apiPrefix(true), {
		fetch: createRpcFetch({ idToken }),
	}).organizations[":slug"].admin["concerto-repertoire"];
}

const slugParam = (slug: string) => ({ slug: encodeURIComponent(slug) });

async function readConcertoErrorPayload(
	response: Response,
): Promise<ConcertoErrorPayload> {
	try {
		return (await response.json()) as ConcertoErrorPayload;
	} catch {
		return {};
	}
}

async function throwConcertoApiError(
	response: Response,
	fallbackPath: string,
): Promise<never> {
	const payload = await readConcertoErrorPayload(response);
	const rawDigest = payload.catalogDigest ?? payload.currentCatalogDigest;
	throw new ConcertoCsvApiError(
		payload.error ?? `Request failed for ${fallbackPath}`,
		{
			status: response.status,
			code: payload.code,
			catalogDigest: typeof rawDigest === "string" ? rawDigest : undefined,
			errors: Array.isArray(payload.errors) ? payload.errors : [],
		},
	);
}

async function unwrapConcertoCsvText(
	responsePromise: Promise<Response>,
	fallbackPath: string,
): Promise<string> {
	const response = await responsePromise;
	if (!response.ok) {
		return throwConcertoApiError(response, fallbackPath);
	}
	return response.text();
}

async function unwrapConcertoJson<T>(
	responsePromise: Promise<Response>,
	fallbackPath: string,
): Promise<T> {
	const response = await responsePromise;
	if (!response.ok) {
		return throwConcertoApiError(response, fallbackPath);
	}
	return (await response.json()) as T;
}

export function downloadConcertoRepertoireTemplateCsv(
	idToken: string,
	slug: string,
): Promise<string> {
	const endpoint = concertoRepertoireClient(idToken).template;
	const param = slugParam(slug);
	return unwrapConcertoCsvText(
		endpoint.$get({ param }),
		endpoint.$path({ param }),
	);
}

export function exportConcertoRepertoireCsv(
	idToken: string,
	slug: string,
): Promise<string> {
	const endpoint = concertoRepertoireClient(idToken).export;
	const param = slugParam(slug);
	return unwrapConcertoCsvText(
		endpoint.$get({ param }),
		endpoint.$path({ param }),
	);
}

export function previewConcertoRepertoireCsv(
	idToken: string,
	slug: string,
	csvText: string,
): Promise<ConcertoRepertoireCsvPreviewDto> {
	const endpoint = concertoRepertoireClient(idToken).preview;
	const param = slugParam(slug);
	return unwrapConcertoJson(
		endpoint.$post({ param, json: { csvText } }),
		endpoint.$path({ param }),
	);
}

export function importConcertoRepertoireCsv(
	idToken: string,
	slug: string,
	input: ImportConcertoRepertoireCsvRequestDto,
): Promise<ConcertoRepertoireCsvImportResultDto> {
	const endpoint = concertoRepertoireClient(idToken).import;
	const param = slugParam(slug);
	return unwrapConcertoJson(
		endpoint.$post({ param, json: input }),
		endpoint.$path({ param }),
	);
}
