-- PostgreSQL logistics persistence boundary. External order/seller IDs remain TEXT to support current Mongo ObjectIds.
BEGIN;
CREATE TYPE logistics_provider_type AS ENUM ('DIRECT','AGGREGATOR');
CREATE TABLE logistics_providers (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code VARCHAR(48) NOT NULL UNIQUE,
 name VARCHAR(120) NOT NULL, type logistics_provider_type NOT NULL,
 auth_schema_json JSONB NOT NULL DEFAULT '{}'::jsonb, is_active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX logistics_providers_active_type_idx ON logistics_providers(type,code) WHERE is_active;
CREATE TABLE seller_carrier_configs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), seller_id TEXT NOT NULL,
 provider_id UUID NOT NULL REFERENCES logistics_providers(id) ON DELETE RESTRICT,
 encrypted_credentials TEXT NOT NULL, webhook_secret TEXT NOT NULL,
 priority_rank SMALLINT NOT NULL DEFAULT 100 CHECK(priority_rank>=0), is_active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(seller_id,provider_id)
);
CREATE INDEX seller_carrier_configs_active_priority_idx ON seller_carrier_configs(seller_id,priority_rank) WHERE is_active;
CREATE TABLE warehouses (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), seller_id TEXT NOT NULL, warehouse_code VARCHAR(64) NOT NULL,
 name VARCHAR(120) NOT NULL, contact_name VARCHAR(120) NOT NULL, contact_phone VARCHAR(24) NOT NULL,
 address_line1 VARCHAR(180) NOT NULL, address_line2 VARCHAR(180), locality VARCHAR(120),
 city VARCHAR(100) NOT NULL, state VARCHAR(100) NOT NULL, postal_code VARCHAR(12) NOT NULL,
 country_code CHAR(2) NOT NULL DEFAULT 'IN', latitude NUMERIC(9,6), longitude NUMERIC(9,6),
 is_default BOOLEAN NOT NULL DEFAULT FALSE, is_active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(seller_id,warehouse_code)
);
CREATE INDEX warehouses_seller_active_idx ON warehouses(seller_id,is_active);
CREATE UNIQUE INDEX warehouses_one_default_per_seller_idx ON warehouses(seller_id) WHERE is_default AND is_active;
CREATE TABLE shipments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id TEXT NOT NULL,
 seller_carrier_config_id UUID NOT NULL REFERENCES seller_carrier_configs(id) ON DELETE RESTRICT,
 warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
 provider_shipment_id VARCHAR(120), awb_number VARCHAR(120),
 normalized_status SMALLINT NOT NULL DEFAULT 10 CHECK(normalized_status IN(10,20,30,40,50,60,70,80,90)),
 label_url TEXT, cod_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK(cod_amount_minor>=0),
 currency CHAR(3) NOT NULL DEFAULT 'INR', estimated_delivery_at TIMESTAMPTZ, last_event_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX shipments_order_idx ON shipments(order_id,created_at DESC);
-- This platform creates one parcel shipment per seller order. Use a package table before enabling multi-parcel orders.
CREATE UNIQUE INDEX shipments_one_per_order_idx ON shipments(order_id);
CREATE INDEX shipments_warehouse_status_idx ON shipments(warehouse_id,normalized_status,updated_at DESC);
CREATE UNIQUE INDEX shipments_config_awb_unique_idx ON shipments(seller_carrier_config_id,awb_number) WHERE awb_number IS NOT NULL;
CREATE TABLE shipment_tracking_events (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE RESTRICT,
 event_hash CHAR(64) NOT NULL, status_code SMALLINT NOT NULL CHECK(status_code IN(10,20,30,40,50,60,70,80,90)),
 location_code VARCHAR(64), event_timestamp TIMESTAMPTZ NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 provider_event_id VARCHAR(160), UNIQUE(shipment_id,event_hash)
);
CREATE INDEX shipment_tracking_timeline_idx ON shipment_tracking_events(shipment_id,event_timestamp DESC,id DESC);
CREATE INDEX shipment_tracking_status_idx ON shipment_tracking_events(status_code,event_timestamp DESC);
CREATE FUNCTION reject_tracking_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'shipment_tracking_events is append-only'; END; $$;
CREATE TRIGGER shipment_tracking_events_append_only BEFORE UPDATE OR DELETE ON shipment_tracking_events
 FOR EACH ROW EXECUTE FUNCTION reject_tracking_event_mutation();

