# 0126 — AI connections and personas: one schema, guided setup

**Status:** accepted plan (2026-11-13). **Owner:** AngryVibes LLC.
**Changes:** the provider and persona parts of [0124](0124-ai-personas-and-machine-loops.md)
("Managed in the panel"). Memories, value requests and inject/redeem in 0124 are unchanged.

## Review of what exists (2026-11-13)

The work is started, not finished. What is sound and kept:

- Storage in `vx_ai_providers`, `vx_ai_personas`, `vx_ai_memories`; credentials encrypted with the
  instance root key and never returned; one active connection; the 17 routes under `/api/vx/v1/ai`
  (Go `internal/server/api/assistant/handler.go`, proxied by `routes/vx/assistant-router.ts`).
- Default personas as `platform/engine/ai/personas/<slug>/PERSONA.md`; routing by mention, page
  domain, then the router; tools only from the persona's domains and only read-only ones.
- Memory safeguards: credential-shaped text refused, memories framed as notes, personal memories
  private.

What is rewritten, because it does not meet the standard below (pre-release, so routes change in
place with every caller and stored rows migrate, per AGENTS.md):

| Gap | Where |
| --- | --- |
| No schema: Go, the database and the UI each define their own rules; units differ (Go counts bytes, Postgres characters, the UI UTF-16 units) | provider.go, persona.go, migrations, dialogs |
| The UI validates nothing; every mistake is a server toast | ProviderDialog, PersonaDialog |
| No model settings (temperature, top-p, output limit, stop sequences) and no per-persona tool allowlist or handoffs | persona.go, agent.go |
| Only five vendor kinds; anything else is "OpenAI-compatible" with a Bearer key and nothing more; no Hugging Face | provider.go, model.go |
| Region length unbounded in Go (database error instead of 400); test message cut mid-character; base URL silently kept for Bedrock and Vertex | provider.go |
| Persona domains unchecked in the database; memory `source` set by the client; deleting a persona leaves memories pointing at nothing | migration, memory.go |
| Routing settings and "Try it" from 0124 never built; the guard is never invoked | handler.go, agent.go |
| Hooks break the repo layout (`queries.ts` holds mutations) | `hooks/api/assistant/` |

## The standard

Fields follow what the major agent definitions share, so a persona or connection written for one
reads naturally in the others: OpenAI Agents SDK (`name`, `instructions`, `model`,
`model_settings`, `tools`, `handoffs`), Anthropic Messages (`system`, `max_tokens`, `temperature`,
`top_p`, `stop_sequences`, `tools`, `tool_choice`), Google ADK (`name`, `description`,
`instruction`, `sub_agents`) and the A2A agent card (`name`, `description`, `version`, `skills`).

Two JSON Schemas (draft 2020-12) are the single source of truth. They live with the engine, in
`platform/engine/backend-go/internal/services/assistant/spec/schema/`, because the engine image
and its Go tests see only `platform/engine`:

- `vaultix.ai-connection.v1.schema.json`
- `vaultix.ai-persona.v1.schema.json`

The Go service embeds them and serves them to the UI at `GET /api/vx/v1/ai/schema`. The UI builds
its form rules from that response (no Zod).

Every length is in Unicode characters. `spec/testdata/` holds one fixture set of valid and invalid
documents. Each fixture says whether the schema accepts it and whether the server does: a few
cases, such as a key pasted into an extra header, are refused only by server rules. Go checks the
fixtures in `assistant/documents_test.go`. Ajv checks them against the schemas in
`scripts/test-ai-contracts.mjs`, which is a canonical build step.

Default `PERSONA.md` files are v1 documents. The front matter holds every field except
`instructions`, which is the body. The loader reads the front matter strictly, so an unknown key
is refused, and it validates the file with the same rules as the API.

### Connection

| Field | Rule |
| --- | --- |
| `schemaVersion` | `vaultix.ai-connection.v1` |
| `name` | 1–64 characters |
| `kind` | `anthropic`, `openai`, `bedrock`, `vertex`, `huggingface`, `huggingface-endpoint`, `custom` |
| `endpoint` | `huggingface-endpoint` and `custom`: https URL (http only for loopback), ≤512, no credentials, query or fragment. Fixed for vendor kinds, which do not take one. |
| `apiStyle` | `custom` only: `openai-chat` or `anthropic-messages` |
| `auth` | `custom` only: `bearer`, `header` (with `headerName`), or `none` |
| `headers` | `custom` only: up to 8 non-secret headers; names `^[A-Za-z0-9-]{1,64}$`, values ≤256 and refused if credential-shaped |
| `region`, `cloudProject` | Bedrock and Vertex, bounded (≤32, ≤30) |
| `billTo` | `huggingface` only: the account or organization billed (`X-HF-Bill-To`) |
| `models` | `standard` required; `fast`, `deep` optional; each ≤128, `^[A-Za-z0-9._:/@-]+$` |
| `credential` | write-only and encrypted; its fields depend on `kind` |
| `timeoutSeconds` | 5–120, default 60 |

Read-only fields: `id`, `active`, `hasCredential`, `lastTest` (outcome, message, latency, which
models answered, whether tool calls work), timestamps.

### Persona

| Field | Rule |
| --- | --- |
| `schemaVersion` | `vaultix.ai-persona.v1` |
| `slug` | `^[a-z][a-z0-9-]{1,31}$`, immutable |
| `name` | 1–64 |
| `description` | 1–300: when to use this persona (the router reads it) |
| `role` | `router`, `specialist`, `guard` |
| `domains` | 1–8 of the canonical domains in `docs/interaction/workflows.json` |
| `instructions` | 1–16,384 |
| `model` | `{ connectionId?, tier: fast\|standard\|deep, id? }` |
| `modelSettings` | `temperature` 0–2, `topP` 0–1, `maxOutputTokens` 1–32,000, `stopSequences` ≤4 × ≤64, `toolChoice` `auto\|none` |
| `tools` | `null` (every read-only tool of its domains) or an allowlist drawn from the warp-point catalog; a persona can only narrow |
| `handoffs` | router only: the specialists it may pick |
| `memory` | `use: all\|instance\|none` |
| `enabled` | the router cannot be disabled |

