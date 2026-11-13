export type DomainCacheInvalidationEvent =
	| {
			type: "OrgUpdated";
			organizationId: string;
			slug?: string;
	  }
	| {
			type: "RegistrationAgeConfigUpdated";
			organizationId: string;
			slug?: string;
	  }
	| {
			type: "FestivalCatalogUpdated";
			organizationId: string;
			slug?: string;
			festivalId?: string;
	  }
	| {
			type: "ShopifySecretRotated";
			organizationId?: string;
			slug?: string;
			integrationVersion?: number;
	  }
	| {
			type: "MembershipChanged";
			organizationId: string;
			slug?: string;
			customerId?: string;
	  }
	| {
			type: "CachesCleared";
	  };

export type DomainCacheInvalidationListener = (
	event: DomainCacheInvalidationEvent,
) => void;

export class DomainCacheInvalidator {
	private readonly listeners = new Set<DomainCacheInvalidationListener>();
	private clearing = false;

	subscribe(listener: DomainCacheInvalidationListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	emit(event: DomainCacheInvalidationEvent): void {
		if (event.type === "CachesCleared") {
			this.clearAll();
			return;
		}
		for (const listener of [...this.listeners]) {
			listener(event);
		}
	}

	clearAll(): void {
		if (this.clearing) return;
		this.clearing = true;
		try {
			const event: DomainCacheInvalidationEvent = { type: "CachesCleared" };
			for (const listener of [...this.listeners]) {
				listener(event);
			}
		} finally {
			this.clearing = false;
		}
	}
}
