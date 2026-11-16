-- Provider-owned carrier accounts and seller-approved fulfilment delegation.
-- Apply after 2026-11-logistics-postgres.sql and 2026-11-carrier-adaptive-feedback.sql.
BEGIN;

CREATE TABLE IF NOT EXISTS provider_carrier_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id TEXT NOT NULL,
  provider_id UUID NOT NULL REFERENCES logistics_providers(id) ON DELETE RESTRICT,
  encrypted_credentials TEXT NOT NULL,
  webhook_secret TEXT NOT NULL,
  priority_rank SMALLINT NOT NULL DEFAULT 100 CHECK (priority_rank >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider_user_id, provider_id)
);
CREATE INDEX IF NOT EXISTS provider_carrier_configs_active_idx
  ON provider_carrier_configs(provider_user_id, priority_rank) WHERE is_active;

CREATE TABLE IF NOT EXISTS provider_warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id TEXT NOT NULL,
  warehouse_code VARCHAR(64) NOT NULL,
  name VARCHAR(120) NOT NULL,
  contact_name VARCHAR(120) NOT NULL,
  contact_phone VARCHAR(24) NOT NULL,
  address_line1 VARCHAR(180) NOT NULL,
  address_line2 VARCHAR(180),
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  postal_code VARCHAR(12) NOT NULL,
  country_code CHAR(2) NOT NULL DEFAULT 'IN',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider_user_id, warehouse_code)
);
CREATE INDEX IF NOT EXISTS provider_warehouses_active_idx
  ON provider_warehouses(provider_user_id, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS provider_warehouses_one_default_idx
  ON provider_warehouses(provider_user_id) WHERE is_default AND is_active;

ALTER TABLE shipments ALTER COLUMN seller_carrier_config_id DROP NOT NULL;
ALTER TABLE shipments ALTER COLUMN warehouse_id DROP NOT NULL;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS provider_carrier_config_id UUID
  REFERENCES provider_carrier_configs(id) ON DELETE RESTRICT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS provider_warehouse_id UUID
  REFERENCES provider_warehouses(id) ON DELETE RESTRICT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS fulfillment_seller_id TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS fulfillment_provider_id TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS manual_carrier_name VARCHAR(120);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS manual_tracking_reference VARCHAR(160);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS manual_tracking_url TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS booking_mode VARCHAR(16) NOT NULL DEFAULT 'APP' CHECK (booking_mode IN ('APP','MANUAL'));
ALTER TABLE shipments ADD CONSTRAINT shipments_exactly_one_carrier_owner CHECK (
  (seller_carrier_config_id IS NOT NULL AND provider_carrier_config_id IS NULL)
  OR (seller_carrier_config_id IS NULL AND provider_carrier_config_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS shipments_provider_config_idx
  ON shipments(provider_carrier_config_id, created_at DESC) WHERE provider_carrier_config_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS shipments_provider_config_awb_unique_idx
  ON shipments(provider_carrier_config_id, awb_number)
  WHERE provider_carrier_config_id IS NOT NULL AND awb_number IS NOT NULL;

CREATE OR REPLACE FUNCTION create_provider_warehouse(p_provider_user_id TEXT, p_warehouse JSONB)
RETURNS SETOF provider_warehouses
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE created provider_warehouses;
BEGIN
  IF COALESCE((p_warehouse->>'is_default')::boolean, FALSE) THEN
    UPDATE provider_warehouses SET is_default=FALSE, updated_at=now()
    WHERE provider_user_id=p_provider_user_id AND is_default=TRUE;
  END IF;
  INSERT INTO provider_warehouses(provider_user_id,warehouse_code,name,contact_name,contact_phone,address_line1,address_line2,city,state,postal_code,country_code,is_default)
  VALUES(p_provider_user_id,p_warehouse->>'warehouse_code',p_warehouse->>'name',p_warehouse->>'contact_name',p_warehouse->>'contact_phone',
    p_warehouse->>'address_line1',NULLIF(p_warehouse->>'address_line2',''),p_warehouse->>'city',p_warehouse->>'state',
    p_warehouse->>'postal_code',COALESCE(p_warehouse->>'country_code','IN'),COALESCE((p_warehouse->>'is_default')::boolean,FALSE))
  RETURNING * INTO created;
  RETURN NEXT created;
END; $fn$;

CREATE OR REPLACE FUNCTION create_provider_shipment_intent(
  p_order_id TEXT,p_seller_id TEXT,p_provider_user_id TEXT,p_provider_carrier_config_id UUID,
  p_provider_warehouse_id UUID,p_cod_amount_minor BIGINT,p_currency CHAR(3),p_payload JSONB
) RETURNS TABLE(shipment_id UUID,job_id UUID,created BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_shipment_id UUID; v_job_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM provider_carrier_configs
    WHERE id=p_provider_carrier_config_id AND provider_user_id=p_provider_user_id AND is_active) THEN
    RAISE EXCEPTION 'PROVIDER_CARRIER_CONFIG_NOT_OWNED_OR_INACTIVE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM provider_warehouses
    WHERE id=p_provider_warehouse_id AND provider_user_id=p_provider_user_id AND is_active) THEN
    RAISE EXCEPTION 'PROVIDER_WAREHOUSE_NOT_OWNED_OR_INACTIVE';
  END IF;
  INSERT INTO shipments(order_id,provider_carrier_config_id,provider_warehouse_id,fulfillment_seller_id,fulfillment_provider_id,
    normalized_status,cod_amount_minor,currency,service_code,destination_postal_code,booking_mode)
  VALUES(p_order_id,p_provider_carrier_config_id,p_provider_warehouse_id,p_seller_id,p_provider_user_id,
    10,p_cod_amount_minor,p_currency,NULLIF(p_payload->>'serviceCode',''),NULLIF(p_payload->>'destinationPostalCode',''),'APP')
  ON CONFLICT(order_id) DO NOTHING RETURNING id INTO v_shipment_id;
  IF v_shipment_id IS NULL THEN
    SELECT id INTO v_shipment_id FROM shipments WHERE order_id=p_order_id;
    RETURN QUERY SELECT v_shipment_id,NULL::UUID,FALSE;
    RETURN;
  END IF;
  INSERT INTO logistics_jobs(job_type,payload,status,attempts,max_attempts)
  VALUES('CREATE_SHIPMENT',p_payload||jsonb_build_object('shipmentId',v_shipment_id),'PENDING',0,5)
  RETURNING id INTO v_job_id;
  RETURN QUERY SELECT v_shipment_id,v_job_id,TRUE;
END; $fn$;

CREATE OR REPLACE FUNCTION retry_provider_shipment_booking(p_shipment_id UUID,p_provider_user_id TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE previous_payload JSONB; new_job_id UUID;
BEGIN
  SELECT j.payload INTO previous_payload
  FROM logistics_jobs j JOIN shipments s ON s.id=(j.payload->>'shipmentId')::uuid
  JOIN provider_carrier_configs c ON c.id=s.provider_carrier_config_id
  WHERE s.id=p_shipment_id AND c.provider_user_id=p_provider_user_id AND c.is_active
    AND s.booking_status='FAILED' AND s.awb_number IS NULL
  ORDER BY j.created_at DESC LIMIT 1;
  IF previous_payload IS NULL THEN RAISE EXCEPTION 'PROVIDER_SHIPMENT_NOT_RETRYABLE'; END IF;
  INSERT INTO logistics_jobs(job_type,payload,status,attempts,max_attempts)
  VALUES('CREATE_SHIPMENT',previous_payload,'PENDING',0,5) RETURNING id INTO new_job_id;
  UPDATE shipments SET booking_status='PENDING',updated_at=now() WHERE id=p_shipment_id;
  RETURN new_job_id;
END; $fn$;

ALTER TABLE provider_carrier_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_warehouses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON provider_carrier_configs,provider_warehouses FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON provider_carrier_configs,provider_warehouses TO service_role;
GRANT EXECUTE ON FUNCTION create_provider_warehouse(TEXT,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION create_provider_shipment_intent(TEXT,TEXT,TEXT,UUID,UUID,BIGINT,CHAR(3),JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION retry_provider_shipment_booking(UUID,TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION create_provider_warehouse(TEXT,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION create_provider_shipment_intent(TEXT,TEXT,TEXT,UUID,UUID,BIGINT,CHAR(3),JSONB) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION retry_provider_shipment_booking(UUID,TEXT) FROM PUBLIC,anon,authenticated;

COMMIT;
