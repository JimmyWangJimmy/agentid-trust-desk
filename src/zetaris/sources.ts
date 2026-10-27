// Single source of truth for the Zetaris federation layer.
// Each entry becomes (a) a CREATE LIGHTNING REST TABLE + CACHE TABLE +
// CREATE SCHEMASTORE VIEW in sql/zetaris/01_trustdesk_create.sql for a real
// Zetaris instance, and (b) a table in the local simulator.
export const PAGES_BASE = process.env.TRUSTDESK_DATA_BASE ?? "https://jimmywangjimmy.github.io/agentid-trust-desk/data/internal";
export const LIGHTNING_DB = "TRUSTDESK_REST";
export const CONTAINER = "trustdesk";

export interface Column { name: string; type: "TEXT" | "INTEGER" | "REAL" | "BOOLEAN"; expr?: string }
export interface Source {
  view: string;              // trustdesk.<view>
  restTable: string;         // TRUSTDESK_REST.<restTable>
  endpoint: string;
  shape: "records" | "object";  // {"records":[...]} (exploded) or one top-level object per endpoint
  columns: Column[];
  system: string;            // the enterprise system the dataset stands for
  localFile?: string;        // simulator reads this instead of fetching, when present
}

const rec = (view: string, system: string, columns: Column[]): Source => ({
  view, restTable: `${view}_raw`, endpoint: `${PAGES_BASE}/${view}.json`, shape: "records", columns, system,
  localFile: `data/internal/${view}.json`,
});

export const SOURCES: Source[] = [
  rec("vendor_registry", "Procurement / vendor-risk register", [
    { name: "agent_name", type: "TEXT" }, { name: "scorer_agent_id", type: "INTEGER" }, { name: "official_agent_id", type: "INTEGER" },
    { name: "vendor_org", type: "TEXT" }, { name: "kyb_status", type: "TEXT" }, { name: "contract_status", type: "TEXT" },
    { name: "declared_owner_wallet", type: "TEXT" }, { name: "business_owner", type: "TEXT" }, { name: "onboarded_at", type: "TEXT" },
    { name: "self_description", type: "TEXT" },
  ]),
  rec("customer_wallets", "CRM customer export", [
    { name: "wallet", type: "TEXT" }, { name: "customer_id", type: "TEXT" }, { name: "segment", type: "TEXT" },
    { name: "first_order", type: "TEXT" }, { name: "orders_90d", type: "INTEGER" },
  ]),
  rec("incidents", "Incident tracker", [
    { name: "ticket_id", type: "TEXT" }, { name: "agent_name", type: "TEXT" }, { name: "severity", type: "TEXT" },
    { name: "category", type: "TEXT" }, { name: "opened_at", type: "TEXT" }, { name: "status", type: "TEXT" }, { name: "summary", type: "TEXT" },
  ]),
  rec("gateway_usage", "API gateway analytics", [
    { name: "agent_name", type: "TEXT" }, { name: "usage_window", type: "TEXT" }, { name: "requests", type: "INTEGER" },
    { name: "error_rate", type: "REAL" }, { name: "out_of_scope_calls", type: "INTEGER" }, { name: "pii_fields_requested", type: "INTEGER" },
    { name: "rate_limit_hits", type: "INTEGER" }, { name: "scopes", type: "TEXT" },
  ]),
];

// Public ERC-8004 registration files (the agentURI each agent registered on-chain).
// AgentID moved to the TalentOS-AI org; the on-chain tokenURIs still point at the old jimmywangjimmy.github.io/AgentID path (404), so Zetaris reads the cards from the current Pages host.
export const AGENT_CARD_SOURCES = [
  { agent: "GoodBot", restTable: "card_goodbot_raw", endpoint: "https://talentos-ai.github.io/AgentID/agents/good-bot.json" },
  { agent: "FakeBot", restTable: "card_fakebot_raw", endpoint: "https://talentos-ai.github.io/AgentID/agents/fake-bot.json" },
  { agent: "SybilBot", restTable: "card_sybilbot_raw", endpoint: "https://talentos-ai.github.io/AgentID/agents/sybil-bot.json" },
];
export const AGENT_CARD_COLUMNS: Column[] = [
  { name: "name", type: "TEXT" }, { name: "description", type: "TEXT" }, { name: "active", type: "BOOLEAN" },
  { name: "x402_support", type: "BOOLEAN", expr: "x402Support" }, { name: "agent_uri", type: "TEXT" },
];
