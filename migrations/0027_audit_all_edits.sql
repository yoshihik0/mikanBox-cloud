-- 0.16.0: every change to pages, components, media and settings is recorded in the recent
-- operations, whichever way it was made (admin screen, visual editing, MCP, data import).
-- The database records it itself (the triggers below), so no way of writing can leave it out;
-- the Worker then fills in who made it and the content's sha256 (src/audit.ts claimAudit).
-- A data import sets the 'audit_quiet' setting inside its own batch and records one line instead.
ALTER TABLE audit_events ADD COLUMN before_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE audit_events ADD COLUMN after_hash TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS audit_events_actor ON audit_events(actor,id);

-- Kept per group: important 50, site edits 500, failed sign-ins 50.
DROP TRIGGER IF EXISTS audit_events_keep;
CREATE TRIGGER audit_events_keep AFTER INSERT ON audit_events BEGIN
  DELETE FROM audit_events WHERE id IN (
    SELECT id FROM audit_events WHERE (CASE WHEN event='login_failed' THEN 'login' WHEN event IN ('page_status','page_created','page_updated','page_deleted','component_created','component_updated','component_deleted','media_uploaded','media_changed','media_deleted','settings_changed','data_imported') THEN 'edit' ELSE 'important' END) = (CASE WHEN NEW.event='login_failed' THEN 'login' WHEN NEW.event IN ('page_status','page_created','page_updated','page_deleted','component_created','component_updated','component_deleted','media_uploaded','media_changed','media_deleted','settings_changed','data_imported') THEN 'edit' ELSE 'important' END)
    ORDER BY id DESC LIMIT -1 OFFSET (CASE (CASE WHEN NEW.event='login_failed' THEN 'login' WHEN NEW.event IN ('page_status','page_created','page_updated','page_deleted','component_created','component_updated','component_deleted','media_uploaded','media_changed','media_deleted','settings_changed','data_imported') THEN 'edit' ELSE 'important' END) WHEN 'edit' THEN 500 ELSE 50 END));
END;

CREATE TRIGGER audit_posts_insert AFTER INSERT ON posts WHEN NOT EXISTS(SELECT 1 FROM settings WHERE key='audit_quiet') BEGIN
  INSERT INTO audit_events(at,event,target,to_value) VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now'),'page_created',NEW.id,NEW.status);
END;
CREATE TRIGGER audit_posts_status AFTER UPDATE ON posts WHEN OLD.status IS NOT NEW.status AND NOT EXISTS(SELECT 1 FROM settings WHERE key='audit_quiet') BEGIN
  INSERT INTO audit_events(at,event,target,from_value,to_value) VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now'),'page_status',NEW.id,OLD.status,NEW.status);
END;
CREATE TRIGGER audit_posts_update AFTER UPDATE ON posts WHEN (OLD.id IS NOT NEW.id OR CASE WHEN json_valid(OLD.data) AND json_valid(NEW.data) THEN json_remove(OLD.data,'$.updated_at','$.status','$.revision_tag') IS NOT json_remove(NEW.data,'$.updated_at','$.status','$.revision_tag') ELSE OLD.data IS NOT NEW.data END) AND NOT EXISTS(SELECT 1 FROM settings WHERE key='audit_quiet') BEGIN
  INSERT INTO audit_events(at,event,target,from_value) VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now'),'page_updated',NEW.id,CASE WHEN OLD.id IS NOT NEW.id THEN OLD.id ELSE '' END);
END;
CREATE TRIGGER audit_posts_delete AFTER DELETE ON posts WHEN NOT EXISTS(SELECT 1 FROM settings WHERE key='audit_quiet') BEGIN
  INSERT INTO audit_events(at,event,target) VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now'),'page_deleted',OLD.id);
END;

CREATE TRIGGER audit_components_insert AFTER INSERT ON components WHEN NOT EXISTS(SELECT 1 FROM settings WHERE key='audit_quiet') BEGIN
  INSERT INTO audit_events(at,event,target) VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now'),'component_created',NEW.id);
