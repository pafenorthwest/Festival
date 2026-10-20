import type {
	AccompanistContactSnapshot,
	CustomerMailingAddress,
	OrganizationRole,
} from "@festival/common";

export interface SeedAdminUserFixture {
	uid: string;
	email: string;
	displayName: string;
	role: OrganizationRole;
}

export interface SeedSubtypeFixture {
	displayName: string;
	requiredSubtypeName?: string;
}

export interface SeedFestivalFixture {
	id: string;
	code: string;
	shortName: string;
	name: string;
	startDate: string;
	endDate: string;
	isPrimary: boolean;
}

export interface SeedTeacherFixture {
	shopifyCustomerGid: string;
	name: string;
	email: string;
	phone: string;
	mailingAddress: CustomerMailingAddress;
	divisionName: string;
	paidAmount: string;
	paidCurrencyCode: string;
	checkoutIntentId: string;
	shopifyOrderGid: string;
	shopifyOrderLineGid: string;
}

export interface SeedAccompanistFixture {
	shopifyCustomerGid: string;
	contact: AccompanistContactSnapshot;
	mailingAddress: CustomerMailingAddress;
	divisionNames: string[];
}

export interface SeedClassFixture {
	displayName: string;
	divisionName: string;
	subtypeName: string;
	minimumAge: number;
	maximumAge: number;
	price: string;
	maximumPerformancePieces: 1 | 2 | 3;
	performanceMinutes: number;
	capacity: number;
	shopifyProductGid: string;
	shopifyVariantGid: string;
}

export interface SeedOrganizationFixture {
	name: string;
	slug: string;
	timezone: string;
	defaultCurrencyCode: string;
	registrationAgeDate: string;
	adminUsers: SeedAdminUserFixture[];
	divisions: string[];
	subtypes: SeedSubtypeFixture[];
	festival: SeedFestivalFixture;
	teacherOffering: {
		durationDays: number;
		shopifyProductGid: string;
		shopifyVariantGid: string;
		productNameSnapshot: string;
	};
	teachers: SeedTeacherFixture[];
	accompanists: SeedAccompanistFixture[];
	classes: SeedClassFixture[];
}

