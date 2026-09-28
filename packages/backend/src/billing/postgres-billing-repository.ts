import { randomUUID } from "node:crypto";
import type {
	BillingAdjustment,
	BillingLedgerEntry,
	BillingMismatchRecord,
	CreateBillingAdjustmentInput,
	CreditBalance,
} from "@festival/common";
import { sql } from "bun";
import { initializePostgresSchema } from "../repo/postgres-schema.js";
import {
	type BillingRepository,
	type CreateAdjustmentOptions,
	type CreateAdjustmentResult,
	DuplicateAdjustmentError,
	InsufficientCreditBalanceError,
	resolveAdjustmentDirection,
	resolveLedgerEntryType,
} from "./billing-repository.js";

function schemaName(value: string) {
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value))
		throw new Error("Database schema is invalid.");
	return value;
}

function adjustmentRow(row: Record<string, unknown>): BillingAdjustment {
	return {
		id: String(row.id),
		organizationId: String(row.organization_id),
		customerId: String(row.customer_id),
		adminUserId: String(row.admin_user_id),
		adjustmentType: row.adjustment_type as BillingAdjustment["adjustmentType"],
		amountCents: Number(row.amount_cents),
		currencyCode: String(row.currency_code),
		reason: String(row.reason),
		referenceType: row.reference_type ? String(row.reference_type) : null,
		referenceId: row.reference_id ? String(row.reference_id) : null,
		approvedDecisionId: row.approved_decision_id
			? String(row.approved_decision_id)
			: null,
		createdAtIso: row.created_at
			? new Date(String(row.created_at)).toISOString()
			: undefined,
	};
}

function ledgerRow(row: Record<string, unknown>): BillingLedgerEntry {
	return {
		id: String(row.id),
		organizationId: String(row.organization_id),
		customerId: String(row.customer_id),
		entryType: row.entry_type as BillingLedgerEntry["entryType"],
		amountCents: Number(row.amount_cents),
		direction: row.direction as BillingLedgerEntry["direction"],
		balanceAfterCents: Number(row.balance_after_cents),
		currencyCode: String(row.currency_code),
		adjustmentId: row.adjustment_id ? String(row.adjustment_id) : null,
		notes: row.notes ? String(row.notes) : null,
		createdAtIso: row.created_at
			? new Date(String(row.created_at)).toISOString()
			: undefined,
	};
}

function balanceRow(row: Record<string, unknown>): CreditBalance {
	return {
		organizationId: String(row.organization_id),
		customerId: String(row.customer_id),
		balanceCents: Number(row.balance_cents),
		currencyCode: String(row.currency_code),
		updatedAtIso: row.updated_at
			? new Date(String(row.updated_at)).toISOString()
			: undefined,
	};
}

export class PostgresBillingRepository implements BillingRepository {
	private readonly schema: string;

	constructor(schema: string) {
		this.schema = schemaName(schema);
	}

	async ensureReady() {
		await initializePostgresSchema(this.schema);
	}

