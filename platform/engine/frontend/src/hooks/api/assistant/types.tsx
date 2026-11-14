import type { TJsonSchema } from "./validation";

export type TAiConnectionKind =
  | "anthropic"
  | "openai"
  | "bedrock"
  | "vertex"
  | "huggingface"
  | "huggingface-endpoint"
  | "custom";

export type TAiApiStyle = "openai-chat" | "anthropic-messages";
export type TAiAuthType = "bearer" | "header" | "none";

export type TAiConnectionModels = { standard: string; fast?: string; deep?: string };

export type TAiConnectionHeader = { name: string; value: string };

// Sent once and never read back. Which fields apply depends on the kind.
export type TAiConnectionCredential = {
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  serviceAccountJson?: string;
};

export type TAiConnectionTestRecord = {
  outcome: "passed" | "failed";
  message: string;
  testedAt: string;
  toolCalls: boolean | null;
};

// vaultix.ai-connection.v1, as written.
export type TAiConnectionDocument = {
  schemaVersion: "vaultix.ai-connection.v1";
  name: string;
  kind: TAiConnectionKind;
  endpoint?: string;
  apiStyle?: TAiApiStyle;
  auth?: { type: TAiAuthType; headerName?: string };
  headers?: TAiConnectionHeader[];
  region?: string;
  cloudProject?: string;
  billTo?: string;
  models: TAiConnectionModels;
  timeoutSeconds?: number;
  active?: boolean;
  credential?: TAiConnectionCredential;
};

export type TAiConnection = Omit<TAiConnectionDocument, "credential" | "active"> & {
  id: string;
  timeoutSeconds: number;
  active: boolean;
  hasCredential: boolean;
  lastTest: TAiConnectionTestRecord | null;
  createdAt: string;
  updatedAt: string;
};

export type TAiConnectionTest = {
  outcome: "passed" | "failed";
  message: string;
  latencyMs: number;
  testedAt: string;
  toolCalls: boolean | null;
};

export type TAiModelInfo = { id: string; name: string };

export type TAiConnectionModelList = {
  models: TAiModelInfo[];
  listed: boolean;
  message: string;
};

export type TAiPersonaRole = "router" | "specialist" | "guard";
export type TAiPersonaTier = "fast" | "standard" | "deep";
export type TAiMemoryUse = "all" | "instance" | "none";

export type TAiPersonaModelSettings = {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  toolChoice?: "auto" | "none";
};

// vaultix.ai-persona.v1, as written.
export type TAiPersonaDocument = {
  schemaVersion: "vaultix.ai-persona.v1";
  slug: string;
  name: string;
  description: string;
  role: TAiPersonaRole;
  domains: string[];
  instructions: string;
  model: { connectionId?: string; tier: TAiPersonaTier; id?: string };
  modelSettings?: TAiPersonaModelSettings;
  tools: string[] | null;
  handoffs?: string[];
  memory?: { use: TAiMemoryUse };
  enabled?: boolean;
};

export type TAiPersona = TAiPersonaDocument & {
  id: string;
  builtIn: boolean;
  customized: boolean;
  updatedAt: string | null;
};

export type TAiPersonaList = {
  personas: TAiPersona[];
  domains: string[];
  roles: TAiPersonaRole[];
  tiers: TAiPersonaTier[];
};

export type TAiSchemas = { connection: TJsonSchema; persona: TJsonSchema };

// Either a token typed into the form or an existing Hugging Face connection's stored token.
export type THuggingFaceTokenSource = { token: string } | { connectionId: string };

export type THuggingFaceAccount = {
  name: string;
  fullName: string;
  organizations: string[];
  // false: the fine-grained token lacks "Make calls to Inference Providers". null: not known.
  inferenceAllowed: boolean | null;
};

export type THuggingFaceEndpoint = { name: string; url: string; model: string; state: string };

export type TAssistantStatus = {
  available: boolean;
  reason?: string;
  provider?: { kind: TAiConnectionKind; model: string; name: string };
  personas: Pick<TAiPersona, "slug" | "name" | "role" | "description" | "domains">[];
};

export type TAssistantMessage = { role: "user" | "assistant"; content: string };

// A value-free record of what the person did (docs/0123). Never an input's value.
export type TAssistantSignal = {
  kind: "action" | "navigate";
  action?: string;
  scope?: string;
  target?: string;
  path?: string;
  at?: string;
};

export type TAssistantAction = {
  tool: string;
  domain: string;
  status: "ran" | "failed";
  error?: string;
};

// A memory the assistant suggested. Nothing is saved until the person accepts it.
export type TAssistantProposal = { content: string };

export type TAssistantReply = {
  message: TAssistantMessage;
  actions: TAssistantAction[];
  proposals: TAssistantProposal[];
  persona: { slug: string; name: string; role: TAiPersonaRole };
  routedBy: "mention" | "page" | "router" | "default";
  provider: { kind: TAiConnectionKind; model: string; name: string };
};

export type TAssistantMemoryScope = "personal" | "instance";

export type TAssistantMemory = {
  id: string;
  scope: TAssistantMemoryScope;
  content: string;
  // A persona's short name, or empty for every persona.
  persona: string;
  source: "person" | "assistant";
  createdAt: string;
  updatedAt: string;
};

export type TAssistantMemoryInput = {
  scope?: TAssistantMemoryScope;
  content?: string;
  persona?: string;
  source?: "person" | "assistant";
};
