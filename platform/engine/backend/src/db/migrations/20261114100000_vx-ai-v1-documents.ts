import type { Knex } from "knex";

// AI connections and personas become vaultix.ai-*.v1 documents (docs/0126). The Go service owns
// these rows and validates every write against the v1 schema. Existing rows are mapped so they keep
// working: an "openai-compatible" provider, or an Anthropic or OpenAI provider pointed at another
// address, is a custom connection of the matching API style; Bedrock and Vertex no longer take an
// address. No credential is read or rewritten.
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE vx_ai_providers DROP CONSTRAINT IF EXISTS vx_ai_providers_kind_check;
    ALTER TABLE vx_ai_providers
      ADD COLUMN "apiStyle" varchar(32) NOT NULL DEFAULT '' CHECK ("apiStyle" IN ('', 'openai-chat', 'anthropic-messages')),
      ADD COLUMN "authType" varchar(16) NOT NULL DEFAULT '' CHECK ("authType" IN ('', 'bearer', 'header', 'none')),
      ADD COLUMN "authHeaderName" varchar(64) NOT NULL DEFAULT '',
      ADD COLUMN headers jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(headers) = 'array' AND jsonb_array_length(headers) <= 8),
      ADD COLUMN "billTo" varchar(96) NOT NULL DEFAULT '',
      ADD COLUMN "timeoutSeconds" integer NOT NULL DEFAULT 60 CHECK ("timeoutSeconds" BETWEEN 5 AND 120),
      ADD COLUMN "lastTestTools" boolean;

    UPDATE vx_ai_providers
      SET kind = 'custom', "apiStyle" = 'openai-chat',
          "authType" = CASE WHEN "encryptedCredential" IS NULL THEN 'none' ELSE 'bearer' END
      WHERE kind = 'openai-compatible';
    UPDATE vx_ai_providers
      SET kind = 'custom', "apiStyle" = 'openai-chat', "authType" = 'bearer'
      WHERE kind = 'openai' AND "baseUrl" <> '';
    UPDATE vx_ai_providers
      SET kind = 'custom', "apiStyle" = 'anthropic-messages', "authType" = 'header', "authHeaderName" = 'x-api-key'
      WHERE kind = 'anthropic' AND "baseUrl" <> '';
    UPDATE vx_ai_providers SET "baseUrl" = '' WHERE kind IN ('bedrock', 'vertex');

    ALTER TABLE vx_ai_providers ADD CONSTRAINT vx_ai_providers_kind_check
      CHECK (kind IN ('anthropic', 'openai', 'bedrock', 'vertex', 'huggingface', 'huggingface-endpoint', 'custom'));

    ALTER TABLE vx_ai_personas
      ADD COLUMN "modelSettings" jsonb CHECK ("modelSettings" IS NULL OR jsonb_typeof("modelSettings") = 'object'),
      ADD COLUMN tools text[] CHECK (tools IS NULL OR cardinality(tools) <= 64),
      ADD COLUMN handoffs text[] CHECK (handoffs IS NULL OR cardinality(handoffs) <= 16),
      ADD COLUMN "memoryUse" varchar(16) NOT NULL DEFAULT 'all' CHECK ("memoryUse" IN ('all', 'instance', 'none')),
      ADD CONSTRAINT vx_ai_personas_domains_known CHECK (domains <@ ARRAY['public', 'auth', 'workspace', 'secrets', 'access',
        'automation', 'connect', 'pki', 'kms', 'pam', 'detect', 'ai', 'governance', 'operate', 'experience']::text[]);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    LOCK TABLE vx_ai_personas, vx_ai_providers IN ACCESS EXCLUSIVE MODE;
    ALTER TABLE vx_ai_providers DROP CONSTRAINT vx_ai_providers_kind_check;
    UPDATE vx_ai_providers SET kind = 'openai-compatible'
      WHERE kind = 'custom' AND "apiStyle" = 'openai-chat' AND "authType" IN ('bearer', 'none') AND headers = '[]'::jsonb;
    UPDATE vx_ai_providers SET kind = 'anthropic'
      WHERE kind = 'custom' AND "apiStyle" = 'anthropic-messages' AND "authType" = 'header' AND "authHeaderName" = 'x-api-key' AND headers = '[]'::jsonb;
    DO $body$ BEGIN
      IF EXISTS (SELECT 1 FROM vx_ai_providers WHERE kind IN ('huggingface', 'huggingface-endpoint', 'custom'))
        OR EXISTS (SELECT 1 FROM vx_ai_personas WHERE "modelSettings" IS NOT NULL OR tools IS NOT NULL OR handoffs IS NOT NULL OR "memoryUse" <> 'all') THEN
        RAISE EXCEPTION 'v1 AI connections or persona settings exist; retain this migration during binary rollback';
      END IF;
    END $body$;
    ALTER TABLE vx_ai_personas DROP CONSTRAINT vx_ai_personas_domains_known,
      DROP COLUMN "modelSettings", DROP COLUMN tools, DROP COLUMN handoffs, DROP COLUMN "memoryUse";
    ALTER TABLE vx_ai_providers DROP COLUMN "apiStyle", DROP COLUMN "authType", DROP COLUMN "authHeaderName",
      DROP COLUMN headers, DROP COLUMN "billTo", DROP COLUMN "timeoutSeconds", DROP COLUMN "lastTestTools";
    ALTER TABLE vx_ai_providers ADD CONSTRAINT vx_ai_providers_kind_check
      CHECK (kind IN ('anthropic', 'bedrock', 'vertex', 'openai', 'openai-compatible'));
  `);
}
