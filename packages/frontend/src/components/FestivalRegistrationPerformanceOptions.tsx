import { For, Show } from "solid-js";
import type { createRegistrationSelectHandlers } from "../pages/festivalRegistrationHelpers.js";

interface FestivalRegistrationPerformanceOptionsProps {
	instruments: { id: string; displayName: string }[];
	accompanists: { id: string; name: string }[];
	instrumentId: string;
	accompanistId: string;
	handlers: Pick<
		ReturnType<typeof createRegistrationSelectHandlers>,
		"onInstrumentChange" | "onAccompanistChange"
	>;
}

export function FestivalRegistrationPerformanceOptions(
	props: FestivalRegistrationPerformanceOptionsProps,
) {
	return (
		<>
			<Show when={props.instruments.length > 0}>
				<label class="field">
					<span>Instrument</span>
					<select
						id="registration-instrument"
						name="registration-instrument"
						value={props.instrumentId}
						onChange={props.handlers.onInstrumentChange}
						required
					>
						<option value="">Select an instrument…</option>
						<For each={props.instruments}>
							{(instrument) => (
								<option value={instrument.id}>{instrument.displayName}</option>
							)}
						</For>
					</select>
				</label>
			</Show>
			<label class="field">
				<span>Accompanist</span>
				<select
					id="registration-accompanist"
					name="registration-accompanist"
					value={props.accompanistId}
					onChange={props.handlers.onAccompanistChange}
				>
					<option value="">None (No accompanist needed)</option>
					<For each={props.accompanists}>
						{(accompanist) => (
							<option value={accompanist.id}>{accompanist.name}</option>
						)}
					</For>
				</select>
			</label>
		</>
	);
}
