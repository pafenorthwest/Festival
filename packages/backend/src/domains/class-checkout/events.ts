export interface CheckoutIntentResolvedEvent {
	readonly type: "CheckoutIntentResolved";
	readonly organizationId: string;
	readonly customerId: string;
	readonly checkoutIntentId: string;
}

export interface ClassCapacityChangedEvent {
	readonly type: "ClassCapacityChanged";
	readonly organizationId: string;
	readonly festivalId: string;
	readonly festivalClassId: string;
}

export type ClassCheckoutDomainEvent =
	| CheckoutIntentResolvedEvent
	| ClassCapacityChangedEvent;

export type ClassCheckoutEventListener = (
	event: ClassCheckoutDomainEvent,
) => void;

export class ClassCheckoutEventBus {
	private readonly listeners = new Set<ClassCheckoutEventListener>();

	subscribe(listener: ClassCheckoutEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	emit(event: ClassCheckoutDomainEvent): void {
		for (const listener of [...this.listeners]) {
			listener(event);
		}
	}
}
