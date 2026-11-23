// biome-ignore-all lint/a11y/useSemanticElements: Listing tables use the shared grid layout with explicit table roles.
// biome-ignore-all lint/a11y/useFocusableInteractive: Table rows and headers are static. The controls inside them are focusable.
import type {
	EntitlementReportDivisionOption,
	EntitlementReportEntry,
	ProfileApprovalStatus,
} from "@festival/common";
import { createSignal, For, Show } from "solid-js";
import {
	canRevokeEntitlement,
	entitlementStatusBadgeClass,
	formatEntitlementClass,
	formatEntitlementCustomer,
	formatEntitlementDivisions,
	formatEntitlementStatus,
} from "./adminEntitlementReportHelpers.js";

interface AdminEntitlementTableProps {
	entries: readonly EntitlementReportEntry[];
	editableDivisions: readonly EntitlementReportDivisionOption[];
	hasFilters: boolean;
	canEdit: boolean;
	mutationPending: boolean;
	onMutationPendingChange: (pending: boolean) => void;
	onDivisionChange: (profileId: string, divisionId: string) => Promise<void>;
	onDirectoryChange: (
		entry: EntitlementReportEntry,
		approvalStatus: ProfileApprovalStatus,
	) => Promise<void>;
	onRevoke: (entry: EntitlementReportEntry, reason: string) => Promise<void>;
}

