import type { CheckoutRequest, PayerProfileInput, StudentMetadata } from "@festival/common";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json"
    },
    ...init
  });

  const payload = (await response.json()) as T | { error: string };
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error ?? `Request failed for ${path}`);
  }

  return payload as T;
}

export async function createPayer(input: PayerProfileInput) {
  return requestJson<{ payer: { id: string; email: string; firstName: string; lastName: string } }>("/api/payers", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function validateCart(payload: Pick<CheckoutRequest, "selection" | "eligibility">) {
  return requestJson<{ validation: { valid: boolean; selectedClassIds: string[]; errors: string[] } }>(
    "/api/cart/validate",
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export async function createCheckout(payload: CheckoutRequest) {
  return requestJson<{ checkout: { checkoutUrl: string; paymentIntentId: string; amountCents: number } }>(
    "/api/checkout",
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export async function createPass(payload: {
  payerId: string;
  studentId: string;
  classId: string;
  metadata: StudentMetadata;
}) {
  return requestJson<{ pass: { passId: string; passToken: string } }>("/api/passes", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
