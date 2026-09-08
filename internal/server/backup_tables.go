package server

// Central dependency order for logical backup/restore. New durable modules must
// extend this list and the completeness test. Ephemeral credentials/presence are
// deliberately not restored. Never derive SQL identifiers from a backup archive.
var backupTables = []string{
	"users", "organizations", "organization_members", "workspaces", "workspace_members",
	"spaces", "space_members", "workspace_settings", "workspace_settings_history",
	"storage_providers", "storage_settings", "storage_assignments", "canvases", "canvas_shares",
	"documents", "document_shares", "document_versions", "favorites", "comments", "attachments",
	"knowledge_document_meta", "knowledge_document_history",
	"databases", "database_rows", "settings", "settings_history", "audit_logs", "notifications", "api_keys",
	"document_collaboration", "job_settings", "automation_webhooks", "automation_rules",
	"automation_events", "automation_jobs", "automation_job_attempts", "automation_effects",
	"backup_policy", "backup_artifacts",
	"plugins", "workspace_plugins", "plugin_storage",
	"teams", "team_members", "comment_reactions",
	"identity_links", "identity_grants", "identity_managed_members", "migration_imports",
	"scim_users", "scim_groups", "scim_group_members",
	"connector_settings", "connector_configs", "connector_records", "connector_runs",
	"capture_receipts", "attachment_receipts",
	"sql_sources", "sql_source_tables", "sql_source_queries", "sql_source_proposals", "sql_source_runs",
	"task_details",
	"calendar_events",
	"approval_policy_clock", "approval_policies", "approval_requests", "approval_assignments", "approval_decisions",
	"notification_settings", "notification_channels", "notification_preferences", "notification_deliveries",
	"inbound_capture_settings", "inbound_capture_channels", "inbound_capture_messages",
	"runbook_settings", "runbook_runners", "runbook_runner_versions", "runbook_documents", "runbook_executions", "runbook_execution_steps", "runbook_events",
	"protection_settings", "protection_settings_history", "protection_events",
	"public_shares", "public_share_visits",
	"document_relations",
	"rag_index_grants",
	"document_templates", "document_template_versions",
	"ai_conversations", "ai_messages",
	"search_history_preferences", "search_history_entries",
	"workspace_agents", "agent_runs", "agent_events", "agent_sources", "agent_actions",
	"user_feature_flags", "user_feature_flags_history", "workspace_brand_assets",
	"git_sync_settings", "git_sync_connections", "git_sync_runs", "git_sync_mappings",
	"support_sessions",
	"export_settings", "export_runs",
	"graph_ai_runs", "graph_ai_sources", "graph_ai_actions", "graph_ai_annotations",
}

var ephemeralTables = []string{"sessions", "oidc_attempts", "collaboration_presence", "saml_authn_requests", "saml_assertion_replays", "notification_outbox", "search_chunks", "search_fragments", "search_index_documents", "search_index_queue", "public_share_access", "public_share_rate_limits", "rag_vector_indexes", "rag_vector_chunks", "rag_reindex_queue", "operations_http_errors", "export_artifact_blobs"}