END;
CREATE TRIGGER audit_components_update AFTER UPDATE ON components WHEN (OLD.id IS NOT NEW.id OR CASE WHEN json_valid(OLD.data) AND json_valid(NEW.data) THEN json_remove(OLD.data,'$.updated_at','$.status','$.revision_tag') IS NOT json_remove(NEW.data,'$.updated_at','$.status','$.revision_tag') ELSE OLD.data IS NOT NEW.data END) AND NOT EXISTS(SELECT 1 FROM settings WHERE key='audit_quiet') BEGIN
  INSERT INTO audit_events(at,event,target,from_value) VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now'),'component_updated',NEW.id,CASE WHEN OLD.id IS NOT NEW.id THEN OLD.id ELSE '' END);
END;
CREATE TRIGGER audit_components_delete AFTER DELETE ON components WHEN NOT EXISTS(SELECT 1 FROM settings WHERE key='audit_quiet') BEGIN
  INSERT INTO audit_events(at,event,target) VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now'),'component_deleted',OLD.id);
END;

CREATE TRIGGER audit_media_insert AFTER INSERT ON media WHEN NOT EXISTS(SELECT 1 FROM settings WHERE key='audit_quiet') BEGIN
  INSERT INTO audit_events(at,event,target,after_hash) VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now'),'media_uploaded',NEW.key,COALESCE(NEW.etag,''));
END;
CREATE TRIGGER audit_media_update AFTER UPDATE ON media WHEN (OLD.key IS NOT NEW.key OR OLD.etag IS NOT NEW.etag) AND NOT EXISTS(SELECT 1 FROM settings WHERE key='audit_quiet') BEGIN
  INSERT INTO audit_events(at,event,target,from_value,before_hash,after_hash) VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now'),'media_changed',NEW.key,CASE WHEN OLD.key IS NOT NEW.key THEN OLD.key ELSE '' END,COALESCE(OLD.etag,''),COALESCE(NEW.etag,''));
END;
CREATE TRIGGER audit_media_delete AFTER DELETE ON media WHEN NOT EXISTS(SELECT 1 FROM settings WHERE key='audit_quiet') BEGIN
  INSERT INTO audit_events(at,event,target,before_hash) VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now'),'media_deleted',OLD.key,COALESCE(OLD.etag,''));
END;

-- Site settings: the names of the changed settings (never their values). The MCP key and the MCP
-- switch have records of their own. The Cloudflare connection is a separate row.
CREATE TRIGGER audit_settings_update AFTER UPDATE ON settings WHEN NEW.key='settings' AND OLD.value IS NOT NEW.value AND json_valid(OLD.value) AND json_valid(NEW.value) AND NOT EXISTS(SELECT 1 FROM settings WHERE key='audit_quiet') BEGIN
  INSERT INTO audit_events(at,event,target)
  SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now'),'settings_changed',names FROM (SELECT group_concat(k,',') AS names FROM (
    SELECT n.key AS k FROM json_each(NEW.value) n WHERE n.key NOT IN ('api_key','mcp_disabled')
      AND NOT EXISTS(SELECT 1 FROM json_each(OLD.value) o WHERE o.key=n.key AND o.type=n.type AND o.value IS n.value)
    UNION
    SELECT o.key FROM json_each(OLD.value) o WHERE o.key NOT IN ('api_key','mcp_disabled')
      AND NOT EXISTS(SELECT 1 FROM json_each(NEW.value) n WHERE n.key=o.key)
    ORDER BY 1)) WHERE names IS NOT NULL;
END;
CREATE TRIGGER audit_connection_insert AFTER INSERT ON settings WHEN NEW.key='cloud_connection' AND NOT EXISTS(SELECT 1 FROM settings WHERE key='audit_quiet') BEGIN
  INSERT INTO audit_events(at,event,target) VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now'),'settings_changed','cloud_connection');
END;
CREATE TRIGGER audit_connection_update AFTER UPDATE ON settings WHEN NEW.key='cloud_connection' AND OLD.value IS NOT NEW.value AND NOT EXISTS(SELECT 1 FROM settings WHERE key='audit_quiet') BEGIN
  INSERT INTO audit_events(at,event,target) VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now'),'settings_changed','cloud_connection');
END;
