import { type Accessor, type Setter, Show } from "solid-js";
import { Button } from "../../components/Button.js";
import type { CreateVolunteerRoleInput } from "../../lib/api.js";

export interface VolunteerRoleFormProps {
	roleDraft: Accessor<CreateVolunteerRoleInput>;
	setRoleDraft: Setter<CreateVolunteerRoleInput>;
	editingRoleId: Accessor<string | null>;
	isCreatingRole: Accessor<boolean>;
	roleFormError: Accessor<string | null>;
	onSubmit: (event: Event) => void;
	onCancelEdit: () => void;
}

function RoleFormFields(props: {
	roleDraft: Accessor<CreateVolunteerRoleInput>;
	setRoleDraft: Setter<CreateVolunteerRoleInput>;
	isEditing: boolean;
}) {
	return (
		<>
			<Show when={!props.isEditing}>
				<label class="field">
					<span>Slug</span>
					<input
						type="text"
						value={props.roleDraft().slug}
						onInput={(event) =>
							props.setRoleDraft((current) => ({
								...current,
								slug: event.currentTarget.value,
							}))
						}
					/>
				</label>
			</Show>
			<label class="field">
				<span>Display name</span>
				<input
					type="text"
					value={props.roleDraft().displayName}
					onInput={(event) =>
						props.setRoleDraft((current) => ({
							...current,
							displayName: event.currentTarget.value,
						}))
					}
				/>
			</label>
			<label class="field">
				<span>Description</span>
				<input
					type="text"
					value={props.roleDraft().description}
					onInput={(event) =>
						props.setRoleDraft((current) => ({
							...current,
							description: event.currentTarget.value,
						}))
					}
				/>
			</label>
			<label class="field">
				<span>Details link (optional)</span>
				<input
					type="text"
					value={props.roleDraft().detailsUrl ?? ""}
					onInput={(event) =>
						props.setRoleDraft((current) => ({
							...current,
							detailsUrl: event.currentTarget.value,
						}))
					}
				/>
			</label>
			<label class="field field-checkbox">
				<input
					type="checkbox"
					checked={props.roleDraft().isRoomProctor}
					onChange={(event) =>
						props.setRoleDraft((current) => ({
							...current,
							isRoomProctor: event.currentTarget.checked,
						}))
					}
				/>
				<span>Room Proctor role</span>
			</label>
		</>
	);
}

export function VolunteerRoleForm(props: VolunteerRoleFormProps) {
	return (
		<form class="flow-panel" onSubmit={props.onSubmit}>
			<h3>{props.editingRoleId() ? "Edit role" : "Create a role"}</h3>
			<RoleFormFields
				roleDraft={props.roleDraft}
				setRoleDraft={props.setRoleDraft}
				isEditing={Boolean(props.editingRoleId())}
			/>
			<Show when={props.roleFormError()}>
				<section class="banner error-banner">{props.roleFormError()}</section>
			</Show>
			<Button type="submit" disabled={props.isCreatingRole()}>
				{props.editingRoleId() ? "Save changes" : "Create role"}
			</Button>
			<Show when={props.editingRoleId()}>
				<Button type="button" variant="secondary" onClick={props.onCancelEdit}>
					Cancel
				</Button>
			</Show>
		</form>
	);
}
