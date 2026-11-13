import { randomUUID } from "node:crypto";
import {
	AppError,
	type BillingAdjustment,
	type BillingAdjustmentType,
	type BillingLedgerDirection,
	type BillingLedgerEntry,
	type BillingLedgerEntryType,
	type BillingMismatchRecord,
	type CreateBillingAdjustmentInput,
	type CreditBalance,
} from "@festival/common";
import { sql } from "bun";
import {
	initializePostgresSchema,
	postgresSchemaName,
} from "../../infra/s11-infra.js";
import {
	adjustmentFromRow,
	balanceFromRow,
	findDuplicateReferenceTx,
	insertAdjustmentAndLedgerRowsTx,
	ledgerFromRow,
	lockCreditBalanceTx,
	queryPaidUnregisteredMismatches,
	queryPartialPaymentMismatches,
	queryRegisteredUnpaidMismatches,
	updateCreditBalanceRowTx,
} from "./billing-queries.js";

export class DuplicateAdjustmentError extends AppError {
	constructor(
		message = "Adjustment with this reference already exists.",
		readonly existingAdjustment?: BillingAdjustment,
	) {
		super(message, 409, "DUPLICATE_ADJUSTMENT");
	}
}

export class InsufficientCreditBalanceError extends AppError {
	constructor(message = "Credit balance cannot be negative.") {
		super(message, 400, "INSUFFICIENT_CREDIT_BALANCE");
	}
}

export interface CreateAdjustmentOptions {
	notes?: string | null;
	entryType?: BillingLedgerEntryType;
	direction?: BillingLedgerDirection;
}

export interface CreateAdjustmentResult {
	adjustment: BillingAdjustment;
	ledgerEntry: BillingLedgerEntry;
	creditBalance: CreditBalance;
}

export interface BillingRepository {
	createAdjustmentWithLedger(
		input: CreateBillingAdjustmentInput,
		options?: CreateAdjustmentOptions,
	): Promise<CreateAdjustmentResult>;
	getCreditBalance(
		organizationId: string,
		customerId: string,
	): Promise<CreditBalance | null>;
	listLedgerEntries(
		organizationId: string,
		customerId: string,
	): Promise<BillingLedgerEntry[]>;
	listAdjustments(
		organizationId: string,
		customerId?: string,
	): Promise<BillingAdjustment[]>;
	findAdjustmentByReference(
		organizationId: string,
		referenceType: string | null | undefined,
		referenceId: string,
	): Promise<BillingAdjustment | null>;
	listMismatches(organizationId: string): Promise<BillingMismatchRecord[]>;
}

export function resolveAdjustmentDirection(
	adjustmentType: BillingAdjustmentType,
	explicitDirection?: BillingLedgerDirection,
): BillingLedgerDirection {
	if (explicitDirection) return explicitDirection;
	switch (adjustmentType) {
		case "credit_issue":
		case "refund":
			return "inflow";
		case "credit_apply":
		case "manual_charge":
		case "write_off":
			return "outflow";
	}
}

export function resolveLedgerEntryType(
	adjustmentType: BillingAdjustmentType,
	direction: BillingLedgerDirection,
	explicitEntryType?: BillingLedgerEntryType,
): BillingLedgerEntryType {
	if (explicitEntryType) return explicitEntryType;
	if (adjustmentType === "credit_issue") return "credit";
	if (adjustmentType === "credit_apply") return "debit";
	return direction === "inflow" ? "credit" : "adjustment";
}

export class PostgresBillingRepository implements BillingRepository {
	private readonly schema: string;

	constructor(
		schema: string,
		private readonly ensureReadyFn?: () => Promise<void>,
	) {
		this.schema = postgresSchemaName(schema);
	}

	async ensureReady(): Promise<void> {
		if (this.ensureReadyFn) {
			await this.ensureReadyFn();
			return;
		}
		await initializePostgresSchema(this.schema);
	}

	async createAdjustmentWithLedger(
		input: CreateBillingAdjustmentInput,
		options?: CreateAdjustmentOptions,
	): Promise<CreateAdjustmentResult> {
		return (await sql.begin(async (tx) => {
			return this.executeAdjustmentTx(tx, input, options);
		})) as CreateAdjustmentResult;
	}

	private async executeAdjustmentTx(
		tx: Pick<typeof sql, "unsafe">,
		input: CreateBillingAdjustmentInput,
		options?: CreateAdjustmentOptions,
	): Promise<CreateAdjustmentResult> {
		const { currentBalanceCents, currencyCode } = await lockCreditBalanceTx(
			tx,
			this.schema,
			input,
		);
		const duplicate = await findDuplicateReferenceTx(tx, this.schema, input);
		if (duplicate) {
			throw new DuplicateAdjustmentError(
				`Adjustment for reference "${input.referenceId}" already exists.`,
				duplicate,
			);
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
		const { adjustment, ledgerEntry } = await insertAdjustmentAndLedgerRowsTx(
			tx,
			this.schema,
			{
				adjustmentId: randomUUID(),
				input,
				currencyCode,
				direction,
				entryType,
				newBalanceCents,
				notes: options?.notes ?? null,
			},
		);
		const creditBalance = await updateCreditBalanceRowTx(
			tx,
			this.schema,
			input,
			newBalanceCents,
			currencyCode,
		);
		return { adjustment, ledgerEntry, creditBalance };
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
		return rows[0] ? balanceFromRow(rows[0]) : null;
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
		return rows.map(ledgerFromRow);
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
		return rows.map(adjustmentFromRow);
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
		return rows[0] ? adjustmentFromRow(rows[0]) : null;
	}

	async listMismatches(
		organizationId: string,
	): Promise<BillingMismatchRecord[]> {
		const [paidUnregistered, registeredUnpaid, partialPayment] =
			await Promise.all([
				queryPaidUnregisteredMismatches(this.schema, organizationId),
				queryRegisteredUnpaidMismatches(this.schema, organizationId),
				queryPartialPaymentMismatches(this.schema, organizationId),
			]);
		return [...paidUnregistered, ...registeredUnpaid, ...partialPayment];
	}
}
