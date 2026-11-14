import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "@app/config/request";

import { AI_BASE_URL, assistantKeys } from "./queries";
import {
  TAiConnection,
  TAiConnectionDocument,
  TAiConnectionTest,
  TAiPersona,
  TAiPersonaDocument,
  TAssistantMemory,
  TAssistantMemoryInput,
  TAssistantMessage,
  TAssistantReply,
  TAssistantSignal,
  THuggingFaceAccount,
  THuggingFaceEndpoint,
  THuggingFaceTokenSource
} from "./types";

// Forms show these refusals beside the fields they name, so the shared toast stays quiet.
const inlineRefusals = { handledErrorCodes: ["BadRequest"] };
const inlineHelperErrors = { handledErrorCodes: ["BadRequest", "BadGateway"] };

const useInvalidateMemories = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: assistantKeys.memories() });
};

const useInvalidateAssistant = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: assistantKeys.all });
};

export const useCreateAssistantMemory = () => {
  const invalidate = useInvalidateMemories();
  return useMutation({
    mutationFn: async (input: TAssistantMemoryInput) => {
      const { data } = await apiRequest.post<{ memory: TAssistantMemory }>(
        `${AI_BASE_URL}/memories`,
        input
      );
      return data.memory;
    },
    onSuccess: invalidate
  });
};

export const useUpdateAssistantMemory = () => {
  const invalidate = useInvalidateMemories();
  return useMutation({
    mutationFn: async ({ id, ...input }: TAssistantMemoryInput & { id: string }) => {
      const { data } = await apiRequest.patch<{ memory: TAssistantMemory }>(
        `${AI_BASE_URL}/memories/${id}`,
        input
      );
      return data.memory;
    },
    onSuccess: invalidate
  });
};

export const useDeleteAssistantMemory = () => {
  const invalidate = useInvalidateMemories();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiRequest.delete<{ memory: TAssistantMemory }>(
        `${AI_BASE_URL}/memories/${id}`
      );
      return data.memory;
    },
    onSuccess: invalidate
  });
};

export const useCreateAiConnection = () => {
  const invalidate = useInvalidateAssistant();
  return useMutation({
    meta: inlineRefusals,
    mutationFn: async (document: TAiConnectionDocument) => {
      const { data } = await apiRequest.post<{ connection: TAiConnection }>(
        `${AI_BASE_URL}/connections`,
        document
      );
      return data.connection;
    },
    onSuccess: invalidate
  });
};

// The body is the whole v1 document. Without credential the stored key is kept.
export const useUpdateAiConnection = (options: { inline?: boolean } = { inline: true }) => {
  const invalidate = useInvalidateAssistant();
  return useMutation({
    meta: options.inline ? inlineRefusals : undefined,
    mutationFn: async ({ id, document }: { id: string; document: TAiConnectionDocument }) => {
      const { data } = await apiRequest.put<{ connection: TAiConnection }>(
        `${AI_BASE_URL}/connections/${id}`,
        document
      );
      return data.connection;
    },
    onSuccess: invalidate
  });
};

export const useDeleteAiConnection = () => {
  const invalidate = useInvalidateAssistant();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiRequest.delete<{ connection: TAiConnection }>(
        `${AI_BASE_URL}/connections/${id}`
      );
      return data.connection;
    },
    onSuccess: invalidate
  });
};

export const useTestAiConnection = () => {
  const invalidate = useInvalidateAssistant();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiRequest.post<{
        test: TAiConnectionTest;
        connection: TAiConnection;
      }>(`${AI_BASE_URL}/connections/${id}/test`);
      return data;
    },
    onSuccess: invalidate
  });
};

// Checks a Hugging Face token and returns its account. Nothing is stored.
export const useCheckHuggingFaceAccount = () =>
  useMutation({
    meta: inlineHelperErrors,
    mutationFn: async (source: THuggingFaceTokenSource) => {
      const { data } = await apiRequest.post<{ account: THuggingFaceAccount }>(
        `${AI_BASE_URL}/huggingface/account`,
        source
      );
      return data.account;
    }
  });

export const useListHuggingFaceEndpoints = () =>
  useMutation({
    meta: inlineHelperErrors,
    mutationFn: async (input: THuggingFaceTokenSource & { namespace: string }) => {
      const { data } = await apiRequest.post<{ endpoints: THuggingFaceEndpoint[] }>(
        `${AI_BASE_URL}/huggingface/endpoints`,
        input
      );
      return data.endpoints;
    }
  });

export const useCreateAiPersona = () => {
  const invalidate = useInvalidateAssistant();
  return useMutation({
    meta: inlineRefusals,
    mutationFn: async (document: TAiPersonaDocument) => {
      const { data } = await apiRequest.post<{ persona: TAiPersona }>(
        `${AI_BASE_URL}/personas`,
        document
      );
      return data.persona;
    },
    onSuccess: invalidate
  });
};

// The body is the whole v1 document.
export const useUpdateAiPersona = (options: { inline?: boolean } = { inline: true }) => {
  const invalidate = useInvalidateAssistant();
  return useMutation({
    meta: options.inline ? inlineRefusals : undefined,
    mutationFn: async ({ slug, document }: { slug: string; document: TAiPersonaDocument }) => {
      const { data } = await apiRequest.put<{ persona: TAiPersona }>(
        `${AI_BASE_URL}/personas/${slug}`,
        document
      );
      return data.persona;
    },
    onSuccess: invalidate
  });
};

export const useResetAiPersona = () => {
  const invalidate = useInvalidateAssistant();
  return useMutation({
    mutationFn: async (slug: string) => {
      const { data } = await apiRequest.post<{ persona: TAiPersona }>(
        `${AI_BASE_URL}/personas/${slug}/reset`
      );
      return data.persona;
    },
    onSuccess: invalidate
  });
};

export const useDeleteAiPersona = () => {
  const invalidate = useInvalidateAssistant();
  return useMutation({
    mutationFn: async (slug: string) => {
      const { data } = await apiRequest.delete<{ persona: TAiPersona }>(
        `${AI_BASE_URL}/personas/${slug}`
      );
      return data.persona;
    },
    onSuccess: invalidate
  });
};

export const useSendAssistantMessage = () =>
  useMutation({
    mutationFn: async (input: {
      messages: TAssistantMessage[];
      signals?: TAssistantSignal[];
      persona?: string;
    }) => {
      const { data } = await apiRequest.post<TAssistantReply>(`${AI_BASE_URL}/messages`, input);
      return data;
    }
  });
