import { Router } from "express";
import type { CheckoutRequest, PayerProfileInput, RefundRequest, StudentMetadata } from "@festival/common";
import { FESTIVAL_CLASS_CATALOG } from "@festival/common";
import type { RegistrationService } from "../services/registration-service.js";

export function buildApiRouter(registrationService: RegistrationService): Router {
  const router = Router();

  router.get("/classes", (_request, response) => {
    response.json({ classes: FESTIVAL_CLASS_CATALOG });
  });

  router.post("/payers", async (request, response) => {
    try {
      const payload = request.body as PayerProfileInput;
      const payer = await registrationService.createPayer(payload);
      response.status(201).json({ payer });
    } catch (error) {
      response.status(400).json({ error: (error as Error).message });
    }
  });

  router.post("/cart/validate", (request, response) => {
    try {
      const payload = request.body as Pick<CheckoutRequest, "selection" | "eligibility">;
      const validation = registrationService.validateSelection(payload.selection, payload.eligibility);
      response.json({ validation });
    } catch (error) {
      response.status(400).json({ error: (error as Error).message });
    }
  });

  router.post("/passes", async (request, response) => {
    try {
      const payload = request.body as {
        payerId: string;
        studentId: string;
        classId: string;
        metadata: StudentMetadata;
      };

      const pass = await registrationService.createDigitalPass(
        payload.payerId,
        payload.studentId,
        payload.classId,
        payload.metadata
      );

      response.status(201).json({ pass });
    } catch (error) {
      response.status(400).json({ error: (error as Error).message });
    }
  });

  router.post("/checkout", async (request, response) => {
    try {
      const payload = request.body as CheckoutRequest;
      const checkout = await registrationService.createCheckout(payload);
      response.status(201).json({ checkout });
    } catch (error) {
      response.status(400).json({ error: (error as Error).message });
    }
  });

  router.post("/refunds", async (request, response) => {
    try {
      const payload = request.body as RefundRequest;
      const refund = await registrationService.processDropRefund(payload);
      response.status(201).json({ refund });
    } catch (error) {
      response.status(400).json({ error: (error as Error).message });
    }
  });

  return router;
}
