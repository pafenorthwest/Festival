import type {
	PublicDirectoryProfileDto,
	TeacherProfileRecord,
	UpdateAdminTeacherProfileApprovalInput,
	UpsertCustomerTeacherProfileInput,
} from "@festival/common";
import { hc } from "hono/client";
import type { DirectoryRoutesType } from "../../../../backend/dist/routes/api-router.js";
import {
	ApiError,
	apiPrefix,
	createRpcFetch,
	rpcCall,
	unwrapRpcResponse,
} from "./client.js";

export type {
	ProfileApprovalStatus,
	PublicDirectoryProfileDto,
	TeacherProfileRecord,
	UpdateAdminTeacherProfileApprovalInput,
	UpsertCustomerTeacherProfileInput,
} from "@festival/common";

function createDirectoryClient(options?: {
	useApiBase?: boolean;
	idToken?: string;
	extraHeaders?: Record<string, string>;
}) {
	return hc<DirectoryRoutesType>(apiPrefix(options?.useApiBase ?? true), {
		fetch: createRpcFetch({
			idToken: options?.idToken,
			extraHeaders: options?.extraHeaders,
		}),
	});
}

function directoryUrl(routePath: string, useApiBase: boolean): string {
	return `${apiPrefix(useApiBase)}${routePath}`;
}

export async function getPublicDirectoryProfiles(
	orgSlug: string,
): Promise<PublicDirectoryProfileDto[]> {
	const param = { orgSlug: encodeURIComponent(orgSlug) };
	const endpoint = createDirectoryClient({ useApiBase: false })["org-info"][
		":orgSlug"
	].directory.profiles;
	return rpcCall<PublicDirectoryProfileDto[]>(
		// Omit explicit GET override so Fetch defaults to GET for existing test mocks.
		endpoint.$get({ param }, { init: { method: undefined } }),
		directoryUrl(endpoint.$path({ param }), false),
	);
}

export async function getCustomerTeacherProfile(
	orgSlug: string,
): Promise<TeacherProfileRecord | null> {
	const param = { orgSlug: encodeURIComponent(orgSlug) };
	const endpoint = createDirectoryClient({ useApiBase: false }).customer.orgs[
		":orgSlug"
	].profiles.teacher;
	try {
		return await rpcCall<TeacherProfileRecord>(
			endpoint.$get({ param }),
			directoryUrl(endpoint.$path({ param }), false),
		);
	} catch (error) {
		if (error instanceof ApiError && error.status === 404) {
			return null;
		}
		throw error;
	}
}

export async function upsertCustomerTeacherProfile(
	orgSlug: string,
	csrfToken: string,
	input: UpsertCustomerTeacherProfileInput,
): Promise<TeacherProfileRecord> {
	const param = { orgSlug: encodeURIComponent(orgSlug) };
	const endpoint = createDirectoryClient({
		useApiBase: false,
		extraHeaders: { "X-CSRF-Token": csrfToken },
	}).customer.orgs[":orgSlug"].profiles.teacher;
	return rpcCall<TeacherProfileRecord>(
		endpoint.$put({ param, json: input }),
		directoryUrl(endpoint.$path({ param }), false),
	);
}

export async function listAdminTeacherProfiles(
	idToken: string,
	orgSlug: string,
): Promise<TeacherProfileRecord[]> {
	const param = { orgSlug: encodeURIComponent(orgSlug) };
	const endpoint = createDirectoryClient({ useApiBase: true, idToken }).admin
		.orgs[":orgSlug"].profiles.teachers;
	return rpcCall<TeacherProfileRecord[]>(
		endpoint.$get({ param }),
		directoryUrl(endpoint.$path({ param }), true),
	);
}

export async function updateAdminTeacherProfileApproval(
	idToken: string,
	orgSlug: string,
	input: UpdateAdminTeacherProfileApprovalInput,
): Promise<TeacherProfileRecord> {
	const client = createDirectoryClient({ useApiBase: true, idToken });
	const param = {
		orgSlug: encodeURIComponent(orgSlug),
		profileId: encodeURIComponent(input.profileId),
	};
	const endpoint =
		client.admin.orgs[":orgSlug"].profiles.teachers[":profileId"].approval;
	const response = await endpoint.$patch({
		param,
		json: { approvalStatus: input.approvalStatus },
	});
	return unwrapRpcResponse<TeacherProfileRecord>(
		response,
		directoryUrl(endpoint.$path({ param }), true),
	);
}
