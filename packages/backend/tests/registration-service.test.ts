import { describe, expect, it } from "bun:test";
import type { RefundRequest } from "@festival/common";
import { InMemoryRepository } from "../src/repo/in-memory-repository.js";
import { RegistrationService } from "../src/services/registration-service.js";
import { ShopifyAdminClient } from "../src/clients/shopify-admin-client.js";
import { ShopifyStorefrontClient } from "../src/clients/shopify-storefront-client.js";
import { StripeClient } from "../src/clients/stripe-client.js";

function createService() {
  return new RegistrationService(
    new InMemoryRepository(),
    new ShopifyAdminClient({}),
    new ShopifyStorefrontClient({}),
    new StripeClient({})
  );
}

describe("registration service", () => {
  it("creates payer and checkout in mock mode", async () => {
    const service = createService();

    const payer = await service.createPayer({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      role: "guardian"
    });

    const checkout = await service.createCheckout({
      payerId: payer.id,
      studentId: "student-123",
      currency: "USD",
      eligibility: {
        studentId: "student-123",
        allowedClassIds: ["solo-piano", "concert-showcase"]
      },
      selection: {
        classIds: ["solo-piano", "concert-showcase"],
        participantsByClass: {
          "solo-piano": 1,
          "concert-showcase": 1
        }
      }
    });

    expect(checkout.providerMode).toBe("mock");
    expect(checkout.amountCents).toBe(24000);
  });

  it("refunds both Shopify and Stripe in mock mode", async () => {
    const service = createService();

    const refundInput: RefundRequest = {
      orderId: "gid://shopify/Order/mock-order",
      paymentIntentId: "pi_mock_1234",
      amountCents: 9000,
      reason: "Student dropped class"
    };

    const refund = await service.processDropRefund(refundInput);

    expect(refund.reconciled).toBeTrue();
    expect(refund.providerMode).toBe("mock");
  });
});
