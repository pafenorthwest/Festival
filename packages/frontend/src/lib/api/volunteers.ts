import type {
	CreateMessageTemplateInput,
	CreateVolunteerRoleInput,
	CreateVolunteerShiftInput,
	MessageChannel,
	MessageLog,
	MessageLogStatus,
	MessageTemplate,
	TriggerEventResult,
	TriggerMessageEventInput,
	UpdateMessageTemplateInput,
	UpdateVolunteerRoleInput,
	UpdateVolunteerShiftInput,
	VolunteerAssignment,
	VolunteerCoverageGapsResponse,
	VolunteerRecord,
	VolunteerRole,
	VolunteerScheduleEntry,
	VolunteerShift,
	VolunteerShiftListing,
} from "@festival/common";
import { hc } from "hono/client";
import type { VolunteersRoutesType } from "../../../../backend/dist/routes/api-router.js";
import {
	apiPrefix,
	createRpcFetch,
	resolveAuthToken,
	rpcCall,
} from "./client.js";

export type {
	BookShiftsInput,
	CoverageGapShift,
	CoverageGapsSummary,
	CreateMessageTemplateInput,
	CreateVolunteerRoleInput,
	CreateVolunteerShiftInput,
	EnrollVolunteerInput,
	MessageChannel,
	MessageLog,
	MessageLogStatus,
	MessageTemplate,
	ShiftCoverageEntry,
	ShiftPeriod,
	TriggerEventResult,
	TriggerMessageEventInput,
	UpdateMessageTemplateInput,
	UpdateVolunteerRoleInput,
	UpdateVolunteerShiftInput,
	VolunteerAssignment,
	VolunteerAssignmentStatus,
	VolunteerCoverageGapsResponse,
	VolunteerRecord,
	VolunteerRole,
	VolunteerScheduleEntry,
	VolunteerShift,
	VolunteerShiftListing,
} from "@festival/common";

const enc = encodeURIComponent;

function vp(slug: string, festivalShortName: string) {
	return { slug: enc(slug), festivalShortName: enc(festivalShortName) };
}

function volunteersClient(idToken?: string | null) {
	return hc<VolunteersRoutesType>(apiPrefix(true), {
		fetch: createRpcFetch({ idToken }),
	});
}

function festVol(idToken?: string | null) {
	return volunteersClient(idToken).organizations[":slug"].festivals[
		":festivalShortName"
	].volunteers;
}

function commRoot(idToken?: string | null) {
	return volunteersClient(idToken).organizations[":slug"].communication;
}

function compactQuery<T extends Record<string, string | undefined>>(
	entries: T,
): Partial<{ [K in keyof T]: string }> | undefined {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(entries)) {
		if (value !== undefined) out[key] = value;
	}
	return Object.keys(out).length > 0
		? (out as Partial<{ [K in keyof T]: string }>)
		: undefined;
}

function rpcQueryArgs<P, Q>(param: P, query?: Q): { param: P; query: Q } {
	return (query ? { param, query } : { param }) as { param: P; query: Q };
}

export function getVolunteerRoles(
	idToken: string,
	slug: string,
	festivalShortName: string,
): Promise<VolunteerRole[]> {
	const endpoint = festVol(idToken).roles;
	const param = vp(slug, festivalShortName);
	return rpcCall<VolunteerRole[]>(
		endpoint.$get({ param }),
		endpoint.$path({ param }),
	);
}

export function createVolunteerRole(
	idToken: string,
	slug: string,
	festivalShortName: string,
	input: CreateVolunteerRoleInput,
): Promise<VolunteerRole> {
	const endpoint = festVol(idToken).roles;
	const param = vp(slug, festivalShortName);
	return rpcCall<VolunteerRole>(
		endpoint.$post({ param, json: input }),
		endpoint.$path({ param }),
	);
}

export function getVolunteerShiftsForRole(
	idToken: string,
	slug: string,
	festivalShortName: string,
	roleId: string,
): Promise<VolunteerShift[]> {
	const endpoint = festVol(idToken).roles[":roleId"].shifts;
	const param = { ...vp(slug, festivalShortName), roleId: enc(roleId) };
	return rpcCall<VolunteerShift[]>(
		endpoint.$get({ param }),
		endpoint.$path({ param }),
	);
}

