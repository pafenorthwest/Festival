import {
	type CustomerClassRegistrationItem,
	type CustomerOrderSummary,
	doesClassRequireConcerto,
	type RepertoirePiece,
} from "@festival/common";
import { createSignal, For, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { Button } from "../components/Button.js";
import { FestivalRepertoireModal } from "../components/FestivalRepertoireModal.js";
import { useOptionalCustomerIdentity } from "../domains/customer/CustomerIdentityContext.js";
import {
	dropCustomerRegistration,
	getCustomerOrders,
	listCustomerClassRegistrations,
	listRegistrationEligibleClasses,
	transferCustomerRegistration,
	updateRegistrationMetadata,
} from "../lib/api.js";
import { CustomerAccountPageLayout } from "./CustomerAccountPageLayout.js";
import { CustomerDropRegistrationModal } from "./CustomerDropRegistrationModal.js";
import {
	type ClassOption,
	CustomerTransferRegistrationModal,
} from "./CustomerTransferRegistrationModal.js";
import {
	canEditPurchasedRegistration,
	getEditableRegistrationPieces,
} from "./PurchasedRegistrationHelpers.js";

interface RegistrationItemRecord extends CustomerClassRegistrationItem {
	entitlement: CustomerClassRegistrationItem["entitlement"] & {
		festivalSlug?: string;
		orderId?: string;
		divisionId?: string;
		teacherId?: string;
	};
	festivalClass?: NonNullable<
		CustomerClassRegistrationItem["festivalClass"]
	> & {
		festivalSlug?: string;
		festivalShortName?: string;
	};
	metadata?:
		| (NonNullable<CustomerClassRegistrationItem["metadata"]> & {
				teacherId?: string;
		  })
		| null;
	festivalSlug?: string;
	festivalShortName?: string;
	divisionId?: string;
	teacherId?: string;
}

function isRegistrationActiveOrWaitlisted(status?: string): boolean {
	const s = (status ?? "confirmed").toLowerCase();
	return s === "confirmed" || s === "waitlisted" || s === "active";
}

export function CustomerAccountOrdersPage(props: {
	app: FestivalAppController;
	slug: string;
}) {
	const customerIdentity = useOptionalCustomerIdentity();
	const [orders, setOrders] = createSignal<CustomerOrderSummary[]>([]);
	const [registrations, setRegistrations] = createSignal<
		RegistrationItemRecord[]
	>([]);
	const [next, setNext] = createSignal<string | null>(null);
	const [error, setError] = createSignal("");
	const [activeRegistration, setActiveRegistration] =
		createSignal<RegistrationItemRecord | null>(null);

	const [dropTarget, setDropTarget] =
		createSignal<RegistrationItemRecord | null>(null);
	const [transferTarget, setTransferTarget] =
		createSignal<RegistrationItemRecord | null>(null);
	const [availableTransferClasses, setAvailableTransferClasses] = createSignal<
		ClassOption[]
	>([]);
	const [isLoadingTransferClasses, setIsLoadingTransferClasses] =
		createSignal(false);
	const [isSubmittingAction, setIsSubmittingAction] = createSignal(false);
	const [actionError, setActionError] = createSignal<string | null>(null);

	async function loadOrders(after?: string) {
		try {
			const response = await getCustomerOrders(props.slug, after);
			setOrders((current) =>
				after ? [...current, ...response.orders] : response.orders,
			);
			setNext(
				response.pageInfo.hasNextPage ? response.pageInfo.endCursor : null,
			);
		} catch (err) {
			setError((err as Error).message);
		}
	}

	async function loadRegistrations() {
		try {
			const response = await listCustomerClassRegistrations(props.slug);
			setRegistrations(response.registrations);
			if (customerIdentity?.pendingCheckout.ownerSlug() === props.slug) {
				void customerIdentity.pendingCheckout.refresh();
			}
		} catch {
			// Handled gracefully in UI
		}
	}

	async function handleSaveRepertoire(
		target: CustomerClassRegistrationItem,
		savedPieces: RepertoirePiece[],
		csrfToken: string,
	) {
		const { festivalShortName, id } = target.entitlement;
		if (!festivalShortName || !canEditPurchasedRegistration(target)) {
			throw new Error("Editing is no longer available for this registration.");
		}
		const { metadata } = await updateRegistrationMetadata(
			props.slug,
			festivalShortName,
			id,
			csrfToken,
			{ pieces: savedPieces },
		);
		setRegistrations((current) =>
			current.map((registration) =>
				registration.entitlement.id === id && registration.metadata
					? {
							...registration,
							metadata: {
								...registration.metadata,
								repertoireJson: metadata.repertoireJson,
								repertoireItems: metadata.repertoireItems,
							},
						}
					: registration,
			),
		);
	}

	async function handleOpenTransfer(item: RegistrationItemRecord) {
		setTransferTarget(item);
		setActionError(null);
		const orderForEntitlement = item.entitlement.orderId
			? orders().find(
					(o) =>
						(o as { id?: string }).id === item.entitlement.orderId ||
						o.orderNumber === item.entitlement.orderId,
				)
			: undefined;
		const festivalSlugFromOrder =
			(
				orderForEntitlement as {
					festivalSlug?: string;
					festivalShortName?: string;
				}
			)?.festivalSlug ??
			(
				orderForEntitlement as {
					festivalSlug?: string;
					festivalShortName?: string;
				}
			)?.festivalShortName;
		const festivalSlug =
			item.entitlement.festivalSlug ??
			item.entitlement.festivalShortName ??
			festivalSlugFromOrder ??
			item.festivalClass?.festivalSlug ??
			item.festivalClass?.festivalShortName ??
			item.festivalSlug ??
			item.festivalShortName ??
			item.entitlement.festivalId;
		if (!festivalSlug) return;
		setIsLoadingTransferClasses(true);
		try {
			const divisionId =
				item.festivalClass?.divisionId ??
				item.entitlement.divisionId ??
				(item as { divisionId?: string }).divisionId;
			const teacherId =
				item.metadata?.teacherMembershipId ??
				item.metadata?.teacherId ??
				item.entitlement.teacherId ??
				(item as { teacherId?: string }).teacherId;
			const childId = item.child?.id ?? item.entitlement.childId;
			const res = await listRegistrationEligibleClasses(
				props.slug,
				festivalSlug,
				{
					childId,
					divisionId,
					teacherId,
				},
			);
			setAvailableTransferClasses(res.classes || []);
		} catch (err) {
			setActionError((err as Error).message);
		} finally {
			setIsLoadingTransferClasses(false);
		}
	}

	async function handleConfirmDrop(
		reason: string,
		requestRefund: boolean,
		csrfToken: string,
	) {
		const target = dropTarget();
		if (!target) return;
		setIsSubmittingAction(true);
		setActionError(null);
		try {
			await dropCustomerRegistration(
				props.slug,
				target.entitlement.id,
				{
					reason: reason || undefined,
					requestRefund,
					issueRefund: requestRefund,
				},
				csrfToken,
			);
			setDropTarget(null);
			await loadRegistrations();
		} catch (err) {
			setActionError((err as Error).message);
		} finally {
			setIsSubmittingAction(false);
		}
	}

	async function handleConfirmTransfer(
		targetFestivalClassId: string,
		reason: string,
		csrfToken: string,
	) {
		const target = transferTarget();
		if (!target) return;
		setIsSubmittingAction(true);
		setActionError(null);
		try {
			await transferCustomerRegistration(
				props.slug,
				target.entitlement.id,
				{ targetFestivalClassId, reason: reason || undefined },
				csrfToken,
			);
			setTransferTarget(null);
			await loadRegistrations();
		} catch (err) {
			setActionError((err as Error).message);
		} finally {
			setIsSubmittingAction(false);
		}
	}

	return (
		<CustomerAccountPageLayout
			slug={props.slug}
			onAuthenticated={() => {
				void loadOrders();
				void loadRegistrations();
			}}
		>
			{(session) => (
				<>
					<h1>Order History</h1>

					<section aria-labelledby="festival-registrations-heading">
						<h2 id="festival-registrations-heading">
							Festival class registrations
						</h2>
						<p class="muted">
							Manage your child's festival registrations and musical repertoire.
						</p>
						<Show
							when={registrations().length > 0}
							fallback={<p>No festival class registrations found.</p>}
						>
							<ul
								class="customer-registration-list"
								style="list-style: none; padding: 0; display: grid; gap: 1rem;"
							>
								<For each={registrations()}>
									{(item) => (
										<li class="panel flow-panel">
											<div class="division-row-heading">
												<div>
													<h3>
														{item.festivalClass?.displayName ??
															"Festival Class"}
													</h3>
													<Show when={item.entitlement.status}>
														<span
															class="badge"
															style="margin-top: 0.25rem; display: inline-block; text-transform: capitalize;"
														>
															{item.entitlement.status === "confirmed"
																? "Placed / Confirmed"
																: item.entitlement.status === "waitlisted"
																	? "Waitlisted (Paid)"
																	: item.entitlement.status}
														</span>
													</Show>
												</div>
												<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
													<Button
														type="button"
														variant="secondary"
														disabled={
															!item.entitlement.festivalShortName ||
															!canEditPurchasedRegistration(item)
														}
														onClick={() => {
															if (!canEditPurchasedRegistration(item)) return;
															setActiveRegistration(item);
														}}
													>
														Edit repertoire
													</Button>
													<Show
														when={
															props.app.isDropTransferEnabled() &&
															isRegistrationActiveOrWaitlisted(
																item.entitlement.status,
															)
														}
													>
														<Button
															type="button"
															variant="secondary"
															onClick={() => void handleOpenTransfer(item)}
														>
															Transfer
														</Button>
														<Button
															type="button"
															variant="secondary"
															onClick={() => {
																setActionError(null);
																setDropTarget(item);
															}}
														>
															Drop
														</Button>
													</Show>
												</div>
											</div>
											<p>
												Performer:{" "}
												<strong>{item.child?.name ?? "Performer"}</strong>
											</p>
											<Show when={item.metadata?.repertoireJson?.length}>
												<div>
													<strong>Pieces:</strong>
													<ul style="margin: 0.25rem 0 0 1.2rem;">
														<For each={item.metadata?.repertoireJson}>
															{(p) => (
																<li>
																	<em>{p.title}</em> by{" "}
																	<strong>{p.composer}</strong>
																	{p.movement ? ` (${p.movement})` : ""} ·{" "}
																	{Math.floor(p.durationSeconds / 60)}m{" "}
																	{p.durationSeconds % 60}s
																</li>
															)}
														</For>
													</ul>
												</div>
											</Show>
										</li>
									)}
								</For>
							</ul>
						</Show>
						<Show when={actionError()}>
							<p class="field-error" role="alert">
								{actionError()}
							</p>
						</Show>
					</section>

					<section aria-labelledby="shopify-orders-heading">
						<h2 id="shopify-orders-heading">Shopify orders</h2>
						<p class="muted">
							Shopify order and payment history is separate from Festival
							membership status.
						</p>
						<Show when={orders().length > 0} fallback={<p>No orders found.</p>}>
							<ul class="customer-order-list">
								<For each={orders()}>
									{(order) => (
										<li>
											<h3>Order {order.orderNumber}</h3>
											<p>
												{order.createdAtIso} · {order.total.amount}{" "}
												{order.total.currencyCode}
											</p>
											<p>
												Payment: {order.financialStatus ?? "Unknown"} ·
												Fulfillment: {order.fulfillmentStatus}
											</p>
											<Show when={order.cancellation}>
												<p>
													Cancelled:{" "}
													{order.cancellation?.reason ?? "No reason provided"}
												</p>
											</Show>
											<Show when={order.refund}>
												<p>
													Refunded: {order.refund?.total.amount}{" "}
													{order.refund?.total.currencyCode}
												</p>
											</Show>
											<ul>
												<For each={order.lineItems}>
													{(line) => (
														<li>
															{line.quantity} × {line.title}
															<Show when={line.total}>
																{(total) =>
																	` — ${total().amount} ${total().currencyCode}`
																}
															</Show>
														</li>
													)}
												</For>
											</ul>
										</li>
									)}
								</For>
							</ul>
						</Show>
						<Show when={next()} keyed>
							{(cursor) => (
								<Button
									type="button"
									variant="secondary"
									onClick={() => void loadOrders(cursor)}
								>
									Load more
								</Button>
							)}
						</Show>
					</section>
					<Show when={error()}>
						{(message) => (
							<p class="error-text" role="alert">
								{message()}
							</p>
						)}
					</Show>

					<Show when={activeRegistration()} keyed>
						{(item) => (
							<FestivalRepertoireModal
								organizationSlug={props.slug}
								festivalSlug={item.entitlement.festivalShortName ?? ""}
								maxPieces={item.festivalClass?.maximumPerformancePieces ?? 1}
								performanceMinutes={item.festivalClass?.performanceMinutes}
								initialPieces={getEditableRegistrationPieces(item)}
								suggestConcertos={doesClassRequireConcerto(item.festivalClass)}
								onSave={(saved) =>
									handleSaveRepertoire(item, saved, session.csrfToken)
								}
								onClose={() => setActiveRegistration(null)}
							/>
						)}
					</Show>

					<Show when={dropTarget()}>
						<CustomerDropRegistrationModal
							isOpen={Boolean(dropTarget())}
							registrationTitle={
								dropTarget()?.festivalClass?.displayName ?? "Festival Class"
							}
							performerName={dropTarget()?.child?.name}
							isWaitlisted={
								(dropTarget()?.entitlement.status ?? "").toLowerCase() ===
								"waitlisted"
							}
							isSubmitting={isSubmittingAction()}
							error={actionError()}
							onConfirm={(reason, refund) =>
								void handleConfirmDrop(reason, refund, session.csrfToken)
							}
							onClose={() => setDropTarget(null)}
						/>
					</Show>

					<Show when={transferTarget()}>
						<CustomerTransferRegistrationModal
							isOpen={Boolean(transferTarget())}
							registrationTitle={
								transferTarget()?.festivalClass?.displayName ?? "Festival Class"
							}
							performerName={transferTarget()?.child?.name}
							currentFestivalClassId={
								transferTarget()?.entitlement.festivalClassId ??
								transferTarget()?.festivalClass?.id
							}
							availableClasses={availableTransferClasses()}
							isLoadingClasses={isLoadingTransferClasses()}
							isSubmitting={isSubmittingAction()}
							error={actionError()}
							onConfirm={(targetClassId, reason) =>
								void handleConfirmTransfer(
									targetClassId,
									reason,
									session.csrfToken,
								)
							}
							onClose={() => setTransferTarget(null)}
						/>
					</Show>
				</>
			)}
		</CustomerAccountPageLayout>
	);
}
