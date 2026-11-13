import { sql } from "bun";
import { initializePostgresSchema } from "../../infra/s11-infra.js";
import { validateCheckoutSchemaName } from "./checkout-intent-helpers.js";
import {
	checkCompletedOrderOrEntitlementSql,
	consumeRecoveryRequestTx,
	createRecoveryRequestTx,
	findRecoverableIntentByIdQuery,
	findRecoveryRequestByTokenHashQuery,
	getRecoveryRequestByIdQuery,
	invalidateIntentTx,
	listRecoverableIntentsQuery,
} from "./checkout-recovery-queries.js";
import type {
	CheckoutRecoveryRepository,
	CheckoutRecoveryRequestRecord,
	ConsumeRecoveryRequestParams,
	CreateRecoveryRequestParams,
	RecoverableCheckoutIntentRecord,
} from "./checkout-recovery-types.js";

export class PostgresCheckoutRecoveryRepository
	implements CheckoutRecoveryRepository
{
	private readonly schema: string;

	constructor(schema: string) {
		this.schema = validateCheckoutSchemaName(schema);
	}

	async ensureReady(): Promise<void> {
		await initializePostgresSchema(this.schema);
	}

	async hasCompletedOrderOrEntitlement(
		organizationId: string,
		intentId: string,
		correlationId: string,
	): Promise<boolean> {
		return checkCompletedOrderOrEntitlementSql(
			sql,
			this.schema,
			organizationId,
			intentId,
			correlationId,
		);
	}

	async listRecoverableIntents(
		paramsOrOrg: { organizationId: string; customerId: string } | string,
		maybeCustomerId?: string,
	): Promise<RecoverableCheckoutIntentRecord[]> {
		const orgId =
			typeof paramsOrOrg === "string"
				? paramsOrOrg
				: paramsOrOrg.organizationId;
		const custId =
			typeof paramsOrOrg === "string"
				? (maybeCustomerId ?? "")
				: paramsOrOrg.customerId;
		return listRecoverableIntentsQuery(sql, this.schema, orgId, custId);
	}

	async invalidateIntent(
		paramsOrOrg:
			| { organizationId: string; intentId: string; reason?: string }
			| string,
		maybeIntentId?: string,
	): Promise<void> {
		const orgId =
			typeof paramsOrOrg === "string"
				? paramsOrOrg
				: paramsOrOrg.organizationId;
		const intentId =
			typeof paramsOrOrg === "string"
				? (maybeIntentId ?? "")
				: paramsOrOrg.intentId;
		await sql.begin((tx) =>
			invalidateIntentTx(tx, this.schema, orgId, intentId),
		);
	}

	async createRecoveryRequest(
		params: CreateRecoveryRequestParams,
	): Promise<CheckoutRecoveryRequestRecord> {
		return sql.begin((tx) => createRecoveryRequestTx(tx, this.schema, params));
	}

	async findRecoveryRequestByTokenHash(
		tokenHashOrParams: string | { tokenHash: string; organizationId?: string },
		maybeOrgId?: string,
	): Promise<CheckoutRecoveryRequestRecord | null> {
		const tokenHash =
			typeof tokenHashOrParams === "string"
				? tokenHashOrParams
				: tokenHashOrParams.tokenHash;
		const orgId =
			typeof tokenHashOrParams === "string"
				? maybeOrgId
				: tokenHashOrParams.organizationId;
		return findRecoveryRequestByTokenHashQuery(
			sql,
			this.schema,
			tokenHash,
			orgId,
		);
	}

	async getRecoveryRequestById(
		organizationId: string,
		id: string,
	): Promise<CheckoutRecoveryRequestRecord | null> {
		return getRecoveryRequestByIdQuery(sql, this.schema, organizationId, id);
	}

	async findIntentById(
		organizationId: string,
		intentId: string,
	): Promise<RecoverableCheckoutIntentRecord | null> {
		return findRecoverableIntentByIdQuery(
			sql,
			this.schema,
			organizationId,
			intentId,
		);
	}

	async consumeRecoveryRequest(
		paramsOrToken: ConsumeRecoveryRequestParams | string,
		maybeOrgId?: string,
	): Promise<CheckoutRecoveryRequestRecord> {
		return sql.begin((tx) =>
			consumeRecoveryRequestTx(tx, this.schema, paramsOrToken, maybeOrgId),
		);
	}
}