export const TEST_DATA_ORGANIZATIONS: readonly SeedOrganizationFixture[] = [
	{
		name: "PAFE Northwest",
		slug: "pafe-northwest",
		timezone: "America/Los_Angeles",
		defaultCurrencyCode: "USD",
		registrationAgeDate: "2026-09-01",
		adminUsers: [
			{
				uid: "seed-admin-pafe-1",
				email: "admin@pafe-northwest.example.org",
				displayName: "Elena Vance",
				role: "Admin",
			},
			{
				uid: "seed-chair-pafe-1",
				email: "chair@pafe-northwest.example.org",
				displayName: "Marcus Sterling",
				role: "Division Chair",
			},
		],
		divisions: ["Piano", "Strings", "Voice", "Woodwinds"],
		subtypes: [
			{ displayName: "Solo" },
			{ displayName: "Concerto", requiredSubtypeName: "Solo" },
			{ displayName: "Sonata" },
			{ displayName: "Duets" },
		],
		festival: {
			id: "11111111-1111-4111-8111-111111111101",
			code: "pafe26",
			shortName: "spring-2026",
			name: "PAFE Spring Festival 2026",
			startDate: "2026-11-10",
			endDate: "2026-11-20",
			isPrimary: true,
		},
		teacherOffering: {
			durationDays: 365,
			shopifyProductGid: "gid://shopify/Product/9001001",
			shopifyVariantGid: "gid://shopify/ProductVariant/900100101",
			productNameSnapshot: "PAFE Teacher Membership 2026",
		},
		teachers: [
			{
				shopifyCustomerGid: "gid://shopify/Customer/8001001",
				name: "Dr. Clara Schumann",
				email: "clara.schumann@pafe-teachers.example.org",
				phone: "+1 (206) 555-0101",
				mailingAddress: {
					line1: "400 Symphony Way",
					city: "Seattle",
					region: "WA",
					postalCode: "98101",
					countryCode: "US",
				},
				divisionName: "Piano",
				paidAmount: "65.00",
				paidCurrencyCode: "USD",
				checkoutIntentId: "seed-intent-pafe-t1",
				shopifyOrderGid: "gid://shopify/Order/9100101",
				shopifyOrderLineGid: "gid://shopify/LineItem/9100101",
			},
			{
				shopifyCustomerGid: "gid://shopify/Customer/8001002",
				name: "Prof. Nadia Boulanger",
				email: "nadia.boulanger@pafe-teachers.example.org",
				phone: "+1 (206) 555-0102",
				mailingAddress: {
					line1: "712 Conservatory Ave",
					city: "Bellevue",
					region: "WA",
					postalCode: "98004",
					countryCode: "US",
				},
				divisionName: "Piano",
				paidAmount: "65.00",
				paidCurrencyCode: "USD",
				checkoutIntentId: "seed-intent-pafe-t2",
				shopifyOrderGid: "gid://shopify/Order/9100102",
				shopifyOrderLineGid: "gid://shopify/LineItem/9100102",
			},
			{
				shopifyCustomerGid: "gid://shopify/Customer/8001003",
				name: "Prof. Ivan Galamian",
				email: "ivan.galamian@pafe-teachers.example.org",
				phone: "+1 (206) 555-0103",
				mailingAddress: {
					line1: "905 Strings Court",
					city: "Seattle",
					region: "WA",
					postalCode: "98104",
					countryCode: "US",
				},
				divisionName: "Strings",
				paidAmount: "65.00",
				paidCurrencyCode: "USD",
				checkoutIntentId: "seed-intent-pafe-t3",
				shopifyOrderGid: "gid://shopify/Order/9100103",
				shopifyOrderLineGid: "gid://shopify/LineItem/9100103",
			},
			{
				shopifyCustomerGid: "gid://shopify/Customer/8001004",
				name: "Mme. Pauline Viardot",
				email: "pauline.viardot@pafe-teachers.example.org",
				phone: "+1 (206) 555-0104",
				mailingAddress: {
					line1: "215 Aria Place",
					city: "Kirkland",
					region: "WA",
					postalCode: "98033",
					countryCode: "US",
				},
				divisionName: "Voice",
				paidAmount: "65.00",
				paidCurrencyCode: "USD",
				checkoutIntentId: "seed-intent-pafe-t4",
				shopifyOrderGid: "gid://shopify/Order/9100104",
				shopifyOrderLineGid: "gid://shopify/LineItem/9100104",
			},
		],
		accompanists: [
			{
				shopifyCustomerGid: "gid://shopify/Customer/8002001",
				contact: {
					name: "Gerald Moore",
					email: "gerald.moore@pafe-accompanists.example.org",
					city: "Seattle",
					phone: "+1 (206) 555-0201",
				},
				mailingAddress: {
					line1: "120 Encore Blvd",
					city: "Seattle",
					region: "WA",
					postalCode: "98102",
					countryCode: "US",
				},
				divisionNames: ["Piano", "Strings", "Voice"],
			},
			{
				shopifyCustomerGid: "gid://shopify/Customer/8002002",
				contact: {
					name: "Martin Katz",
					email: "martin.katz@pafe-accompanists.example.org",
					city: "Tacoma",
					phone: "+1 (253) 555-0202",
				},
				mailingAddress: {
					line1: "88 Harmony Lane",
					city: "Tacoma",
					region: "WA",
					postalCode: "98402",
					countryCode: "US",
				},
				divisionNames: ["Voice", "Woodwinds"],
			},
		],
		classes: [
			{
				displayName: "Junior Piano Solo (Ages 8-11)",
				divisionName: "Piano",
				subtypeName: "Solo",
				minimumAge: 8,
				maximumAge: 11,
				price: "45.00",
				maximumPerformancePieces: 2,
				performanceMinutes: 8,
				capacity: 25,
				shopifyProductGid: "gid://shopify/Product/9002001",
				shopifyVariantGid: "gid://shopify/ProductVariant/900200101",
			},
			{
				displayName: "Senior Piano Concerto (Ages 12-18)",
				divisionName: "Piano",
				subtypeName: "Concerto",
				minimumAge: 12,
				maximumAge: 18,
				price: "60.00",
				maximumPerformancePieces: 1,
				performanceMinutes: 15,
				capacity: 15,
				shopifyProductGid: "gid://shopify/Product/9002002",
				shopifyVariantGid: "gid://shopify/ProductVariant/900200201",
			},
			{
				displayName: "Strings Sonata (Ages 10-16)",
				divisionName: "Strings",
				subtypeName: "Sonata",
				minimumAge: 10,
				maximumAge: 16,
				price: "50.00",
				maximumPerformancePieces: 2,
				performanceMinutes: 12,
				capacity: 20,
				shopifyProductGid: "gid://shopify/Product/9002003",
				shopifyVariantGid: "gid://shopify/ProductVariant/900200301",
			},
			{
				displayName: "Voice Classical Solo (Ages 12-18)",
				divisionName: "Voice",
				subtypeName: "Solo",
				minimumAge: 12,
				maximumAge: 18,
				price: "48.00",
				maximumPerformancePieces: 2,
				performanceMinutes: 10,
				capacity: 18,
				shopifyProductGid: "gid://shopify/Product/9002004",
				shopifyVariantGid: "gid://shopify/ProductVariant/900200401",
			},
		],
	},
	{
		name: "Cascadia Music Guild",
		slug: "cascadia-music",
		timezone: "America/Los_Angeles",
		defaultCurrencyCode: "USD",
		registrationAgeDate: "2026-10-01",
		adminUsers: [
			{
				uid: "seed-admin-cascadia-1",
				email: "director@cascadia-music.example.org",
				displayName: "Arthur Pendelton",
				role: "Admin",
			},
		],
		divisions: ["Piano", "Strings", "Voice", "Woodwinds"],
		subtypes: [
			{ displayName: "Solo" },
			{ displayName: "Concerto", requiredSubtypeName: "Solo" },
			{ displayName: "Sonata" },
			{ displayName: "Duets" },
		],
		festival: {
			id: "22222222-2222-4222-8222-222222222202",
			code: "cas26a",
			shortName: "autumn-2026",
			name: "Cascadia Autumn Showcase 2026",
			startDate: "2026-12-01",
			endDate: "2026-12-10",
			isPrimary: true,
		},
		teacherOffering: {
			durationDays: 365,
			shopifyProductGid: "gid://shopify/Product/9003001",
			shopifyVariantGid: "gid://shopify/ProductVariant/900300101",
			productNameSnapshot: "Cascadia Teacher Membership 2026",
		},
		teachers: [
			{
				shopifyCustomerGid: "gid://shopify/Customer/8003001",
				name: "Dr. Leopold Auer",
				email: "leopold.auer@cascadia-teachers.example.org",
				phone: "+1 (503) 555-0301",
				mailingAddress: {
					line1: "55 Violin Way",
					city: "Portland",
					region: "OR",
					postalCode: "97201",
					countryCode: "US",
				},
				divisionName: "Strings",
				paidAmount: "55.00",
				paidCurrencyCode: "USD",
				checkoutIntentId: "seed-intent-cascadia-t1",
				shopifyOrderGid: "gid://shopify/Order/9200101",
				shopifyOrderLineGid: "gid://shopify/LineItem/9200101",
			},
			{
				shopifyCustomerGid: "gid://shopify/Customer/8003002",
				name: "Prof. Marcel Moyse",
				email: "marcel.moyse@cascadia-teachers.example.org",
				phone: "+1 (503) 555-0302",
				mailingAddress: {
					line1: "140 Flute Terrace",
					city: "Portland",
					region: "OR",
					postalCode: "97205",
					countryCode: "US",
				},
				divisionName: "Woodwinds",
				paidAmount: "55.00",
				paidCurrencyCode: "USD",
				checkoutIntentId: "seed-intent-cascadia-t2",
				shopifyOrderGid: "gid://shopify/Order/9200102",
				shopifyOrderLineGid: "gid://shopify/LineItem/9200102",
			},
		],
		accompanists: [
			{
				shopifyCustomerGid: "gid://shopify/Customer/8004001",
				contact: {
					name: "Graham Johnson",
					email: "graham.johnson@cascadia-accompanists.example.org",
					city: "Portland",
					phone: "+1 (503) 555-0401",
				},
				mailingAddress: {
					line1: "310 Lieder Court",
					city: "Portland",
					region: "OR",
					postalCode: "97204",
					countryCode: "US",
				},
				divisionNames: ["Piano", "Strings", "Voice"],
			},
		],
		classes: [
			{
				displayName: "Cascadia Strings Solo (Ages 7-12)",
				divisionName: "Strings",
				subtypeName: "Solo",
				minimumAge: 7,
				maximumAge: 12,
				price: "42.00",
				maximumPerformancePieces: 2,
				performanceMinutes: 10,
				capacity: 20,
				shopifyProductGid: "gid://shopify/Product/9004001",
				shopifyVariantGid: "gid://shopify/ProductVariant/900400101",
			},
			{
				displayName: "Cascadia Piano Duets (Ages 9-15)",
				divisionName: "Piano",
				subtypeName: "Duets",
				minimumAge: 9,
				maximumAge: 15,
				price: "52.00",
				maximumPerformancePieces: 1,
				performanceMinutes: 10,
				capacity: 12,
				shopifyProductGid: "gid://shopify/Product/9004002",
				shopifyVariantGid: "gid://shopify/ProductVariant/900400201",
			},
		],
	},
];