export function createVolunteerShift(
	idToken: string,
	slug: string,
	festivalShortName: string,
	roleId: string,
	input: CreateVolunteerShiftInput,
): Promise<VolunteerShift> {
	const endpoint = festVol(idToken).roles[":roleId"].shifts;
	const param = { ...vp(slug, festivalShortName), roleId: enc(roleId) };
	return rpcCall<VolunteerShift>(
		endpoint.$post({ param, json: input }),
		endpoint.$path({ param }),
	);
}

export function updateVolunteerRole(
	idToken: string,
	slug: string,
	festivalShortName: string,
	roleId: string,
	input: UpdateVolunteerRoleInput,
): Promise<VolunteerRole> {
	const endpoint = festVol(idToken).roles[":roleId"];
	const param = { ...vp(slug, festivalShortName), roleId: enc(roleId) };
	return rpcCall<VolunteerRole>(
		endpoint.$patch({ param, json: input }),
		endpoint.$path({ param }),
	);
}

export function deleteVolunteerRole(
	idToken: string,
	slug: string,
	festivalShortName: string,
	roleId: string,
): Promise<{ status: string }> {
	const endpoint = festVol(idToken).roles[":roleId"];
	const param = { ...vp(slug, festivalShortName), roleId: enc(roleId) };
	return rpcCall<{ status: string }>(
		endpoint.$delete({ param }),
		endpoint.$path({ param }),
	);
}

export function updateVolunteerShift(
	idToken: string,
	slug: string,
	festivalShortName: string,
	roleId: string,
	shiftId: string,
	input: UpdateVolunteerShiftInput,
): Promise<VolunteerShift> {
	const endpoint = festVol(idToken).roles[":roleId"].shifts[":shiftId"];
	const param = {
		...vp(slug, festivalShortName),
		roleId: enc(roleId),
		shiftId: enc(shiftId),
	};
	return rpcCall<VolunteerShift>(
		endpoint.$patch({ param, json: input }),
		endpoint.$path({ param }),
	);
}

export function deleteVolunteerShift(
	idToken: string,
	slug: string,
	festivalShortName: string,
	roleId: string,
	shiftId: string,
): Promise<{ status: string }> {
	const endpoint = festVol(idToken).roles[":roleId"].shifts[":shiftId"];
	const param = {
		...vp(slug, festivalShortName),
		roleId: enc(roleId),
		shiftId: enc(shiftId),
	};
	return rpcCall<{ status: string }>(
		endpoint.$delete({ param }),
		endpoint.$path({ param }),
	);
}

export async function listVolunteerShifts(
	slug: string,
	festivalShortName: string,
	options?: { availableOnly?: boolean; idToken?: string },
): Promise<VolunteerShiftListing[]> {
	const token = await resolveAuthToken(options?.idToken);
	const endpoint = festVol(token).shifts;
	const param = vp(slug, festivalShortName);
	const query = options?.availableOnly ? { available: "true" } : undefined;
	const args = rpcQueryArgs(param, query);
	return rpcCall<VolunteerShiftListing[]>(
		endpoint.$get(args),
		endpoint.$path(args),
	);
}

export async function bookVolunteerShifts(
	slug: string,
	festivalShortName: string,
	shiftIds: string[],
	idToken?: string,
): Promise<{ kind: string; assignments: VolunteerAssignment[] }> {
	const token = await resolveAuthToken(idToken);
	const endpoint = festVol(token).book;
	const param = vp(slug, festivalShortName);
	return rpcCall<{ kind: string; assignments: VolunteerAssignment[] }>(
		endpoint.$post({ param, json: { shiftIds } }),
		endpoint.$path({ param }),
	);
}

export async function getMyVolunteerSchedule(
	slug: string,
	festivalShortName: string,
	idToken?: string,
): Promise<VolunteerScheduleEntry[]> {
	const token = await resolveAuthToken(idToken);
	const endpoint = festVol(token)["my-schedule"];
	const param = vp(slug, festivalShortName);
	return rpcCall<VolunteerScheduleEntry[]>(
		endpoint.$get({ param }),
		endpoint.$path({ param }),
	);
}

