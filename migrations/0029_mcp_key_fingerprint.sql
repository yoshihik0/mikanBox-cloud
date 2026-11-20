-- 0.18.0: the MCP API key is stored only as its fingerprint ("sha256:" + hex) and shown once, when it
-- is issued (src/mcp.ts mcpKeyStore). A key stored in plain text by an earlier version cannot be
-- turned into a fingerprint here, so it is retired: issue a new key once after updating.
UPDATE settings SET value=json_set(value,'$.api_key','')
 WHERE key='settings' AND json_valid(value)
   AND COALESCE(json_extract(value,'$.api_key'),'')<>''
   AND json_extract(value,'$.api_key') NOT LIKE 'sha256:%';
DELETE FROM settings WHERE key='mcp_last_used';
