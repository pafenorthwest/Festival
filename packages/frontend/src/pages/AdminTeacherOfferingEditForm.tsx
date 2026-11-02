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

export function AdminTeacherOfferingEditForm(
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

	const handleSubmit = async (event: SubmitEvent) => {
		event.preventDefault();
		setAttempted(true);
		setSaveError("");
		const currentValidation = validation();
		if (!currentValidation.valid) return;
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

	return (
		<form
			class="shopify-integration-card membership-admin-form"
			aria-label="Edit Teacher Membership"
			onSubmit={(event) => void handleSubmit(event)}
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
					value={name()}
					aria-invalid={attempted() && !name().trim()}
					onInput={(event) => setName(event.currentTarget.value)}
				/>
			</label>
			<label class="field">
				<span>Description</span>
				<textarea
					rows="4"
					value={description()}
					onInput={(event) => setDescription(event.currentTarget.value)}
				/>
			</label>
			<label class="field">
				<span>Annual price</span>
				<input
					type="text"
					inputmode="decimal"
					value={price()}
					aria-invalid={attempted() && !validation().valid}
					onInput={(event) => setPrice(event.currentTarget.value)}
				/>
			</label>
			<p class="muted">Teacher Membership · 365 days · Plan: Standard</p>
			<Show when={attempted() && !validation().valid}>
				<p class="shopify-error-text" role="alert">
					{validation().errors.join(" ")}
				</p>
			</Show>
			<Show when={saveError()}>
				<p class="shopify-error-text" role="alert">
					{saveError()}
				</p>
			</Show>
			<div class="admin-membership-header-actions">
				<Button type="submit" disabled={isSaving()}>
					{isSaving() ? "Saving…" : "Save Changes"}
				</Button>
				<Button
					type="button"
					variant="secondary"
					disabled={isSaving()}
					onClick={() => props.onClose()}
				>
					Cancel
				</Button>
			</div>
		</form>
	);
}
