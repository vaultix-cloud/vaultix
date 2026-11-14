import { useQuery } from "@tanstack/react-query";

import { apiRequest } from "@app/config/request";

import {
  TAiConnection,
  TAiConnectionKind,
  TAiConnectionModelList,
  TAiPersonaList,
  TAiSchemas,
  TAssistantMemory,
  TAssistantStatus
} from "./types";

export const AI_BASE_URL = "/api/vx/v1/ai";

export const assistantKeys = {
  all: ["vaultix-assistant"] as const,
  status: () => [...assistantKeys.all, "status"] as const,
  schema: () => [...assistantKeys.all, "schema"] as const,
  connections: () => [...assistantKeys.all, "connections"] as const,
  connectionModels: (id: string) => [...assistantKeys.all, "connection-models", id] as const,
  personas: () => [...assistantKeys.all, "personas"] as const,
  memories: () => [...assistantKeys.all, "memories"] as const
};

export const useGetAssistantStatus = (enabled = true) =>
  useQuery({
    queryKey: assistantKeys.status(),
    enabled,
    queryFn: async () => {
      const { data } = await apiRequest.get<{ assistant: TAssistantStatus }>(
        `${AI_BASE_URL}/assistant`
      );
      return data.assistant;
    }
  });

// The JSON Schemas the server validates with; the forms build their rules from them.
export const useGetAiSchemas = () =>
  useQuery({
    queryKey: assistantKeys.schema(),
    staleTime: Infinity,
    queryFn: async () => {
      const { data } = await apiRequest.get<{ schemas: TAiSchemas }>(`${AI_BASE_URL}/schema`);
      return data.schemas;
    }
  });

export const useGetAiConnections = () =>
  useQuery({
    queryKey: assistantKeys.connections(),
    queryFn: async () => {
      const { data } = await apiRequest.get<{
        connections: TAiConnection[];
        kinds: TAiConnectionKind[];
      }>(`${AI_BASE_URL}/connections`);
      return data;
    }
  });

// Asks the provider live with the stored key; only fetched when the administrator asks.
export const useGetAiConnectionModels = (id: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: assistantKeys.connectionModels(id ?? ""),
    enabled: enabled && Boolean(id),
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const { data } = await apiRequest.get<TAiConnectionModelList>(
        `${AI_BASE_URL}/connections/${id}/models`
      );
      return data;
    }
  });

export const useGetAiPersonas = () =>
  useQuery({
    queryKey: assistantKeys.personas(),
    queryFn: async () => {
      const { data } = await apiRequest.get<TAiPersonaList>(`${AI_BASE_URL}/personas`);
      return data;
    }
  });

export const useGetAssistantMemories = (enabled = true) =>
  useQuery({
    queryKey: assistantKeys.memories(),
    enabled,
    queryFn: async () => {
      const { data } = await apiRequest.get<{
        memories: TAssistantMemory[];
        canManageInstance: boolean;
      }>(`${AI_BASE_URL}/memories`);
      return data;
    }
  });
