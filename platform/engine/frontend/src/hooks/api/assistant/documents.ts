import { TAiConnection, TAiConnectionDocument, TAiPersona, TAiPersonaDocument } from "./types";

export const omitKeys = <T extends object, K extends keyof T>(value: T, keys: K[]): Omit<T, K> => {
  const copy = { ...value };
  keys.forEach((key) => delete copy[key]);
  return copy;
};

// A PUT body for a connection from its view. Leaving out credential keeps the stored key.
export const connectionDocument = (view: TAiConnection): TAiConnectionDocument => ({
  ...omitKeys(view, ["id", "hasCredential", "lastTest", "createdAt", "updatedAt"]),
  schemaVersion: "vaultix.ai-connection.v1"
});

export const personaDocument = (view: TAiPersona): TAiPersonaDocument => ({
  ...omitKeys(view, ["id", "builtIn", "customized", "updatedAt"]),
  schemaVersion: "vaultix.ai-persona.v1"
});
