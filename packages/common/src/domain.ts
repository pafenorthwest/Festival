export type PayerRole = "guardian" | "parent";

export interface PayerProfileInput {
	firstName: string;
	lastName: string;
	email: string;
	role: PayerRole;
}

export interface PayerProfile extends PayerProfileInput {
	id: string;
	shopifyCustomerId: string;
	createdAtIso: string;
}

export type ClassType = "solo" | "concert" | "ensemble" | "general";

export interface FestivalClass {
	id: string;
	title: string;
	classType: ClassType;
	priceCents: number;
	minParticipants: number;
	shopifyVariantId: string;
}

export interface StudentMetadata {
	externalStudentId: string;
	studentFullName: string;
	age: number;
	skillLevel: string;
	instrument: string;
	notes?: string;
}

export interface ClassPass {
	id: string;
	studentId: string;
	classId: string;
	passToken: string;
	metadata: StudentMetadata;
	createdAtIso: string;
}

export interface RegistrationSelection {
	classIds: string[];
	participantsByClass: Record<string, number>;
}

export interface EligibilityContext {
	studentId: string;
	allowedClassIds: string[];
}

export interface ValidationResult {
	valid: boolean;
	selectedClassIds: string[];
	errors: string[];
}

export interface CheckoutRequest {
	payerId: string;
	studentId: string;
	currency: string;
	selection: RegistrationSelection;
	eligibility: EligibilityContext;
}

export interface CheckoutResult {
	cartId: string;
	checkoutUrl: string;
	paymentIntentId: string;
	amountCents: number;
	providerMode: "live" | "mock";
}

export interface RefundRequest {
	orderId: string;
	paymentIntentId: string;
	amountCents: number;
	reason: string;
}

export interface RefundResult {
	shopifyRefundId: string;
	stripeRefundId: string;
	reconciled: boolean;
	providerMode: "live" | "mock";
}
