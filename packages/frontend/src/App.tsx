import type { FestivalClass } from "@festival/common";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import {
	createCheckout,
	createPass,
	createPayer,
	validateCart,
} from "./lib/api.js";
import { buildSelection } from "./lib/cart.js";

export default function App() {
	const [classes, setClasses] = createSignal<FestivalClass[]>([]);
	const [selectedClassIds, setSelectedClassIds] = createSignal<string[]>([]);
	const [participantsByClass, setParticipantsByClass] = createSignal<
		Record<string, number>
	>({});

	const [payerId, setPayerId] = createSignal("");
	const [status, setStatus] = createSignal("Ready");
	const [errors, setErrors] = createSignal<string[]>([]);

	const [studentId, setStudentId] = createSignal("student-001");
	const [allowedClassIdsText, setAllowedClassIdsText] = createSignal(
		"solo-piano,concert-showcase,ensemble-jazz,theory-lab",
	);

	onMount(async () => {
		const response = await fetch("/api/classes");
		const payload = (await response.json()) as { classes: FestivalClass[] };
		setClasses(payload.classes);
	});

	const eligibility = createMemo(() => ({
		studentId: studentId(),
		allowedClassIds: allowedClassIdsText()
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean),
	}));

	const toggleClass = (classId: string) => {
		const current = new Set(selectedClassIds());
		if (current.has(classId)) {
			current.delete(classId);
		} else {
			current.add(classId);
		}
		setSelectedClassIds(Array.from(current));
	};

	const handleCreatePayer = async () => {
		try {
			const response = await createPayer({
				firstName: "Festival",
				lastName: "Guardian",
				email: "guardian@example.com",
				role: "guardian",
			});
			setPayerId(response.payer.id);
			setStatus(`Payer created: ${response.payer.id}`);
		} catch (error) {
			setStatus((error as Error).message);
		}
	};

	const handleValidate = async () => {
		setErrors([]);

		const response = await validateCart({
			selection: buildSelection(selectedClassIds(), participantsByClass()),
			eligibility: eligibility(),
		});

		setErrors(response.validation.errors);
		setStatus(
			response.validation.valid ? "Cart is valid" : "Cart has rule violations",
		);
	};

	const handleCheckout = async () => {
		try {
			if (!payerId()) {
				setStatus("Create payer first.");
				return;
			}

			const checkout = await createCheckout({
				payerId: payerId(),
				studentId: studentId(),
				currency: "USD",
				selection: buildSelection(selectedClassIds(), participantsByClass()),
				eligibility: eligibility(),
			});

			setStatus(`Checkout created: ${checkout.checkout.checkoutUrl}`);

			const firstClass = selectedClassIds()[0];
			if (firstClass) {
				const pass = await createPass({
					payerId: payerId(),
					studentId: studentId(),
					classId: firstClass,
					metadata: {
						externalStudentId: studentId(),
						studentFullName: "Student Example",
						age: 12,
						skillLevel: "Intermediate",
						instrument: "Piano",
					},
				});
				setStatus(
					(current) =>
						`${current} | Digital pass token: ${pass.pass.passToken}`,
				);
			}
		} catch (error) {
			setStatus((error as Error).message);
		}
	};

	return (
		<main>
			<header class="panel">
				<h1>Festival Class Registration</h1>
				<p>
					Custom app rules filter eligibility and enforce Concert/Solo and
					Ensemble participant constraints before Shopify checkout.
				</p>
			</header>

			<section class="panel grid">
				<div>
					<h2>Eligibility Input</h2>
					<label>
						Student ID
						<input
							type="text"
							value={studentId()}
							onInput={(event) => setStudentId(event.currentTarget.value)}
						/>
					</label>
				</div>
				<div>
					<h2>Allowed Class IDs</h2>
					<label>
						Comma-separated list
						<input
							type="text"
							value={allowedClassIdsText()}
							onInput={(event) =>
								setAllowedClassIdsText(event.currentTarget.value)
							}
						/>
					</label>
				</div>
			</section>

			<section class="panel">
				<h2>Select Classes</h2>
				<For each={classes()}>
					{(festivalClass) => (
						<label class="class-row">
							<input
								type="checkbox"
								checked={selectedClassIds().includes(festivalClass.id)}
								onChange={() => toggleClass(festivalClass.id)}
							/>
							<span>
								<strong>{festivalClass.title}</strong>
								<span class="class-meta">
									{festivalClass.classType} | ${festivalClass.priceCents / 100}{" "}
									| id: {festivalClass.id}
								</span>
							</span>
							<input
								type="number"
								min="1"
								value={participantsByClass()[festivalClass.id] ?? 1}
								onInput={(event) =>
									setParticipantsByClass((current) => ({
										...current,
										[festivalClass.id]: Number.parseInt(
											event.currentTarget.value,
											10,
										),
									}))
								}
							/>
						</label>
					)}
				</For>
			</section>

			<section class="panel actions">
				<button type="button" onClick={handleCreatePayer}>
					Create Guardian/Parent Record
				</button>
				<button type="button" onClick={handleValidate}>
					Validate Cart Rules
				</button>
				<button type="button" onClick={handleCheckout}>
					Checkout + Digital Pass
				</button>
			</section>

			<Show when={errors().length > 0}>
				<section class="panel error">
					<h3>Validation errors</h3>
					<ul>
						<For each={errors()}>{(error) => <li>{error}</li>}</For>
					</ul>
				</section>
			</Show>

			<section class="panel status">{status()}</section>
		</main>
	);
}
