export interface CreateFestivalClassInput {
	displayName: string;
	classSubtypeId: string;
	divisionId: string;
	minimumAge: number;
	maximumAge: number;
	price: string;
	maximumPerformancePieces?: 1 | 2 | 3;
	performanceMinutes: number;
	capacity?: number;
	isActive?: boolean;
	shopifyProductGid?: string;
	shopifyVariantGid?: string;
}

export interface UpdateFestivalClassInput {
	displayName?: string;
	minimumAge?: number;
	maximumAge?: number;
	price?: string;
	maximumPerformancePieces?: 1 | 2 | 3;
	performanceMinutes?: number;
	capacity?: number;
	isActive?: boolean;
	shopifyProductGid?: string;
	shopifyVariantGid?: string;
}
