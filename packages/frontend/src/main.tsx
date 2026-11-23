import { Router } from "@solidjs/router";
import { render } from "solid-js/web";
import App from "./App.js";
import { AppRoutes } from "./app/AppRoutes.js";
import "./styles.css";
import "./parent-registration.css";

const root = document.getElementById("app");

if (!root) {
	throw new Error("Root element #app not found");
}

render(
	() => (
		<Router root={App}>
			<AppRoutes />
		</Router>
	),
	root,
);
