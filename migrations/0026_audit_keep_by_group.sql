-- Recent operations: keep the newest 50 of each group, so a run of failed sign-ins or page edits
-- never pushes out the important records (MCP keys, devices, recovery, restores).
-- Groups: login (login_failed), edit (page_status), important (everything else).
DROP TRIGGER IF EXISTS audit_events_keep;
CREATE TRIGGER audit_events_keep AFTER INSERT ON audit_events BEGIN
  DELETE FROM audit_events WHERE id IN (
    SELECT id FROM audit_events
    WHERE (CASE event WHEN 'login_failed' THEN 'login' WHEN 'page_status' THEN 'edit' ELSE 'important' END)
        = (CASE NEW.event WHEN 'login_failed' THEN 'login' WHEN 'page_status' THEN 'edit' ELSE 'important' END)
    ORDER BY id DESC LIMIT -1 OFFSET 50);
END;