-- Catalog entries used by the seller onboarding UI. Replace auth hints as vendor contracts are verified.
INSERT INTO logistics_providers(code,name,type,auth_schema_json) VALUES
 ('shadowfax','Shadowfax','DIRECT','{"fields":[{"name":"apiKey","label":"API key","type":"password"}]}'),
 ('shiprocket','Shiprocket','AGGREGATOR','{"fields":[{"name":"email","label":"Account email","type":"email"},{"name":"password","label":"Account password","type":"password"}]}')
ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,type=EXCLUDED.type,auth_schema_json=EXCLUDED.auth_schema_json;

CREATE TABLE logistics_jobs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 job_type VARCHAR(48) NOT NULL,
 payload JSONB NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','COMPLETED','FAILED')),
 attempts SMALLINT NOT NULL DEFAULT 0,
 max_attempts SMALLINT NOT NULL DEFAULT 5,
 available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 locked_at TIMESTAMPTZ,
 last_error TEXT,
 result JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 completed_at TIMESTAMPTZ
);
CREATE INDEX logistics_jobs_claim_idx ON logistics_jobs(status,available_at,created_at) WHERE status='PENDING';

-- Atomic queue claim. SKIP LOCKED allows multiple worker replicas without duplicate claims.
CREATE OR REPLACE FUNCTION claim_logistics_job()
RETURNS SETOF logistics_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $
DECLARE claimed logistics_jobs;
BEGIN
 UPDATE logistics_jobs SET status='FAILED',locked_at=NULL,last_error=COALESCE(last_error,'Worker lease expired after maximum attempts')
 WHERE status='PROCESSING' AND locked_at<now()-interval '10 minutes' AND attempts>=max_attempts;
 SELECT * INTO claimed FROM logistics_jobs
 WHERE ((status='PENDING' AND available_at<=now()) OR (status='PROCESSING' AND locked_at<now()-interval '10 minutes')) AND attempts<max_attempts
 ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE logistics_jobs SET status='PROCESSING',locked_at=now(),attempts=attempts+1 WHERE id=claimed.id RETURNING * INTO claimed;
 RETURN NEXT claimed;
END; $;

-- Atomic webhook update: idempotency, timestamp monotonicity, DAG edge, event append and shipment mutation.
CREATE OR REPLACE FUNCTION apply_logistics_webhook(
 p_shipment_id UUID,p_event_hash CHAR(64),p_status_code SMALLINT,p_location_code VARCHAR,
 p_event_timestamp TIMESTAMPTZ,p_expected_status SMALLINT,p_expected_last_event_at TIMESTAMPTZ DEFAULT NULL
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $
DECLARE current_row shipments; valid_edge BOOLEAN := FALSE;
BEGIN
 SELECT * INTO current_row FROM shipments WHERE id=p_shipment_id FOR UPDATE;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 IF current_row.normalized_status<>p_expected_status THEN RETURN FALSE; END IF;
 IF current_row.last_event_at IS DISTINCT FROM p_expected_last_event_at THEN RETURN FALSE; END IF;
 IF current_row.last_event_at IS NOT NULL AND p_event_timestamp<=current_row.last_event_at THEN RETURN FALSE; END IF;
 IF EXISTS(SELECT 1 FROM shipment_tracking_events WHERE shipment_id=p_shipment_id AND event_hash=p_event_hash) THEN RETURN FALSE; END IF;
 -- Accept skipped forward milestones and repeated same-state scans; never allow a backwards transition.
 valid_edge := p_status_code=current_row.normalized_status OR CASE current_row.normalized_status
  WHEN 10 THEN p_status_code IN (20,30,40,50,60,70,90)
  WHEN 20 THEN p_status_code IN (30,40,50,60,70,90)
  WHEN 30 THEN p_status_code IN (40,50,60,70)
  WHEN 40 THEN p_status_code IN (50,60,70)
  WHEN 60 THEN p_status_code IN (30,40,70)
  WHEN 70 THEN p_status_code IN (80)
  ELSE FALSE END;
 IF NOT valid_edge THEN RETURN FALSE; END IF;
 INSERT INTO shipment_tracking_events(shipment_id,event_hash,status_code,location_code,event_timestamp)
 VALUES(p_shipment_id,p_event_hash,p_status_code,p_location_code,p_event_timestamp);
 UPDATE shipments SET normalized_status=p_status_code,last_event_at=p_event_timestamp,updated_at=now() WHERE id=p_shipment_id;
 RETURN TRUE;
END; $;


-- A default-warehouse change and insert are one transaction, protected by the partial unique index.
CREATE OR REPLACE FUNCTION create_seller_warehouse(p_seller_id TEXT,p_warehouse JSONB)
RETURNS SETOF warehouses LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $
DECLARE created warehouses;
BEGIN
 IF COALESCE((p_warehouse->>'is_default')::boolean,FALSE) THEN
  UPDATE warehouses SET is_default=FALSE,updated_at=now() WHERE seller_id=p_seller_id AND is_default=TRUE;
 END IF;
 INSERT INTO warehouses(seller_id,warehouse_code,name,contact_name,contact_phone,address_line1,address_line2,locality,city,state,postal_code,country_code,is_default)
 VALUES(p_seller_id,p_warehouse->>'warehouse_code',p_warehouse->>'name',p_warehouse->>'contact_name',p_warehouse->>'contact_phone',
  p_warehouse->>'address_line1',NULLIF(p_warehouse->>'address_line2',''),NULLIF(p_warehouse->>'locality',''),
  p_warehouse->>'city',p_warehouse->>'state',p_warehouse->>'postal_code',COALESCE(p_warehouse->>'country_code','IN'),
  COALESCE((p_warehouse->>'is_default')::boolean,FALSE))
 RETURNING * INTO created;
 RETURN NEXT created;
END; $;


CREATE OR REPLACE FUNCTION create_shipment_intent(
 p_order_id TEXT,p_seller_id TEXT,p_carrier_config_id UUID,p_warehouse_id UUID,
 p_cod_amount_minor BIGINT,p_currency CHAR(3),p_payload JSONB
) RETURNS TABLE(shipment_id UUID,job_id UUID,created BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $
DECLARE v_shipment_id UUID; v_job_id UUID;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM seller_carrier_configs WHERE id=p_carrier_config_id AND seller_id=p_seller_id AND is_active) THEN
  RAISE EXCEPTION 'CARRIER_CONFIG_NOT_OWNED_OR_INACTIVE';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM warehouses WHERE id=p_warehouse_id AND seller_id=p_seller_id AND is_active) THEN
  RAISE EXCEPTION 'WAREHOUSE_NOT_OWNED_OR_INACTIVE';
 END IF;
 INSERT INTO shipments(order_id,seller_carrier_config_id,warehouse_id,normalized_status,cod_amount_minor,currency)
 VALUES(p_order_id,p_carrier_config_id,p_warehouse_id,10,p_cod_amount_minor,p_currency)
 ON CONFLICT(order_id) DO NOTHING RETURNING id INTO v_shipment_id;
 IF v_shipment_id IS NULL THEN
  SELECT id INTO v_shipment_id FROM shipments WHERE order_id=p_order_id;
  RETURN QUERY SELECT v_shipment_id,NULL::UUID,FALSE;
  RETURN;
 END IF;
 INSERT INTO logistics_jobs(job_type,payload,status,attempts,max_attempts)
 VALUES('CREATE_SHIPMENT',p_payload||jsonb_build_object('shipmentId',v_shipment_id), 'PENDING',0,5)
 RETURNING id INTO v_job_id;
 RETURN QUERY SELECT v_shipment_id,v_job_id,TRUE;
