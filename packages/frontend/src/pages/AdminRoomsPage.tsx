import {
	createMemo,
	createResource,
	createSignal,
	For,
	onCleanup,
	Show,
} from "solid-js";
import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AccessDeniedPanel } from "../components/AccessDeniedPanel.js";
import { Button } from "../components/Button.js";
import { createRoom, listRooms } from "../lib/api.js";
import { subscribeToAuthChanges } from "../lib/firebase-auth.js";

interface AdminRoomsPageProps {
	app: FestivalAppController;
	slug: string;
}

interface RoomDraft {
	name: string;
	uprightCount: string;
	grandCount: string;
}

const emptyRoomDraft: RoomDraft = {
	name: "",
	uprightCount: "",
	grandCount: "",
};

function describePianos(
	pianoConfigurations: Array<{ pianoType: string; count: number }>,
): string {
	if (pianoConfigurations.length === 0) return "No pianos";
	return pianoConfigurations
		.map((config) => `${config.count} ${config.pianoType}`)
		.join(", ");
}

export function AdminRoomsPage(props: AdminRoomsPageProps) {
	const [idToken, setIdToken] = createSignal<string | null>(null);
	const [selectedFestivalShortName, setSelectedFestivalShortName] =
		createSignal("");
	const selectedFestival = createMemo(() => {
		const festivals = props.app.festivals();
		return (
			festivals.find(
				(festival) => festival.shortName === selectedFestivalShortName(),
			) ??
			festivals.find((festival) => festival.isPrimary) ??
			festivals[0]
		);
	});

	const unsubscribe = subscribeToAuthChanges(async (user) => {
		setIdToken(user ? await user.getIdToken() : null);
	});
	onCleanup(unsubscribe);

	const [rooms, { refetch: refetchRooms }] = createResource(
		() => {
			const token = idToken();
			const festivalShortName = selectedFestival()?.shortName;
			return token && festivalShortName
				? ([token, festivalShortName] as const)
				: undefined;
		},
		async ([token, festivalShortName]) => {
			const response = await listRooms(token, props.slug, festivalShortName);
			return response.rooms;
		},
	);

	const [roomDraft, setRoomDraft] = createSignal(emptyRoomDraft);
	const [roomFormError, setRoomFormError] = createSignal<string | null>(null);
	const [isCreatingRoom, setIsCreatingRoom] = createSignal(false);

	async function handleCreateRoom(event: Event) {
		event.preventDefault();
		const token = idToken();
		const festivalShortName = selectedFestival()?.shortName;
		if (!token || !festivalShortName) return;
		setRoomFormError(null);
		setIsCreatingRoom(true);
		try {
			const draft = roomDraft();
			const pianoConfigurations: Array<{
				pianoType: "upright" | "grand";
				count: number;
			}> = [];
			if (draft.uprightCount.trim().length > 0) {
				pianoConfigurations.push({
					pianoType: "upright",
					count: Number(draft.uprightCount),
				});
			}
			if (draft.grandCount.trim().length > 0) {
				pianoConfigurations.push({
					pianoType: "grand",
					count: Number(draft.grandCount),
				});
			}
			await createRoom(token, props.slug, festivalShortName, {
				name: draft.name,
				pianoConfigurations,
			});
			setRoomDraft(emptyRoomDraft);
			await refetchRooms();
		} catch (error) {
			setRoomFormError(
				error instanceof Error ? error.message : "Could not create room.",
			);
		} finally {
			setIsCreatingRoom(false);
		}
	}

	return (
		<Show
			when={props.app.isAdminMember()}
			fallback={
				<AccessDeniedPanel message="Room settings are available to organization Admins." />
			}
		>
			<section class="panel flow-panel">
				<header class="admin-page-header">
					<div>
						<h2>Rooms</h2>
						<p>Physical rooms available at this festival, with piano setup.</p>
					</div>
				</header>
				<Show
					when={selectedFestival()}
					fallback={<p>No festivals have been created yet.</p>}
				>
					<label class="field">
						<span>Festival</span>
						<select
							value={selectedFestival()?.shortName ?? ""}
							onChange={(event) =>
								setSelectedFestivalShortName(event.currentTarget.value)
							}
						>
							<For each={props.app.festivals()}>
								{(festival) => (
									<option value={festival.shortName}>{festival.name}</option>
								)}
							</For>
						</select>
					</label>
					<Show when={rooms.loading}>
						<p>Loading rooms…</p>
					</Show>
					<Show when={rooms.error}>
						<section class="banner error-banner">
							Could not load rooms: {String(rooms.error)}
						</section>
					</Show>
					<Show when={rooms() && rooms()?.length === 0}>
						<p>No rooms have been created yet.</p>
					</Show>
					<Show when={rooms()?.length}>
						<div class="listing-table rooms-table">
							<div class="listing-table-header">
								<span>Room</span>
								<span>Pianos</span>
							</div>
							<For each={rooms()}>
								{(room) => (
									<div class="listing-table-row">
										<span>
											<strong>{room.name}</strong>
										</span>
										<span>{describePianos(room.pianoConfigurations)}</span>
									</div>
								)}
							</For>
						</div>
					</Show>

					<form class="flow-panel" onSubmit={handleCreateRoom}>
						<h3>Create a room</h3>
						<label class="field">
							<span>Room name</span>
							<input
								type="text"
								value={roomDraft().name}
								onInput={(event) =>
									setRoomDraft((current) => ({
										...current,
										name: event.currentTarget.value,
									}))
								}
							/>
						</label>
						<label class="field">
							<span>Upright pianos (optional)</span>
							<input
								type="number"
								min="1"
								step="1"
								value={roomDraft().uprightCount}
								onInput={(event) =>
									setRoomDraft((current) => ({
										...current,
										uprightCount: event.currentTarget.value,
									}))
								}
							/>
						</label>
						<label class="field">
							<span>Grand pianos (optional)</span>
							<input
								type="number"
								min="1"
								step="1"
								value={roomDraft().grandCount}
								onInput={(event) =>
									setRoomDraft((current) => ({
										...current,
										grandCount: event.currentTarget.value,
									}))
								}
							/>
						</label>
						<p class="muted">Total pianos in a room must not exceed 3.</p>
						<Show when={roomFormError()}>
							<section class="banner error-banner">{roomFormError()}</section>
						</Show>
						<Button type="submit" disabled={isCreatingRoom()}>
							Create room
						</Button>
					</form>
				</Show>
			</section>
		</Show>
	);
}