function mutationError(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

function EntitlementDivisionCell(props: {
	entry: EntitlementReportEntry;
	customer: string;
	editableDivisions: readonly EntitlementReportDivisionOption[];
	editable: boolean;
	readOnly: boolean;
	busy: boolean;
	onChange: (select: HTMLSelectElement) => void;
}) {
	const currentDivision = () =>
		props.entry.divisions.length === 1
			? props.entry.divisions[0].divisionId
			: "";
	return (
		<div role="cell">
			<Show
				when={props.editable}
				fallback={
					<>
						{formatEntitlementDivisions(props.entry.divisions)}
						<Show when={props.readOnly}>
							<small class="entitlement-report-secondary">Read-only</small>
						</Show>
					</>
				}
			>
				<select
					class="entitlement-report-division-select"
					aria-label={`Division for ${props.customer}`}
					disabled={props.busy}
					onChange={(event) => props.onChange(event.currentTarget)}
				>
					<Show
						when={
							!props.editableDivisions.some(
								(d) => d.divisionId === currentDivision(),
							)
						}
					>
						<option value="" disabled selected>
							Choose an active division
						</option>
					</Show>
					<For each={props.editableDivisions}>
						{(division) => (
							<option
								value={division.divisionId}
								selected={division.divisionId === currentDivision()}
							>
								{division.divisionName}
							</option>
						)}
					</For>
				</select>
			</Show>
		</div>
	);
}

function DirectoryVisibilitySwitch(props: {
	profile: NonNullable<EntitlementReportEntry["directoryProfile"]>;
	customer: string;
	disabled: boolean;
	onChange: (status: ProfileApprovalStatus) => void;
}) {
	const optedIn = () => props.profile.publicDirectoryOptIn;
	const visible = () =>
		optedIn() && props.profile.approvalStatus === "approved";
	return (
		<button
			type="button"
			role="switch"
			class="entitlement-report-directory-switch"
			aria-checked={visible()}
			aria-label={`Public directory visibility for ${props.customer}`}
			disabled={props.disabled || !optedIn()}
			onClick={() => props.onChange(visible() ? "rejected" : "approved")}
		>
			<span aria-hidden="true" class="entitlement-report-switch-track" />
			<small>{!optedIn() ? "Opted out" : visible() ? "Hide" : "Show"}</small>
		</button>
	);
}

function EntitlementTableRow(props: {
	entry: EntitlementReportEntry;
	editableDivisions: readonly EntitlementReportDivisionOption[];
	canEdit: boolean;
	editing: boolean;
	busy: boolean;
	onToggleEdit: () => void;
	onChangeDivision: (select: HTMLSelectElement) => void;
	onChangeDirectory: (status: ProfileApprovalStatus) => void;
	onOpenRevoke: () => void;
}) {
	const customer = () => formatEntitlementCustomer(props.entry);
	const canRevoke = () => canRevokeEntitlement(props.entry.status);
	const canChangeDivision = () =>
		props.entry.status === "active" &&
		props.entry.entitlementClass === "teacher_membership" &&
		!!props.entry.directoryProfile &&
		props.editableDivisions.length > 0;
	return (
		<div class="listing-table-row" role="row" data-editing={props.editing}>
			<div role="cell">
				<strong>{customer().primary}</strong>
				<Show when={customer().secondary}>
					{(secondary) => (
						<small class="entitlement-report-secondary">{secondary()}</small>
					)}
				</Show>
			</div>
			<div role="cell">
				<strong>{formatEntitlementClass(props.entry.entitlementClass)}</strong>
				<small class="entitlement-report-secondary">
					{props.entry.startsOn} – {props.entry.endsOn}
				</small>
			</div>
			<EntitlementDivisionCell
				entry={props.entry}
				customer={customer().primary}
				editableDivisions={props.editableDivisions}
				editable={props.editing && canChangeDivision()}
				readOnly={
					props.editing &&
					props.entry.entitlementClass === "accompanist_membership"
				}
				busy={props.busy}
				onChange={props.onChangeDivision}
			/>
			<div role="cell">
				<span class={entitlementStatusBadgeClass(props.entry.status)}>
					{formatEntitlementStatus(props.entry.status)}
				</span>
				<Show when={props.entry.revokedReason}>
					{(reason) => (
						<small class="entitlement-report-secondary">{reason()}</small>
					)}
				</Show>
			</div>
			<div role="cell" class="entitlement-report-edit-column">
				<button
					type="button"
					class="secondary-button entitlement-report-edit-toggle"
					aria-label={`Edit membership for ${customer().primary}`}
					aria-pressed={props.editing}
					disabled={
						!props.canEdit ||
						props.busy ||
						!(canRevoke() || canChangeDivision())
					}
					onClick={props.onToggleEdit}
				>
					<span aria-hidden="true">✎</span>
				</button>
			</div>
			<div role="cell">
				<div class="entitlement-report-row-actions">
					<Show when={props.entry.directoryProfile}>
						{(profile) => (
							<DirectoryVisibilitySwitch
								profile={profile()}
								customer={customer().primary}
								disabled={!props.editing || props.busy}
								onChange={props.onChangeDirectory}
							/>
						)}
					</Show>
					<button
						type="button"
						class="secondary-button entitlement-report-revoke"
						aria-label={`Revoke membership for ${customer().primary}`}
						disabled={!props.editing || props.busy || !canRevoke()}
						onClick={props.onOpenRevoke}
					>
						Revoke
					</button>
				</div>
			</div>
		</div>
	);
}

export function AdminEntitlementTable(props: AdminEntitlementTableProps) {
	const [editingId, setEditingId] = createSignal<string>();
	const [feedback, setFeedback] = createSignal("");
	const [error, setError] = createSignal("");
	const [revoking, setRevoking] = createSignal<EntitlementReportEntry>();
	const [reason, setReason] = createSignal("");
	const [revokeError, setRevokeError] = createSignal("");
	let dialog!: HTMLDialogElement;

	const changeDivision = async (
		entry: EntitlementReportEntry,
		select: HTMLSelectElement,
	) => {
		const profile = entry.directoryProfile;
		const divisionId = select.value;
		if (!profile || !divisionId || props.mutationPending) return;
		props.onMutationPendingChange(true);
		setError("");
		setFeedback("");
		try {
			await props.onDivisionChange(profile.id, divisionId);
			setFeedback("Teacher division saved.");
		} catch (failure) {
			select.value =
				entry.divisions.length === 1 ? entry.divisions[0].divisionId : "";
			setError(
				mutationError(failure, "Teacher division could not be updated."),
			);
		} finally {
			props.onMutationPendingChange(false);
		}
	};

	const changeDirectory = async (
		entry: EntitlementReportEntry,
		approvalStatus: ProfileApprovalStatus,
	) => {
		if (props.mutationPending || !entry.directoryProfile?.publicDirectoryOptIn)
			return;
		props.onMutationPendingChange(true);
		setError("");
		setFeedback("");
		try {
			await props.onDirectoryChange(entry, approvalStatus);
			setFeedback(
				approvalStatus === "approved"
					? "Profile shown in the public directory."
					: "Profile hidden from the public directory.",
			);
		} catch (failure) {
			setError(
				mutationError(failure, "Directory visibility could not be updated."),
			);
		} finally {
			props.onMutationPendingChange(false);
		}
	};

	const openRevoke = (entry: EntitlementReportEntry) => {
		setReason("");
		setRevokeError("");
		setRevoking(entry);
		dialog.showModal();
	};

	const revoke = async () => {
		const entry = revoking();
		const text = reason().trim();
		if (!entry || props.mutationPending) return;
		if (!text) {
			setRevokeError("Enter a revocation reason.");
			return;
		}
		props.onMutationPendingChange(true);
		setRevokeError("");
		setError("");
		setFeedback("");
		try {
			await props.onRevoke(entry, text);
			setEditingId(undefined);
			dialog.close();
			setFeedback("Membership revoked.");
		} catch (failure) {
			setRevokeError(
				mutationError(failure, "Membership could not be revoked."),
			);
		} finally {
			props.onMutationPendingChange(false);
		}
	};

	return (
		<>
			<p class="muted entitlement-report-scroll-hint">
				Scroll the table horizontally to see row actions.
			</p>
			<section
				class="entitlement-report-table"
				aria-label="Entitlements table"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the table.
				tabIndex={0}
			>
				<div
					class="listing-table entitlement-report-grid"
					role="table"
					aria-labelledby="entitlement-report-title"
				>
					<div class="listing-table-header" role="row">
						<span role="columnheader">Customer</span>
						<span role="columnheader">Membership</span>
						<span role="columnheader">Divisions</span>
						<span role="columnheader">Status</span>
						<span role="columnheader" class="entitlement-report-edit-column">
							Edit
						</span>
						<span role="columnheader">Actions</span>
					</div>
					<For
						each={props.entries}
						fallback={
							<div role="row">
								<div class="listing-table-empty" role="cell" aria-colspan={6}>
									{props.hasFilters
										? "No entitlements match these filters."
										: "No entitlements yet."}
								</div>
							</div>
						}
					>
						{(entry) => (
							<EntitlementTableRow
								entry={entry}
								editableDivisions={props.editableDivisions}
								canEdit={props.canEdit}
								editing={props.canEdit && editingId() === entry.id}
								busy={props.mutationPending}
								onToggleEdit={() => {
									setError("");
									setFeedback("");
									setEditingId((id) =>
										id === entry.id ? undefined : entry.id,
									);
								}}
								onChangeDivision={(select) =>
									void changeDivision(entry, select)
								}
								onChangeDirectory={(status) =>
									void changeDirectory(entry, status)
								}
								onOpenRevoke={() => openRevoke(entry)}
							/>
						)}
					</For>
				</div>
			</section>
			<Show when={error()}>
				<p class="shopify-error-text" role="alert">
					{error()}
				</p>
			</Show>
			<p class="muted" role="status" classList={{ "sr-only": !feedback() }}>
				{feedback()}
			</p>
			<dialog
				ref={dialog}
				class="entitlement-report-revoke-dialog"
				aria-labelledby="entitlement-revoke-title"
				onClose={() => setRevoking(undefined)}
				onCancel={(event) => {
					if (props.mutationPending) event.preventDefault();
				}}
			>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void revoke();
					}}
				>
					<h3 id="entitlement-revoke-title">Revoke membership</h3>
					<Show when={revoking()}>
						{(entry) => (
							<p class="muted">
								{formatEntitlementCustomer(entry()).primary}’s membership will
								be marked revoked.
							</p>
						)}
					</Show>
					<label class="field">
						<span>Revocation reason</span>
						<input
							required
							value={reason()}
							disabled={props.mutationPending}
							onInput={(event) => setReason(event.currentTarget.value)}
						/>
					</label>
					<Show when={revokeError()}>
						<p class="shopify-error-text" role="alert">
							{revokeError()}
						</p>
					</Show>
					<div class="button-row">
						<button
							type="button"
							class="secondary-button"
							disabled={props.mutationPending}
							onClick={() => dialog.close()}
						>
							Cancel
						</button>
						<button
							type="submit"
							class="secondary-button entitlement-report-revoke"
							disabled={props.mutationPending}
						>
							{props.mutationPending ? "Revoking…" : "Confirm revocation"}
						</button>
					</div>
				</form>
			</dialog>
		</>
	);
}
