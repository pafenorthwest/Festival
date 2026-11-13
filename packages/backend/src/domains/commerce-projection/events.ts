export interface ShopifySecretRotatedEvent {
	readonly type: "ShopifySecretRotated";
	readonly organizationId?: string;
	readonly slug?: string;
	readonly integrationVersion?: number;
}

export interface OrderProjectedEvent {
	readonly type: "OrderProjected";
	readonly organizationId: string;
	readonly shopifyOrderGid: string;
	readonly customerId?: string;
}

export type CommerceProjectionDomainEvent =
	| ShopifySecretRotatedEvent
	| OrderProjectedEvent;

export type CommerceProjectionEventListener = (
	event: CommerceProjectionDomainEvent,
) => void;

export class CommerceProjectionEventBus {
	private readonly listeners = new Set<CommerceProjectionEventListener>();

	subscribe(listener: CommerceProjectionEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	emit(event: CommerceProjectionDomainEvent): void {
		for (const listener of [...this.listeners]) {
			listener(event);
		}
	}
}
