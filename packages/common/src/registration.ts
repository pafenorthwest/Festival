export interface RepertoirePiece {
	title: string;
	composer: string;
	movement?: string | null;
	/** Positive whole seconds. */
	durationSeconds: number;
}

/** Roles supported by an organization-owned repertoire catalog. */
export type RepertoireContributorRole =
	| "Composer"
	| "Copyist"
	| "Editor"
	| "Arranger"
	| "Transcriber"
	| "Realizer"
	| "Orchestrator";

/**
 * An immutable name-and-role snapshot. catalogContributorId may be absent for
 * a free-text contributor that has not been added to the organization's catalog.
 */
export interface RegistrationRepertoireItemContributor {
	id: string;
	displayOrder: 1 | 2 | 3;
	role: RepertoireContributorRole;
	displayNameSnapshot: string;
	catalogContributorId: string | null;
}

/**
 * One performed work submitted with a registration. Display fields are copied
 * at submission time so catalog edits never rewrite historical registrations.
 */
export interface RegistrationRepertoireItem {
	id: string;
	registrationMetadataId: string;
	organizationId: string;
	displayOrder: number;
	catalogWorkId: string | null;
	titleSnapshot: string;
	performedMovementText: string | null;
	/** Positive whole seconds. */
	durationSeconds: number;
	contributors: RegistrationRepertoireItemContributor[];
}

export interface ClassRegistrationRequest {
	childId: string;
	divisionId: string;
	festivalClassId: string;
	teacherId: string;
	accompanistId?: string;
	pieces: RepertoirePiece[];
	buyerAccessToken: string;
}

export interface ClassRegistrationMetadata {
	id: string;
	organizationId: string;
	festivalId: string;
	checkoutIntentId: string;
	classEntitlementId: string | null;
	teacherMembershipId: string;
	accompanistMembershipId: string | null;
	/** Legacy raw submission retained during the relational-repertoire transition. */
	repertoireJson: RepertoirePiece[];
	repertoireItems: RegistrationRepertoireItem[];
	createdAt: Date;
}

export interface FestivalClassConfigurationDto {
	id: string;
	organizationId: string;
	festivalId: string;
	displayName: string;
	classSubtypeId: string;
	divisionId: string;
	minimumAge: number;
	maximumAge: number;
	price: string;
	maximumPerformancePieces: 1 | 2 | 3;
	performanceMinutes: number;
	capacity: number;
	isActive: boolean;
	shopifyProductGid: string;
	shopifyVariantGid: string;
	createdAt: Date;
	updatedAt: Date;
}
