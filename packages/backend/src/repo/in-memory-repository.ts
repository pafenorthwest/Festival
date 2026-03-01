import { randomUUID } from "node:crypto";
import type { ClassPass, PayerProfile, PayerProfileInput, StudentMetadata } from "@festival/common";

export class InMemoryRepository {
  private readonly payers = new Map<string, PayerProfile>();
  private readonly passes = new Map<string, ClassPass>();

  createPayer(input: PayerProfileInput, shopifyCustomerId: string): PayerProfile {
    const payer: PayerProfile = {
      id: randomUUID(),
      ...input,
      shopifyCustomerId,
      createdAtIso: new Date().toISOString()
    };

    this.payers.set(payer.id, payer);
    return payer;
  }

  getPayerById(payerId: string): PayerProfile | undefined {
    return this.payers.get(payerId);
  }

  createPass(studentId: string, classId: string, metadata: StudentMetadata): ClassPass {
    const pass: ClassPass = {
      id: randomUUID(),
      studentId,
      classId,
      passToken: `PASS-${randomUUID().slice(0, 8).toUpperCase()}`,
      metadata,
      createdAtIso: new Date().toISOString()
    };

    this.passes.set(pass.id, pass);
    return pass;
  }

  listPayers(): PayerProfile[] {
    return Array.from(this.payers.values());
  }
}
