-- Adaptive carrier feedback, scoped to seller + destination region + carrier service.
BEGIN;

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS service_code VARCHAR(120);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS destination_postal_code VARCHAR(12);

CREATE TABLE IF NOT EXISTS carrier_performance_feedback (
  seller_id TEXT NOT NULL,
  provider_code VARCHAR(48) NOT NULL,
  service_code VARCHAR(120) NOT NULL,
  region_code VARCHAR(12) NOT NULL,
  attempts BIGINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  delivered_count BIGINT NOT NULL DEFAULT 0 CHECK (delivered_count >= 0),
  rto_count BIGINT NOT NULL DEFAULT 0 CHECK (rto_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (seller_id, provider_code, service_code, region_code),
  CHECK (delivered_count + rto_count <= attempts)
);
CREATE INDEX IF NOT EXISTS carrier_feedback_lookup_idx
  ON carrier_performance_feedback(seller_id, region_code, provider_code, service_code);

CREATE TABLE IF NOT EXISTS carrier_outcome_events (
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE RESTRICT,
  event_hash CHAR(64) NOT NULL,
  status_code SMALLINT NOT NULL CHECK (status_code IN (50,80)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (shipment_id, event_hash)
);

-- Persist quote attributes needed for seller/region/service feedback.
CREATE OR REPLACE FUNCTION create_shipment_intent(
 p_order_id TEXT,p_seller_id TEXT,p_carrier_config_id UUID,p_warehouse_id UUID,
 p_cod_amount_minor BIGINT,p_currency CHAR(3),p_payload JSONB
) RETURNS TABLE(shipment_id UUID,job_id UUID,created BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $logistics$
DECLARE v_shipment_id UUID; v_job_id UUID;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM seller_carrier_configs WHERE id=p_carrier_config_id AND seller_id=p_seller_id AND is_active) THEN
  RAISE EXCEPTION 'CARRIER_CONFIG_NOT_OWNED_OR_INACTIVE';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM warehouses WHERE id=p_warehouse_id AND seller_id=p_seller_id AND is_active) THEN
  RAISE EXCEPTION 'WAREHOUSE_NOT_OWNED_OR_INACTIVE';
 END IF;
 INSERT INTO shipments(order_id,seller_carrier_config_id,warehouse_id,normalized_status,cod_amount_minor,currency,service_code,destination_postal_code)
 VALUES(p_order_id,p_carrier_config_id,p_warehouse_id,10,p_cod_amount_minor,p_currency,
        NULLIF(p_payload->>'serviceCode',''),NULLIF(p_payload->>'destinationPostalCode',''))
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
END; $logistics$;

-- Only count a terminal outcome that was accepted into the append-only tracking event log.
-- Unique (shipment,event) makes retries safe, including a crash between webhook apply and feedback update.
CREATE OR REPLACE FUNCTION record_carrier_outcome(p_shipment_id UUID,p_event_hash CHAR(64),p_status_code SMALLINT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $logistics$
DECLARE s shipments; seller_key TEXT; provider_key VARCHAR(48); service_key VARCHAR(120); region_key VARCHAR(12); inserted_id UUID;
BEGIN
 IF p_status_code NOT IN (50,80) THEN RETURN FALSE; END IF;
 SELECT * INTO s FROM shipments WHERE id=p_shipment_id;
 IF NOT FOUND OR NOT EXISTS(
   SELECT 1 FROM shipment_tracking_events
   WHERE shipment_id=p_shipment_id AND event_hash=p_event_hash AND status_code=p_status_code
 ) THEN RETURN FALSE; END IF;
 SELECT c.seller_id,p.code INTO seller_key,provider_key
 FROM seller_carrier_configs c JOIN logistics_providers p ON p.id=c.provider_id
 WHERE c.id=s.seller_carrier_config_id;
 IF seller_key IS NULL THEN RETURN FALSE; END IF;
 service_key := COALESCE(NULLIF(s.service_code,''),'default');
 region_key := COALESCE(NULLIF(left(s.destination_postal_code,3),''),'GLOBAL');
 INSERT INTO carrier_outcome_events(shipment_id,event_hash,status_code)
 VALUES(p_shipment_id,p_event_hash,p_status_code)
 ON CONFLICT(shipment_id,event_hash) DO NOTHING
 RETURNING shipment_id INTO inserted_id;
 IF inserted_id IS NULL THEN RETURN FALSE; END IF;
 INSERT INTO carrier_performance_feedback(seller_id,provider_code,service_code,region_code,attempts,delivered_count,rto_count)
 VALUES(seller_key,provider_key,service_key,region_key,1,CASE WHEN p_status_code=50 THEN 1 ELSE 0 END,CASE WHEN p_status_code=80 THEN 1 ELSE 0 END)
 ON CONFLICT(seller_id,provider_code,service_code,region_code) DO UPDATE SET
  attempts=carrier_performance_feedback.attempts+1,
  delivered_count=carrier_performance_feedback.delivered_count+EXCLUDED.delivered_count,
  rto_count=carrier_performance_feedback.rto_count+EXCLUDED.rto_count,
  updated_at=now();
 RETURN TRUE;
END; $logistics$;

ALTER TABLE carrier_performance_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_outcome_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON carrier_performance_feedback,carrier_outcome_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON carrier_performance_feedback TO service_role;
REVOKE EXECUTE ON FUNCTION record_carrier_outcome(UUID,CHAR(64),SMALLINT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION record_carrier_outcome(UUID,CHAR(64),SMALLINT) TO service_role;
GRANT EXECUTE ON FUNCTION create_shipment_intent(TEXT,TEXT,UUID,UUID,BIGINT,CHAR(3),JSONB) TO service_role;

COMMIT;