## Admin › AI

One page, five tabs:

1. **Connections.** "Add connection" opens a choice of cards: Anthropic, OpenAI, Amazon Bedrock,
   Google Vertex, Hugging Face, Custom. Each opens a guided form for that kind only, with inline
   validation from the schema, "Load models", and a test that calls each model and checks tool
   calls before the connection can be used.
2. **Personas.** The same schema-driven form for defaults and custom personas: identity,
   instructions, model and settings, tools (picked from the catalog by domain), handoffs, memory.
3. **Routing.** Which specialist answers each domain, and the router's model.
4. **Memories.** As today.
5. **Try it.** Send a message as any persona and see the route, model, tool calls and answer.

### Hugging Face, guided

1. **Token.** A link opens Hugging Face's token page with the fine-grained "Make calls to
   Inference Providers" permission preselected. The person pastes the token into the form. It is
   checked against Hugging Face, which returns the account name and organizations, and is stored
   encrypted only on save. It never goes into chat.
2. **Where it runs.** Either:
   - **Inference Providers.** Requests go through `https://router.huggingface.co/v1`
     (OpenAI-compatible). The person picks who pays: their account or one of their
     organizations, sent as `X-HF-Bill-To`. They pick a model from the router's `/v1/models` list
     and a provider policy: fastest, cheapest, their preferred order, or a named provider. These
     become the model ID suffix (`:fastest`, `:cheapest`, `:preferred`, `:groq`).
   - **Dedicated endpoint.** The person pastes the endpoint URL, or picks one from their account
     or organization. Vaultix appends `/v1` and uses the endpoint's model name.
3. **Test.** Calls the model and checks tool calls. Models without tool calls can still answer,
   but cannot run Vaultix actions. The UI says so before saving.

### Custom

Any OpenAI Chat Completions or Anthropic Messages endpoint, such as a self-hosted vLLM, Ollama,
LM Studio or a company gateway. The form takes:

- the endpoint URL
- the API style
- how the key is sent: Bearer, a named header, or none
- up to eight extra non-secret headers
- the model IDs

The same test applies.

## Build order

Each step is one commit, verified before the next.

1. **Contracts. Done 2026-11-13.**
   - Both schemas and 77 shared fixtures; Go and Ajv agree on every one.
   - The `spec` package and `CheckConnection` / `CheckPersona`.
   - The default personas are converted to v1 and loaded through the same rules.
2. **Store and runtime. Done 2026-11-14.**
   - Migration `20261114100000_vx-ai-v1-documents` maps stored rows to v1 with no credential read:
     - `openai-compatible` becomes `custom` with `openai-chat`, sending a Bearer key if one is stored.
     - An Anthropic or OpenAI connection with its own address becomes `custom` of the matching style.
     - Bedrock and Vertex lose the address field.
     - Persona domains gain a database check on their values.
   - Routes: `GET/POST /ai/connections` and `PUT/DELETE /ai/connections/{id}`, plus `/test` and
     `/models`. `PUT /ai/personas/{slug}` replaces the old `PATCH`. Every body is a whole v1
     document, and refusals carry `details.fields` with each path and its message.
   - The connection test calls every model, then asks the standard model to call one probe tool, and
     records whether tool calls work.
   - Clients: Hugging Face (router, `X-HF-Bill-To`), Hugging Face endpoints (`/v1` appended once), and
     Custom (OpenAI or Anthropic style, with the key as Bearer, in a named header, or not sent, plus
     extra headers).
   - Personas apply their settings:
     - temperature, top-p, output limit and stop sequences go into the request;
     - tool use `none` offers no tools, and a tool list narrows the read-only tools of the persona's
       areas;
     - memory use `instance` or `none` limits which memories reach the prompt;
     - the router chooses only among its handoffs.
   - Deleting a custom persona removes the memories that applied only to it. Pasted keys are trimmed.
   - Not done: the guard still does not act. The assistant runs read-only tools only, so there is no
     proposed change for it to review yet.
3. **Hugging Face helpers. Done 2026-11-14.** `POST /ai/huggingface/account` takes a token, or an
   existing connection's stored token. It returns the account, its organizations, and whether a
   fine-grained token may call Inference Providers. `POST /ai/huggingface/endpoints` lists the
   dedicated endpoints of an account or organization. Both are instance-admin only and keep nothing.
4. **UI.** The hooks move to `queries.tsx`, `mutations.tsx` and `types.tsx`. The five tabs, the
   guided connection forms and the schema-driven persona form are built.
5. **Proof.** `scripts/test-assistant-image.mjs` gains an OpenAI-compatible and an
   Anthropic-compatible test server inside the test network. It proves Custom, Hugging Face (by
   address override) and the persona settings on the packaged image. Then the capability
   baseline is recaptured.

A real Hugging Face call needs the owner's token, entered in the UI. That check is listed as
pending until the owner runs it.

Sources: [Inference Providers](https://huggingface.co/docs/inference-providers/index),
[billing to an organization](https://huggingface.co/docs/inference-providers/pricing),
[dedicated endpoints with the OpenAI client](https://huggingface.co/docs/inference-endpoints/tutorials/chat_bot),
[TGI Messages API](https://huggingface.co/docs/text-generation-inference/messages_api).
