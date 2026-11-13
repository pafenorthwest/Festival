import { sql } from "bun";
import { validateCheckoutSchemaName } from "./checkout-intent-helpers.js";

export interface JoinedRegistrationRow {
	e_id: string;
	e_organization_id: string;
	e_festival_id: string;
	e_festival_class_id: string;
	e_parent_customer_id: string;
	e_child_id: string;
	e_checkout_intent_id: string;
	e_checkout_intent_line_id: string | null;
	e_shopify_order_gid: string;
	e_shopify_order_line_gid: string;
	e_paid_amount_cents: number;
	e_paid_currency_code: string;
	e_status: string;
	e_created_at: string | Date;
	e_updated_at: string | Date;
	fc_display_name: string | null;
	fc_class_subtype_id: string | null;
	fc_division_id: string | null;
	fc_minimum_age: number | null;
	fc_maximum_age: number | null;
	fc_price: string | null;
	fc_maximum_performance_pieces: number | null;
	fc_performance_minutes: number | null;
	fc_capacity: number | null;
	fc_is_active: boolean | null;
	c_display_name: string | null;
	p_fully_paid_at: string | Date | null;
	m_id: string | null;
	m_festival_id: string | null;
	m_class_entitlement_id: string | null;
	m_teacher_membership_id: string | null;
	m_accompanist_membership_id: string | null;
	m_repertoire_json: unknown;
	m_registration_snapshot: unknown;
	m_checkout_intent_id: string | null;
	m_checkout_intent_line_id: string | null;
	m_created_at: string | Date | null;
	ri_id: string | null;
	ri_repertoire_work_id: string | null;
	ri_title_snapshot: string | null;
	ri_performed_movement_text: string | null;
	ri_duration_seconds: number | null;
	ri_display_order: number | null;
	ric_id: string | null;
	ric_repertoire_contributor_id: string | null;
	ric_display_name_snapshot: string | null;
	ric_contributor_role: string | null;
	ric_position: number | null;
}

export async function queryConfirmedCountsSql(
	schema: string,
	organizationId: string,
	festivalClassIds: readonly string[],
): Promise<Map<string, number>> {
	if (festivalClassIds.length === 0) return new Map();
	const safeSchema = validateCheckoutSchemaName(schema);
	const rows = (await sql.unsafe(
		`SELECT festival_class_id, COUNT(*)::int AS count
		FROM ${safeSchema}.class_entitlements
		WHERE organization_id = $1
			AND festival_class_id = ANY($2::text[])
			AND status = 'confirmed'
		GROUP BY festival_class_id`,
		[organizationId, sql.array([...festivalClassIds], "text")],
	)) as Array<{ festival_class_id: string; count: number | string }>;
	return new Map(
		rows.map((row) => [String(row.festival_class_id), Number(row.count)]),
	);
}

export async function queryClassRegistrationsJoinedSql(
	schema: string,
	organizationId: string,
	parentCustomerId: string,
	festivalId?: string,
): Promise<JoinedRegistrationRow[]> {
	const safeSchema = validateCheckoutSchemaName(schema);
	return (await sql.unsafe(
		`SELECT
			e.id AS e_id, e.organization_id AS e_organization_id, e.festival_id AS e_festival_id,
			e.festival_class_id AS e_festival_class_id, e.parent_customer_id AS e_parent_customer_id,
			e.child_id AS e_child_id, e.checkout_intent_id AS e_checkout_intent_id,
			e.checkout_intent_line_id AS e_checkout_intent_line_id, e.shopify_order_gid AS e_shopify_order_gid,
			e.shopify_order_line_gid AS e_shopify_order_line_gid, e.paid_amount_cents AS e_paid_amount_cents,
			e.paid_currency_code AS e_paid_currency_code, e.status AS e_status,
			e.created_at AS e_created_at, e.updated_at AS e_updated_at,
			fc.display_name AS fc_display_name, fc.class_subtype_id AS fc_class_subtype_id,
			fc.division_id AS fc_division_id, fc.minimum_age AS fc_minimum_age,
			fc.maximum_age AS fc_maximum_age, fc.price AS fc_price,
			fc.maximum_performance_pieces AS fc_maximum_performance_pieces, fc.performance_minutes AS fc_performance_minutes,
			fc.capacity AS fc_capacity, fc.is_active AS fc_is_active,
			c.display_name AS c_display_name, p.fully_paid_at AS p_fully_paid_at,
			m.id AS m_id, m.festival_id AS m_festival_id, m.class_entitlement_id AS m_class_entitlement_id,
			m.teacher_membership_id AS m_teacher_membership_id, m.accompanist_membership_id AS m_accompanist_membership_id,
			m.repertoire_json AS m_repertoire_json, m.registration_snapshot AS m_registration_snapshot,
			m.checkout_intent_id AS m_checkout_intent_id, m.checkout_intent_line_id AS m_checkout_intent_line_id,
			m.created_at AS m_created_at, ri.id AS ri_id, ri.repertoire_work_id AS ri_repertoire_work_id,
			ri.title_snapshot AS ri_title_snapshot, ri.performed_movement_text AS ri_performed_movement_text,
			ri.duration_seconds AS ri_duration_seconds, ri.display_order AS ri_display_order,
			ric.id AS ric_id, ric.repertoire_contributor_id AS ric_repertoire_contributor_id,
			ric.display_name_snapshot AS ric_display_name_snapshot, ric.contributor_role AS ric_contributor_role,
			ric.position AS ric_position
		FROM ${safeSchema}.class_entitlements e
		LEFT JOIN ${safeSchema}.festival_class_configurations fc ON fc.id = e.festival_class_id AND fc.organization_id = e.organization_id
		LEFT JOIN ${safeSchema}.festival_children c ON c.id = e.child_id AND c.organization_id = e.organization_id
		LEFT JOIN ${safeSchema}.shopify_order_projections p ON p.shopify_order_gid = e.shopify_order_gid AND p.organization_id = e.organization_id
		LEFT JOIN ${safeSchema}.registration_metadata m ON m.class_entitlement_id = e.id AND m.organization_id = e.organization_id
		LEFT JOIN ${safeSchema}.registration_repertoire_items ri ON ri.registration_metadata_id = m.id AND ri.organization_id = e.organization_id
		LEFT JOIN ${safeSchema}.registration_repertoire_item_contributors ric ON ric.registration_repertoire_item_id = ri.id AND ric.organization_id = e.organization_id
		WHERE e.organization_id = $1 AND e.parent_customer_id = $2 AND ($3::text IS NULL OR e.festival_id = $3)
		ORDER BY e.created_at DESC, e.id ASC, ri.display_order ASC, ric.position ASC`,
		[organizationId, parentCustomerId, festivalId ?? null],
	)) as JoinedRegistrationRow[];
}
