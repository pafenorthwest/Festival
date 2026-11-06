import {
	type MembershipProductSummary,
	validateMembershipProductInput,
} from "@festival/common";
import { createSignal, Show } from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { Button } from "../components/Button.js";
import { updateAdminMembershipProduct } from "../lib/api.js";

export interface AdminTeacherOfferingEditFormProps {
	app: FestivalAppController;
	offering: MembershipProductSummary;
	onClose: () => void;
	onSaved: () => void;
}

export const TEACHER_OFFERING_UPDATED_MESSAGE = "Membership offering updated.";

export function canEditTeacherOffering(
	offering: Pick<MembershipProductSummary, "isActive" | "entitlementClass">,
): boolean {
	return (
		offering.isActive && offering.entitlementClass === "teacher_membership"
	);
}

export function isTeacherOfferingPriceInvalid(
	attempted: boolean,
	price: string,
): boolean {
	const trimmed = price.trim();
	return (
		attempted && (!trimmed || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(trimmed))
	);
}

export function createTeacherOfferingEditState(
	props: AdminTeacherOfferingEditFormProps,
) {
	const [name, setName] = createSignal(props.offering.name);
	const [description, setDescription] = createSignal(
		props.offering.description ?? "",
	);
	const [price, setPrice] = createSignal(props.offering.price.amount);
	const [attempted, setAttempted] = createSignal(false);
	const [isSaving, setIsSaving] = createSignal(false);
	const [saveError, setSaveError] = createSignal("");

	const validation = () =>
		validateMembershipProductInput({
			name: name(),
			description: description(),
			price: price(),
		});

	const submit = async () => {
		setAttempted(true);
		setSaveError("");
		if (!validation().valid) return;
		const route = props.app.route();
		const user = props.app.firebaseUser();
		if (route.kind !== "org-admin-memberships" || !user) return;
		setIsSaving(true);
		try {
			await updateAdminMembershipProduct(
				await user.getIdToken(),
				route.slug,
				props.offering.id,
				{
					name: name().trim(),
					description: description().trim(),
					price: price().trim(),
				},
			);
			await props.app.loadMembershipProducts(route.slug);
			props.onSaved();
		} catch (error) {
			setSaveError(
				error instanceof Error && error.message
					? error.message
					: "Teacher membership offering could not be updated.",
			);
		} finally {
			setIsSaving(false);
		}
	};

	return {
		name,
		setName,
		description,
		setDescription,
		price,
		setPrice,
		attempted,
		isSaving,
		saveError,
		validation,
		nameInvalid: () => attempted() && !name().trim(),
		priceInvalid: () => isTeacherOfferingPriceInvalid(attempted(), price()),
		submit,
	};
}

export function AdminTeacherOfferingEditForm(
	props: AdminTeacherOfferingEditFormProps,
) {
	const state = createTeacherOfferingEditState(props);

	const handleSubmit = (event: SubmitEvent) => {
		event.preventDefault();
		void state.submit();
	};

	return (
		<form
			class="shopify-integration-card membership-admin-form"
			aria-label="Edit Teacher Membership"
			onSubmit={handleSubmit}
		>
			<div class="shopify-card-header">
				<div>
					<h3>Edit Teacher Membership</h3>
					<p>
						Update the active Shopify product details and Standard plan price.
					</p>
				</div>
			</div>
			<label class="field">
				<span>Membership name</span>
				<input
					type="text"
					value={state.name()}
					aria-invalid={state.nameInvalid()}
					onInput={(event) => state.setName(event.currentTarget.value)}
				/>
			</label>
			<label class="field">
				<span>Description</span>
				<textarea
					rows="4"
					value={state.description()}
					onInput={(event) => state.setDescription(event.currentTarget.value)}
				/>
			</label>
			<label class="field">
				<span>Annual price</span>
				<input
					type="text"
					inputmode="decimal"
					value={state.price()}
					aria-invalid={state.priceInvalid()}
					onInput={(event) => state.setPrice(event.currentTarget.value)}
				/>
			</label>
			<p class="muted">Teacher Membership · 365 days · Plan: Standard</p>
			<Show when={state.attempted() && !state.validation().valid}>
				<p class="shopify-error-text" role="alert">
					{state.validation().errors.join(" ")}
				</p>
			</Show>
			<Show when={state.saveError()}>
				<p class="shopify-error-text" role="alert">
					{state.saveError()}
				</p>
			</Show>
			<div class="admin-membership-header-actions">
				<Button type="submit" disabled={state.isSaving()}>
					{state.isSaving() ? "Saving…" : "Save Changes"}
				</Button>
				<Button
					type="button"
					variant="secondary"
					disabled={state.isSaving()}
					onClick={() => props.onClose()}
				>
					Cancel
				</Button>
			</div>
		</form>
	);
}
