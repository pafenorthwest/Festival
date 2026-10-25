import type { FestivalSummary } from "@festival/common";
import { For } from "solid-js";

interface FestivalSelectorProps {
	festivals: FestivalSummary[];
	value: string;
	onChange: (shortName: string) => void;
}

export function FestivalSelector(props: FestivalSelectorProps) {
	return (
		<label class="field">
			<span>Festival</span>
			<select
				value={props.value}
				onChange={(event) => props.onChange(event.currentTarget.value)}
			>
				<For each={props.festivals}>
					{(festival) => (
						<option value={festival.shortName}>{festival.name}</option>
					)}
				</For>
			</select>
		</label>
	);
}
