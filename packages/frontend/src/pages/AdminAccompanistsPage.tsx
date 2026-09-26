import type { FestivalAppController } from "../app/useFestivalAppController.js";
import { AdminRosterPage } from "./AdminRosterPage.js";

export function AdminAccompanistsPage(props: { app: FestivalAppController }) {
	return <AdminRosterPage app={props.app} />;
}