	async createAdjustmentWithLedger(
		input: CreateBillingAdjustmentInput,
		options?: CreateAdjustmentOptions,
	): Promise<CreateAdjustmentResult> {
		return (await sql.begin(async (tx) => {
			await tx.unsafe(
				`INSERT INTO ${this.schema}.credit_balances (organization_id, customer_id, balance_cents, currency_code, updated_at)
				 VALUES ($1, $2, 0, $3, NOW())
				 ON CONFLICT (organization_id, customer_id) DO NOTHING`,
				[input.organizationId, input.customerId, input.currencyCode ?? "USD"],
			);

			const balanceRows = (await tx.unsafe(
				`SELECT organization_id, customer_id, balance_cents, currency_code, updated_at::text
				 FROM ${this.schema}.credit_balances
				 WHERE organization_id = $1 AND customer_id = $2
				 FOR UPDATE`,
				[input.organizationId, input.customerId],
			)) as Array<Record<string, unknown>>;

			const currentBalanceRow = balanceRows[0];
			if (!currentBalanceRow) {
				throw new Error("Unable to obtain row-level lock on credit_balances.");
			}
			const currentBalanceCents = Number(currentBalanceRow.balance_cents);
			const currencyCode =
				input.currencyCode ?? String(currentBalanceRow.currency_code ?? "USD");

			if (input.referenceId) {
				const existingRows = (await tx.unsafe(
					`SELECT id, organization_id, customer_id, admin_user_id, adjustment_type,
					        amount_cents, currency_code, reason, reference_type, reference_id,
					        approved_decision_id, created_at::text
					 FROM ${this.schema}.billing_adjustments
					 WHERE organization_id = $1
					   AND reference_id = $2
					   AND ($3::text IS NULL OR reference_type = $3)
					 FOR UPDATE`,
					[
						input.organizationId,
						input.referenceId,
						input.referenceType ?? null,
					],
				)) as Array<Record<string, unknown>>;

				if (existingRows[0]) {
					const existing = adjustmentRow(existingRows[0]);
					throw new DuplicateAdjustmentError(
						`Adjustment for reference "${input.referenceId}" already exists.`,
						existing,
					);
				}
			}

			const direction = resolveAdjustmentDirection(
				input.adjustmentType,
				options?.direction,
			);
			const entryType = resolveLedgerEntryType(
				input.adjustmentType,
				direction,
				options?.entryType,
			);

			const delta =
				direction === "inflow" ? input.amountCents : -input.amountCents;
			const newBalanceCents = currentBalanceCents + delta;
			if (newBalanceCents < 0) {
				throw new InsufficientCreditBalanceError(
					`Adjustment would result in negative credit balance: ${newBalanceCents} cents. Available: ${currentBalanceCents} cents.`,
				);
			}

			const adjustmentId = randomUUID();
			const ledgerEntryId = randomUUID();

			const adjRows = (await tx.unsafe(
				`INSERT INTO ${this.schema}.billing_adjustments (
					id, organization_id, customer_id, admin_user_id, adjustment_type,
					amount_cents, currency_code, reason, reference_type, reference_id,
					approved_decision_id, created_at
				 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
				 RETURNING id, organization_id, customer_id, admin_user_id, adjustment_type,
				           amount_cents, currency_code, reason, reference_type, reference_id,
				           approved_decision_id, created_at::text`,
				[
					adjustmentId,
					input.organizationId,
					input.customerId,
					input.adminUserId,
					input.adjustmentType,
					input.amountCents,
					currencyCode,
					input.reason,
					input.referenceType ?? null,
					input.referenceId ?? null,
					input.approvedDecisionId ?? null,
				],
			)) as Array<Record<string, unknown>>;

			const ledgerRows = (await tx.unsafe(
				`INSERT INTO ${this.schema}.billing_ledger (
					id, organization_id, customer_id, entry_type, amount_cents,
					direction, balance_after_cents, currency_code, adjustment_id,
					notes, created_at
				 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
				 RETURNING id, organization_id, customer_id, entry_type, amount_cents,
				           direction, balance_after_cents, currency_code, adjustment_id,
				           notes, created_at::text`,
				[
					ledgerEntryId,
					input.organizationId,
					input.customerId,
					entryType,
					input.amountCents,
					direction,
					newBalanceCents,
					currencyCode,
					adjustmentId,
					options?.notes ?? null,
				],
			)) as Array<Record<string, unknown>>;

			const updatedBalanceRows = (await tx.unsafe(
				`UPDATE ${this.schema}.credit_balances
				 SET balance_cents = $3,
				     currency_code = $4,
				     updated_at = NOW()
				 WHERE organization_id = $1 AND customer_id = $2
				 RETURNING organization_id, customer_id, balance_cents, currency_code, updated_at::text`,
				[input.organizationId, input.customerId, newBalanceCents, currencyCode],
			)) as Array<Record<string, unknown>>;

			return {
				adjustment: adjustmentRow(adjRows[0]),
				ledgerEntry: ledgerRow(ledgerRows[0]),
				creditBalance: balanceRow(updatedBalanceRows[0]),
			};
		})) as CreateAdjustmentResult;
	}

	async getCreditBalance(
		organizationId: string,
		customerId: string,
	): Promise<CreditBalance | null> {
		const rows = (await sql.unsafe(
			`SELECT organization_id, customer_id, balance_cents, currency_code, updated_at::text
			 FROM ${this.schema}.credit_balances
			 WHERE organization_id = $1 AND customer_id = $2`,
			[organizationId, customerId],
		)) as Array<Record<string, unknown>>;
		return rows[0] ? balanceRow(rows[0]) : null;
	}

