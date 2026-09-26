import type {
	FestivalClassConfigurationDto,
	OrganizationDivision,
	RegistrationCatalogValue,
} from "@festival/common";
import { createMemo, createSignal, For, Show } from "solid-js";
import {
	formatAgeRange,
	formatDuration,
	formatPrice,
} from "../pages/festivalAdminClassesHelpers.js";
import { Button } from "./Button.js";

interface FestivalClassTableProps {
	classes: FestivalClassConfigurationDto[];
	divisions: OrganizationDivision[];
	classSubtypes: RegistrationCatalogValue[];
	isLoading: boolean;
	onEdit: (item: FestivalClassConfigurationDto) => void;
	onToggleActive: (item: FestivalClassConfigurationDto) => void;
}

export function FestivalClassTable(props: FestivalClassTableProps) {
	const [divisionFilter, setDivisionFilter] = createSignal("");
	const [statusFilter, setStatusFilter] = createSignal<
		"all" | "active" | "inactive"
	>("all");

	function getDivisionName(id: string): string {
		return props.divisions.find((d) => d.id === id)?.displayName ?? id;
	}

	function getSubtypeName(id: string): string {
		return props.classSubtypes.find((s) => s.id === id)?.displayName ?? id;
	}

	const filteredClasses = createMemo(() => {
		const divId = divisionFilter();
		const status = statusFilter();
		return props.classes.filter((c) => {
			if (divId && c.divisionId !== divId) return false;
			if (status === "active" && !c.isActive) return false;
			if (status === "inactive" && c.isActive) return false;
			return true;
		});
	});

	return (
		<>
			<div class="classes-filter-bar">
				<label class="field">
					<span>Filter by division</span>
					<select
						value={divisionFilter()}
						onChange={(e) => setDivisionFilter(e.currentTarget.value)}
					>
						<option value="">All Divisions</option>
						<For each={props.divisions}>
							{(division) => (
								<option value={division.id}>{division.displayName}</option>
							)}
						</For>
					</select>
				</label>
				<label class="field">
					<span>Filter by status</span>
					<select
						value={statusFilter()}
						onChange={(e) =>
							setStatusFilter(
								e.currentTarget.value as "all" | "active" | "inactive",
							)
						}
					>
						<option value="all">All Statuses</option>
						<option value="active">Active</option>
						<option value="inactive">Inactive</option>
					</select>
				</label>
			</div>

			<div class="classes-table-scroll">
				<div class="listing-table festival-classes-table">
					<div class="listing-table-header">
						<span>Display Name</span>
						<span>Division</span>
						<span>Subtype</span>
						<span>Age</span>
						<span>Pieces</span>
						<span>Duration</span>
						<span>Price</span>
						<span>Capacity</span>
						<span>Status</span>
						<span>Actions</span>
					</div>
					<Show when={props.classes.length === 0 && !props.isLoading}>
						<div class="listing-table-empty">
							No classes configured for this festival yet.
						</div>
					</Show>
					<Show
						when={
							props.classes.length > 0 &&
							filteredClasses().length === 0 &&
							!props.isLoading
						}
					>
						<div class="listing-table-empty">
							No classes match the selected filters.
						</div>
					</Show>
					<For each={filteredClasses()}>
						{(classItem) => (
							<div class="listing-table-row">
								<span>
									<strong>{classItem.displayName}</strong>
								</span>
								<span>{getDivisionName(classItem.divisionId)}</span>
								<span>{getSubtypeName(classItem.classSubtypeId)}</span>
								<span>
									{formatAgeRange(classItem.minimumAge, classItem.maximumAge)}
								</span>
								<span>{classItem.maximumPerformancePieces}</span>
								<span>{formatDuration(classItem.performanceMinutes)}</span>
								<span>{formatPrice(classItem.price)}</span>
								<span>{classItem.capacity}</span>
								<span class="listing-table-badges">
									<span
										class={`badge ${
											classItem.isActive ? "badge-active" : "badge-inactive"
										}`}
									>
										{classItem.isActive ? "Active" : "Inactive"}
									</span>
								</span>
								<span class="listing-table-actions">
									<Button
										type="button"
										variant="secondary"
										onClick={() => props.onEdit(classItem)}
									>
										Edit
									</Button>
									<Button
										type="button"
										variant="secondary"
										onClick={() => props.onToggleActive(classItem)}
									>
										{classItem.isActive ? "Deactivate" : "Reactivate"}
									</Button>
								</span>
							</div>
						)}
					</For>
				</div>
			</div>
		</>
	);
}
