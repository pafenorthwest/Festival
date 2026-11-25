import type { EffectiveAvailabilityDay } from "./availability.js";
import type { SchedulingConfiguration } from "./scheduling.js";
import type {
	SchedulingConfigurationPreview,
	SchedulingDiagnosticIssue,
	SchedulingPreviewContext,
} from "./scheduling-preview.js";

export interface SchedulingRosterAccompanist {
	membershipId: string;
	/** Resolved accompanist customer ID; null when the membership cannot be resolved. */
	customerId: string | null;
	name: string | null;
}

/** One confirmed class entitlement (registration) in the scheduling roster. */
export interface SchedulingRosterEntry {
	entitlementId: string;
	festivalClassId: string;
	childId: string;
	childName: string;
	/** Festival registration-age snapshot; null when no snapshot exists. */
	ageAtRegistration: number | null;
	teacherMembershipId: string | null;
	teacherName: string | null;
	accompanist: SchedulingRosterAccompanist | null;
	/** Confirmed repertoire total in seconds (informational; never used for timing). */
	repertoireSeconds: number;
	registeredAtIso: string;
}

/** A saved availability row. Child subjectId = childId; accompanist subjectId = customerId. */
export interface SchedulingAvailabilityRecord {
	subjectType: "child" | "accompanist";
	subjectId: string;
	festivalDate: string;
	availableHours: number[];
}

export interface SchedulingReadinessInput {
	config: SchedulingConfiguration;
	context: SchedulingPreviewContext;
	roster: readonly SchedulingRosterEntry[];
	availability: readonly SchedulingAvailabilityRecord[];
}

export interface SchedulingReadinessCodeDemand {
	code: string;
	classIds: string[];
	/** Scheduling entries (solo, concerto, ensemble primaries) in this code. */
	entryCount: number;
	/** Additional ensemble participants linked to this code's entries. */
	participantCount: number;
	limits: { min: number; max: number };
	/** ceil(entryCount / max); 0 when entryCount is 0. */
	minSections: number;
	/** floor(entryCount / min); 0 when entryCount is 0. */
	maxSections: number;
	/** True when entryCount is 0 or some whole k satisfies k*min <= n <= k*max. */
	feasible: boolean;
	/** Entry time plus one between-class gap per minimum section (gap part is 0 when infeasible). */
	estimatedSeconds: number;
}

export interface SchedulingReadinessEntry {
	entitlementId: string;
	festivalClassId: string;
	code: string | null;
	childId: string;
	childName: string;
	age: number | null;
	teacher: { membershipId: string | null; name: string | null } | null;
	accompanist: SchedulingRosterAccompanist | null;
	role: "entry" | "additional";
	/** For a validly paired additional participant, its primary entitlement. */
	primaryEntitlementId: string | null;
	/** For a scheduling entry, its validly paired additional participants. */
	participantEntitlementIds: string[];
	/** Any of the primary or its participants is at least 12 at registration. */
	hasAge12Plus: boolean;
	repertoireSeconds: number;
	registeredAtIso: string;
}

export interface SchedulingReadinessPerson {
	role: "student" | "accompanist";
	/** childId for students; accompanist customerId for accompanists. */
	subjectId: string;
	name: string | null;
	entitlementIds: string[];
	availableDayCount: number;
	days: EffectiveAvailabilityDay[];
	/** Three-day rule: stated availability constrains placement only when true. */
	enforced: boolean;
}

export interface SchedulingReadinessTotals {
	entryCount: number;
	participantCount: number;
	estimatedSeconds: number;
	wednesdayConcertoEstimatedSeconds: number;
}

export interface SchedulingReadiness {
	canGenerate: boolean;
	preview: SchedulingConfigurationPreview;
	blockingIssues: SchedulingDiagnosticIssue[];
	warnings: SchedulingDiagnosticIssue[];
	perCode: SchedulingReadinessCodeDemand[];
	entries: SchedulingReadinessEntry[];
	people: SchedulingReadinessPerson[];
	totals: SchedulingReadinessTotals;
}
