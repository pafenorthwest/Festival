export interface RepertoirePiece {
	title: string;
	composer: string;
	movement?: string;
	durationSeconds: number;
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
	repertoireJson: RepertoirePiece[];
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