	async listLedgerEntries(
		organizationId: string,
		customerId: string,
	): Promise<BillingLedgerEntry[]> {
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, customer_id, entry_type, amount_cents,
			        direction, balance_after_cents, currency_code, adjustment_id,
			        notes, created_at::text
			 FROM ${this.schema}.billing_ledger
			 WHERE organization_id = $1 AND customer_id = $2
			 ORDER BY created_at ASC, id ASC`,
			[organizationId, customerId],
		)) as Array<Record<string, unknown>>;
		return rows.map(ledgerRow);
	}

	async listAdjustments(
		organizationId: string,
		customerId?: string,
	): Promise<BillingAdjustment[]> {
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, customer_id, admin_user_id, adjustment_type,
			        amount_cents, currency_code, reason, reference_type, reference_id,
			        approved_decision_id, created_at::text
			 FROM ${this.schema}.billing_adjustments
			 WHERE organization_id = $1
			   AND ($2::text IS NULL OR customer_id = $2)
			 ORDER BY created_at DESC, id DESC`,
			[organizationId, customerId ?? null],
		)) as Array<Record<string, unknown>>;
		return rows.map(adjustmentRow);
	}

	async findAdjustmentByReference(
		organizationId: string,
		referenceType: string | null | undefined,
		referenceId: string,
	): Promise<BillingAdjustment | null> {
		const rows = (await sql.unsafe(
			`SELECT id, organization_id, customer_id, admin_user_id, adjustment_type,
			        amount_cents, currency_code, reason, reference_type, reference_id,
			        approved_decision_id, created_at::text
			 FROM ${this.schema}.billing_adjustments
			 WHERE organization_id = $1
			   AND reference_id = $2
			   AND ($3::text IS NULL OR reference_type = $3)
			 LIMIT 1`,
			[organizationId, referenceId, referenceType ?? null],
		)) as Array<Record<string, unknown>>;
		return rows[0] ? adjustmentRow(rows[0]) : null;
	}

	async listMismatches(
		organizationId: string,
	): Promise<BillingMismatchRecord[]> {
		const results: BillingMismatchRecord[] = [];

		// 1. paid_unregistered: shopify order is fully paid, but no confirmed class entitlement
		const paidUnregisteredRows = (await sql.unsafe(
			`SELECT
				o.shopify_order_gid,
				o.currency_code,
				COALESCE(ci.customer_id, cc.customer_id, o.shopify_customer_gid, 'unknown') as customer_id,
				ci.amount as intent_amount
			 FROM ${this.schema}.shopify_order_projections o
			 LEFT JOIN ${this.schema}.class_entitlements ce
				ON ce.organization_id = o.organization_id
				AND ce.shopify_order_gid = o.shopify_order_gid
				AND ce.status = 'confirmed'
			 LEFT JOIN ${this.schema}.checkout_intents ci
				ON ci.organization_id = o.organization_id
				AND ci.correlation_id = o.correlation_id
			 LEFT JOIN ${this.schema}.checkout_carts cc
				ON cc.organization_id = o.organization_id
				AND cc.reference = ci.cart_reference
			 WHERE o.organization_id = $1
			   AND o.fully_paid_at IS NOT NULL
			   AND ce.id IS NULL`,
			[organizationId],
		)) as Array<Record<string, unknown>>;

		for (const row of paidUnregisteredRows) {
			const intentAmount = row.intent_amount
				? Math.round(Number.parseFloat(String(row.intent_amount)) * 100)
				: null;
			results.push({
				id: randomUUID(),
				organizationId,
				customerId: String(row.customer_id),
				mismatchType: "paid_unregistered",
				description:
					"Shopify order is fully paid but no class entitlement was created.",
				shopifyOrderId: String(row.shopify_order_gid),
				amountCents: intentAmount,
				currencyCode: row.currency_code ? String(row.currency_code) : "USD",
				createdAtIso: new Date().toISOString(),
			});
		}

		// 2. registered_unpaid: confirmed class entitlement exists, but order projection is missing or not fully paid and paidAmountCents == 0
		const registeredUnpaidRows = (await sql.unsafe(
			`SELECT
				ce.id as entitlement_id,
				ce.parent_customer_id as customer_id,
				ce.shopify_order_gid,
				ce.paid_amount_cents,
				ce.paid_currency_code
			 FROM ${this.schema}.class_entitlements ce
			 LEFT JOIN ${this.schema}.shopify_order_projections o
				ON o.organization_id = ce.organization_id
				AND o.shopify_order_gid = ce.shopify_order_gid
			 WHERE ce.organization_id = $1
			   AND ce.status = 'confirmed'
			   AND (o.shopify_order_gid IS NULL OR o.fully_paid_at IS NULL)
			   AND ce.paid_amount_cents = 0`,
			[organizationId],
		)) as Array<Record<string, unknown>>;

		for (const row of registeredUnpaidRows) {
			results.push({
				id: randomUUID(),
				organizationId,
				customerId: String(row.customer_id),
				mismatchType: "registered_unpaid",
				description:
					"Class entitlement is registered but payment has not been received.",
				entitlementId: String(row.entitlement_id),
				shopifyOrderId: String(row.shopify_order_gid),
				amountCents: 0,
				currencyCode: String(row.paid_currency_code),
				createdAtIso: new Date().toISOString(),
			});
		}

		// 3. partial_payment: confirmed class entitlement where paid amount < checkout intent price
		const partialPaymentRows = (await sql.unsafe(
			`SELECT
				ce.id as entitlement_id,
				ce.parent_customer_id as customer_id,
				ce.shopify_order_gid,
				ce.paid_amount_cents,
				ce.paid_currency_code,
				ci.amount as intent_amount
			 FROM ${this.schema}.class_entitlements ce
			 JOIN ${this.schema}.checkout_intents ci
				ON ci.organization_id = ce.organization_id
				AND ci.id = ce.checkout_intent_id
			 WHERE ce.organization_id = $1
			   AND ce.status = 'confirmed'
			   AND ci.amount IS NOT NULL
			   AND ce.paid_amount_cents > 0
			   AND ce.paid_amount_cents < ROUND(ci.amount::numeric * 100)`,
			[organizationId],
		)) as Array<Record<string, unknown>>;

		for (const row of partialPaymentRows) {
			results.push({
				id: randomUUID(),
				organizationId,
				customerId: String(row.customer_id),
				mismatchType: "partial_payment",
				description: "Partial payment received for class entitlement.",
				entitlementId: String(row.entitlement_id),
				shopifyOrderId: String(row.shopify_order_gid),
				amountCents: Number(row.paid_amount_cents),
				currencyCode: String(row.paid_currency_code),
				createdAtIso: new Date().toISOString(),
			});
		}

		return results;
	}
}
