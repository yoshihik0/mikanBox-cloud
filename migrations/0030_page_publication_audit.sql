DROP TRIGGER IF EXISTS audit_posts_update;
CREATE TRIGGER audit_posts_update AFTER UPDATE ON posts WHEN (OLD.id IS NOT NEW.id OR CASE WHEN json_valid(OLD.data) AND json_valid(NEW.data) THEN json_remove(OLD.data,'$.updated_at','$.status','$.revision_tag','$.first_published_at') IS NOT json_remove(NEW.data,'$.updated_at','$.status','$.revision_tag','$.first_published_at') ELSE OLD.data IS NOT NEW.data END) AND NOT EXISTS(SELECT 1 FROM settings WHERE key='audit_quiet') BEGIN
  INSERT INTO audit_events(at,event,target,from_value) VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now'),'page_updated',NEW.id,CASE WHEN OLD.id IS NOT NEW.id THEN OLD.id ELSE '' END);
END;