export async function cancelVolunteerAssignment(
	slug: string,
	festivalShortName: string,
	assignmentId: string,
	idToken?: string,
): Promise<VolunteerAssignment> {
	const token = await resolveAuthToken(idToken);
	const endpoint = festVol(token).assignments[":assignmentId"].cancel;
	const param = {
		...vp(slug, festivalShortName),
		assignmentId: enc(assignmentId),
	};
	return rpcCall<VolunteerAssignment>(
		endpoint.$post({ param }),
		endpoint.$path({ param }),
	);
}

export async function getVolunteerCoverageGaps(
	slug: string,
	festivalShortName: string,
	idToken?: string,
): Promise<VolunteerCoverageGapsResponse> {
	const token = await resolveAuthToken(idToken);
	const endpoint = festVol(token)["coverage-gaps"];
	const param = vp(slug, festivalShortName);
	return rpcCall<VolunteerCoverageGapsResponse>(
		endpoint.$get({ param }),
		endpoint.$path({ param }),
	);
}

export async function enrollVolunteer(
	slug: string,
	festivalShortName: string,
	input: { name: string; phone: string },
	idToken?: string,
): Promise<VolunteerRecord> {
	const token = await resolveAuthToken(idToken);
	const endpoint = festVol(token).enroll;
	const param = vp(slug, festivalShortName);
	return rpcCall<VolunteerRecord>(
		endpoint.$post({ param, json: input }),
		endpoint.$path({ param }),
	);
}

export async function listCommunicationTemplates(
	slug: string,
	filters?: { channel?: MessageChannel; isActive?: boolean },
	idToken?: string,
): Promise<MessageTemplate[]> {
	const token = await resolveAuthToken(idToken);
	const endpoint = commRoot(token).templates;
	const param = { slug: enc(slug) };
	const query = compactQuery({
		channel: filters?.channel,
		isActive:
			filters?.isActive === undefined ? undefined : String(filters.isActive),
	});
	const args = rpcQueryArgs(param, query);
	return rpcCall<MessageTemplate[]>(endpoint.$get(args), endpoint.$path(args));
}

export async function createCommunicationTemplate(
	slug: string,
	input: CreateMessageTemplateInput,
	idToken?: string,
): Promise<MessageTemplate> {
	const token = await resolveAuthToken(idToken);
	const endpoint = commRoot(token).templates;
	const param = { slug: enc(slug) };
	return rpcCall<MessageTemplate>(
		endpoint.$post({ param, json: input }),
		endpoint.$path({ param }),
	);
}

export async function updateCommunicationTemplate(
	slug: string,
	templateId: string,
	input: UpdateMessageTemplateInput,
	idToken?: string,
): Promise<MessageTemplate> {
	const token = await resolveAuthToken(idToken);
	const endpoint = commRoot(token).templates[":templateId"];
	const param = { slug: enc(slug), templateId: enc(templateId) };
	return rpcCall<MessageTemplate>(
		endpoint.$patch({ param, json: input }),
		endpoint.$path({ param }),
	);
}

export async function listCommunicationLogs(
	slug: string,
	filters?: {
		channel?: MessageChannel;
		status?: MessageLogStatus;
		eventId?: string;
		limit?: number;
		offset?: number;
	},
	idToken?: string,
): Promise<MessageLog[]> {
	const token = await resolveAuthToken(idToken);
	const endpoint = commRoot(token).logs;
	const param = { slug: enc(slug) };
	const query = compactQuery({
		channel: filters?.channel,
		status: filters?.status,
		eventId: filters?.eventId,
		limit: filters?.limit !== undefined ? String(filters.limit) : undefined,
		offset: filters?.offset !== undefined ? String(filters.offset) : undefined,
	});
	const args = rpcQueryArgs(param, query);
	return rpcCall<MessageLog[]>(endpoint.$get(args), endpoint.$path(args));
}

export async function triggerCommunicationEvent(
	slug: string,
	input: TriggerMessageEventInput,
	idToken?: string,
): Promise<TriggerEventResult> {
	const token = await resolveAuthToken(idToken);
	const endpoint = commRoot(token).events;
	const param = { slug: enc(slug) };
	return rpcCall<TriggerEventResult>(
		endpoint.$post({ param, json: input }),
		endpoint.$path({ param }),
	);
}
