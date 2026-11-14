import { TAiConnectionKind } from "@app/hooks/api/assistant";

export type TConnectionCardKind = Exclude<TAiConnectionKind, "huggingface-endpoint">;

type TKindDetails = {
  label: string;
  summary: string;
  defaultName: string;
  // Offered in the model fields before the connection's own list is loaded.
  suggestedModels: string[];
};

export const KIND_DETAILS: Record<TAiConnectionKind, TKindDetails> = {
  anthropic: {
    label: "Anthropic",
    summary: "Claude through the Anthropic API with an API key.",
    defaultName: "Anthropic",
    suggestedModels: [
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
      "claude-fable-5-2"
    ]
  },
  openai: {
    label: "OpenAI",
    summary: "OpenAI models through the OpenAI API with an API key.",
    defaultName: "OpenAI",
    suggestedModels: []
  },
  bedrock: {
    label: "Amazon Bedrock",
    summary: "Models in your AWS account, signed with an access key.",
    defaultName: "Amazon Bedrock",
    suggestedModels: []
  },
  vertex: {
    label: "Google Vertex",
    summary: "Models in your Google Cloud project, with a service account key.",
    defaultName: "Google Vertex",
    suggestedModels: []
  },
  huggingface: {
    label: "Hugging Face",
    summary: "Inference Providers or a dedicated endpoint, with a Hugging Face token.",
    defaultName: "Hugging Face",
    suggestedModels: []
  },
  "huggingface-endpoint": {
    label: "Hugging Face endpoint",
    summary: "A dedicated Hugging Face Inference Endpoint.",
    defaultName: "Hugging Face endpoint",
    suggestedModels: ["tgi"]
  },
  custom: {
    label: "Custom",
    summary: "Any OpenAI Chat Completions or Anthropic Messages endpoint, such as vLLM or Ollama.",
    defaultName: "Custom",
    suggestedModels: []
  }
};

export const CARD_KINDS: TConnectionCardKind[] = [
  "anthropic",
  "openai",
  "bedrock",
  "vertex",
  "huggingface",
  "custom"
];

export const kindLabel = (kind: TAiConnectionKind) => KIND_DETAILS[kind]?.label ?? kind;

export const HF_TOKEN_URL =
  "https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained";

export const MODEL_ID_HINT = "Use letters, digits and . _ : / @ - only, with no spaces.";

export const NO_TOOL_CALLS = "This model can answer but cannot run Vaultix actions.";