END; $;

-- Service-role-only access. The application never exposes the service-role key to browsers.
ALTER TABLE logistics_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_carrier_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE logistics_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON logistics_providers,seller_carrier_configs,warehouses,shipments,shipment_tracking_events,logistics_jobs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON logistics_providers TO service_role;
GRANT SELECT,INSERT,UPDATE ON seller_carrier_configs,warehouses,shipments,logistics_jobs TO service_role;
GRANT SELECT,INSERT ON shipment_tracking_events TO service_role;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
REVOKE EXECUTE ON FUNCTION claim_logistics_job() FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION apply_logistics_webhook(UUID,CHAR(64),SMALLINT,VARCHAR,TIMESTAMPTZ,SMALLINT,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION create_seller_warehouse(TEXT,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION create_shipment_intent(TEXT,TEXT,UUID,UUID,BIGINT,CHAR(3),JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION claim_logistics_job() TO service_role;
GRANT EXECUTE ON FUNCTION apply_logistics_webhook(UUID,CHAR(64),SMALLINT,VARCHAR,TIMESTAMPTZ,SMALLINT,TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION create_seller_warehouse(TEXT,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION create_shipment_intent(TEXT,TEXT,UUID,UUID,BIGINT,CHAR(3),JSONB) TO service_role;

COMMIT;
-- Compact status codes: 10 CREATED,20 MANIFESTED,30 IN_TRANSIT,40 OUT_FOR_DELIVERY,
-- 50 DELIVERED,60 NDR,70 RTO_INITIATED,80 RTO_DELIVERED,90 CANCELLED.
-- Encrypt TEXT AES-256-GCM envelopes with the app's 32-byte ENCRYPTION_MASTER_KEY; never store keys here.
-- Apply only after provisioning PostgreSQL. Do not dual-write existing MongoDB orders without a
-- separately reviewed backfill/reconciliation/cutover plan. Revoke UPDATE/DELETE on event table from app roles.
