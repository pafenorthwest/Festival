import type {
	CheckoutRequest,
	PayerProfileInput,
	RefundRequest,
	StudentMetadata,
} from "@festival/common";
import { FESTIVAL_CLASS_CATALOG } from "@festival/common";
import { Hono } from "hono";
import type { RegistrationService } from "../services/registration-service.js";

export function buildApiRouter(registrationService: RegistrationService): Hono {
	const router = new Hono();

	router.get("/classes", (c) => {
		return c.json({ classes: FESTIVAL_CLASS_CATALOG });
	});

	router.post("/payers", async (c) => {
		try {
			const payload = (await c.req.json()) as PayerProfileInput;
			const payer = await registrationService.createPayer(payload);
			return c.json({ payer }, 201);
		} catch (error) {
			return c.json({ error: (error as Error).message }, 400);
		}
	});

	router.post("/cart/validate", async (c) => {
		try {
			const payload = (await c.req.json()) as Pick<
				CheckoutRequest,
				"selection" | "eligibility"
			>;

			const validation = registrationService.validateSelection(
				payload.selection,
				payload.eligibility,
			);

			return c.json({ validation });
		} catch (error) {
			return c.json({ error: (error as Error).message }, 400);
		}
	});

	router.post("/passes", async (c) => {
		try {
			const payload = (await c.req.json()) as {
				payerId: string;
				studentId: string;
				classId: string;
				metadata: StudentMetadata;
			};

			const pass = await registrationService.createDigitalPass(
				payload.payerId,
				payload.studentId,
				payload.classId,
				payload.metadata,
			);

			return c.json({ pass }, 201);
		} catch (error) {
			return c.json({ error: (error as Error).message }, 400);
		}
	});

	router.post("/checkout", async (c) => {
		try {
			const payload = (await c.req.json()) as CheckoutRequest;
			const checkout = await registrationService.createCheckout(payload);
			return c.json({ checkout }, 201);
		} catch (error) {
			return c.json({ error: (error as Error).message }, 400);
		}
	});

	router.post("/refunds", async (c) => {
		try {
			const payload = (await c.req.json()) as RefundRequest;
			const refund = await registrationService.processDropRefund(payload);
			return c.json({ refund }, 201);
		} catch (error) {
			return c.json({ error: (error as Error).message }, 400);
		}
	});

	return router;
}
