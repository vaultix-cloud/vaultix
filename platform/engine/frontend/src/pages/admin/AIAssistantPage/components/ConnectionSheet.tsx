import { useMemo, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { PlusIcon, Trash2Icon } from "lucide-react";

import { createNotification } from "@app/components/notifications";
import {
  Button,
  Field,
  FieldLabel,
  IconButton,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Switch,
  TextArea
} from "@app/components/v3";
import {
  schemaAt,
  schemaRule,
  schemaText,
  serverMessage,
  specializeSchema,
  TAiApiStyle,
  TAiAuthType,
  TAiConnection,
  TAiConnectionCredential,
  TAiConnectionDocument,
  TAiConnectionKind,
  useCheckHuggingFaceAccount,
  useCreateAiConnection,
  useGetAiConnectionModels,
  useGetAiSchemas,
  useUpdateAiConnection
} from "@app/hooks/api/assistant";

import { KIND_DETAILS, MODEL_ID_HINT } from "./connection-kinds";
import { ConnectionTestPanel } from "./ConnectionTest";
import { applyRefusal, errorAt, FormField, RefusalAlert } from "./form-parts";

export type TConnectionFormValues = {
  name: string;
  endpoint: string;
  apiStyle: TAiApiStyle;
  auth: { type: TAiAuthType; headerName: string };
  headers: { name: string; value: string }[];
  region: string;
  cloudProject: string;
  billTo: string;
  models: { standard: string; fast: string; deep: string };
  timeoutSeconds: string;
  credential: Required<TAiConnectionCredential>;
  active: boolean;
};

const EMPTY_CREDENTIAL: Required<TAiConnectionCredential> = {
  apiKey: "",
  accessKeyId: "",
  secretAccessKey: "",
  sessionToken: "",
  serviceAccountJson: ""
};

const usesApiKey = (kind: TAiConnectionKind, authType: TAiAuthType) =>
  kind !== "bedrock" && kind !== "vertex" && !(kind === "custom" && authType === "none");

const optional = (value: string) => (value.trim() ? value.trim() : undefined);

export const credentialFor = (
  kind: TAiConnectionKind,
  values: TConnectionFormValues
): TAiConnectionCredential | undefined => {
  const c = values.credential;
  if (kind === "bedrock") {
    if (!c.accessKeyId && !c.secretAccessKey && !c.sessionToken) return undefined;
    return {
      accessKeyId: c.accessKeyId.trim(),
      secretAccessKey: c.secretAccessKey,
      ...(c.sessionToken ? { sessionToken: c.sessionToken } : {})
    };
  }
  if (kind === "vertex") {
    return c.serviceAccountJson ? { serviceAccountJson: c.serviceAccountJson } : undefined;
  }
  if (!usesApiKey(kind, values.auth.type)) return undefined;
  return c.apiKey ? { apiKey: c.apiKey } : undefined;
};

export const connectionDocumentFrom = (
  kind: TAiConnectionKind,
  values: TConnectionFormValues
): TAiConnectionDocument => {
  const doc: TAiConnectionDocument = {
    schemaVersion: "vaultix.ai-connection.v1",
    name: values.name.trim(),
    kind,
    models: {
      standard: values.models.standard.trim(),
      ...(optional(values.models.fast) ? { fast: values.models.fast.trim() } : {}),
      ...(optional(values.models.deep) ? { deep: values.models.deep.trim() } : {})
    },
    active: values.active
  };
  if (values.timeoutSeconds.trim()) doc.timeoutSeconds = Number(values.timeoutSeconds);
  if (kind === "custom" || kind === "huggingface-endpoint") doc.endpoint = values.endpoint.trim();
  if (kind === "custom") {
    doc.apiStyle = values.apiStyle;
    doc.auth =
      values.auth.type === "header"
        ? { type: "header", headerName: values.auth.headerName.trim() }
        : { type: values.auth.type };
    if (values.headers.length > 0) {
      doc.headers = values.headers.map((header) => ({
        name: header.name.trim(),
        value: header.value
      }));
    }
  }
  if (kind === "bedrock" || kind === "vertex") doc.region = values.region.trim();
  if (kind === "vertex") doc.cloudProject = values.cloudProject.trim();
  if (kind === "huggingface" && optional(values.billTo)) doc.billTo = values.billTo.trim();
  const credential = credentialFor(kind, values);
  if (credential) doc.credential = credential;
  return doc;
};

const formValuesFor = (
  kind: TAiConnectionKind,
  connection: TAiConnection | undefined,
  activeByDefault: boolean
): TConnectionFormValues => ({
  name: connection?.name ?? KIND_DETAILS[kind].defaultName,
  endpoint: connection?.endpoint ?? "",
  apiStyle: connection?.apiStyle ?? "openai-chat",
  auth: {
    type: connection?.auth?.type ?? "bearer",
    headerName: connection?.auth?.headerName ?? ""
  },
  headers: connection?.headers ?? [],
  region: connection?.region ?? "",
  cloudProject: connection?.cloudProject ?? "",
  billTo: connection?.billTo ?? "",
  models: {
    standard: connection?.models.standard ?? KIND_DETAILS[kind].suggestedModels[0] ?? "",
    fast: connection?.models.fast ?? "",
    deep: connection?.models.deep ?? ""
  },
  timeoutSeconds: String(connection?.timeoutSeconds ?? 60),
  credential: EMPTY_CREDENTIAL,
  active: connection?.active ?? activeByDefault
});

type Props = {
  kind: TAiConnectionKind;
  connection?: TAiConnection;
  activeByDefault: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

export const ConnectionSheet = ({
  kind,
  connection,
  activeByDefault,
  isOpen,
  onOpenChange
}: Props) => {
  const editing = Boolean(connection);
  const schemas = useGetAiSchemas();
  const root = useMemo(
    () => (schemas.data ? specializeSchema(schemas.data.connection, "kind", kind) : undefined),
    [schemas.data, kind]
  );
  const create = useCreateAiConnection();
  const update = useUpdateAiConnection();
  const [saved, setSaved] = useState<TAiConnection>();
  const [refusal, setRefusal] = useState<string>();
  const [loadModels, setLoadModels] = useState(false);
  const listed = useGetAiConnectionModels(connection?.id, loadModels);
  const account = useCheckHuggingFaceAccount();

  const form = useForm<TConnectionFormValues>({
    mode: "onTouched",
    values: formValuesFor(kind, connection, activeByDefault)
  });
  const {
    control,
    register,
    handleSubmit,
    reset,
    clearErrors,
    formState: { errors, isSubmitting }
  } = form;
  const headers = useFieldArray({ control, name: "headers" });
  const authType = useWatch({ control, name: "auth.type" });
  const maxHeaders = (root && schemaAt(root, "headers")?.maxItems) ?? 8;

  const close = () => {
    reset();
    setSaved(undefined);
    setRefusal(undefined);
    setLoadModels(false);
    account.reset();
    onOpenChange(false);
  };

  const onSubmit = async (values: TConnectionFormValues) => {
    clearErrors();
    setRefusal(undefined);
    const document = connectionDocumentFrom(kind, values);
    try {
      if (connection) {
        await update.mutateAsync({ id: connection.id, document });
        createNotification({ type: "success", text: `Saved ${document.name}.` });
        close();
      } else {
        const created = await create.mutateAsync(document);
        createNotification({ type: "success", text: `Added ${created.name}.` });
        setSaved(created);
      }
    } catch (error) {
      setRefusal(applyRefusal(error, form));
    }
  };

  const suggestions =
    listed.data?.listed && listed.data.models.length > 0
      ? listed.data.models.map((model) => model.id)
      : KIND_DETAILS[kind].suggestedModels;
  const keyHelp = editing
    ? "Leave empty to keep the stored key. It is never shown again."
    : "Stored encrypted with this instance's root key. It is never shown again.";
  const label = (path: string, fallback: string) => schemaText(root, path, "title") ?? fallback;
  const kindLabel = KIND_DETAILS[kind].label;
  const accountNames = account.data ? [account.data.name, ...account.data.organizations] : [];

  const passwordField = (
    path: "credential.apiKey" | "credential.secretAccessKey" | "credential.sessionToken",
    fieldLabel: string,
    required: boolean,
    help?: string
  ) => (
    <FormField
      id={`ai-connection-${path.replace(".", "-")}`}
      label={fieldLabel}
      description={help}
      error={errorAt(errors, path)}
    >
      {(aria) => (
        <Input
          {...aria}
          type="password"
          autoComplete="off"
          spellCheck={false}
          {...register(path, { validate: schemaRule(root, path, { required }) })}
        />
      )}
    </FormField>
  );

  return (
    <Sheet open={isOpen} onOpenChange={(open) => (open ? onOpenChange(true) : close())}>
      <SheetContent className="flex flex-col sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>
            {saved && `${saved.name} Added`}
            {!saved && (editing ? `Edit ${connection?.name}` : `Add ${kindLabel} Connection`)}
          </SheetTitle>
          <SheetDescription>
            The assistant sends this provider names, references and what people type in chat. Secret
            values never leave Vaultix.
          </SheetDescription>
        </SheetHeader>
        {saved ? (
          <>
            <div className="flex-1 overflow-y-auto p-4">
              <ConnectionTestPanel connection={saved} />
            </div>
            <SheetFooter className="justify-end border-t">
              <Button variant="neutral" onClick={close}>
                Done
              </Button>
            </SheetFooter>
          </>
        ) : (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={handleSubmit(onSubmit)}
            noValidate
          >
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
              <RefusalAlert message={refusal} />
              <FormField
                id="ai-connection-name"
                label={label("name", "Name")}
                description={schemaText(root, "name", "description")}
                error={errorAt(errors, "name")}
              >
                {(aria) => (
                  <Input
                    {...aria}
                    autoComplete="off"
                    {...register("name", { validate: schemaRule(root, "name") })}
                  />
                )}
              </FormField>

              {(kind === "custom" || kind === "huggingface-endpoint") && (
                <FormField
                  id="ai-connection-endpoint"
                  label={label("endpoint", "Endpoint URL")}
                  description={
                    kind === "custom"
                      ? "The base URL, for example https://gateway.example.com/v1. Plain http:// works only for localhost, 127.0.0.1 and [::1], or when no key is sent."
                      : "The endpoint's https URL from Hugging Face. Vaultix adds /v1."
                  }
                  error={errorAt(errors, "endpoint")}
                >
                  {(aria) => (
                    <Input
                      {...aria}
                      type="url"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={
                        kind === "custom"
                          ? "http://127.0.0.1:11434/v1"
                          : "https://xyz.endpoints.huggingface.cloud"
                      }
                      {...register("endpoint", {
                        validate: schemaRule(root, "endpoint", {
                          patternHint:
                            kind === "custom"
                              ? "Enter an http:// or https:// URL without credentials, a query or a fragment."
                              : "Enter an https:// URL without credentials, a query or a fragment."
                        })
                      })}
                    />
                  )}
                </FormField>
              )}

              {kind === "custom" && (
                <>
                  <FormField
                    id="ai-connection-api-style"
                    label={label("apiStyle", "API style")}
                    description="The request format the endpoint understands."
                    error={errorAt(errors, "apiStyle")}
                  >
                    {(aria) => (
                      <Controller
                        control={control}
                        name="apiStyle"
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger {...aria} className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="openai-chat">OpenAI Chat Completions</SelectItem>
                              <SelectItem value="anthropic-messages">Anthropic Messages</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      />
                    )}
                  </FormField>
                  <FormField
                    id="ai-connection-auth-type"
                    label={label("auth", "How the key is sent")}
                    error={errorAt(errors, "auth.type") ?? errorAt(errors, "auth")}
                  >
                    {(aria) => (
                      <Controller
                        control={control}
                        name="auth.type"
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger {...aria} className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="bearer">Authorization: Bearer key</SelectItem>
                              <SelectItem value="header">In a named header</SelectItem>
                              <SelectItem value="none">No key</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      />
                    )}
                  </FormField>
                  {authType === "header" && (
                    <FormField
                      id="ai-connection-auth-header"
                      label="Header name"
                      description="Lowercase, for example x-api-key."
                      error={errorAt(errors, "auth.headerName")}
                    >
                      {(aria) => (
                        <Input
                          {...aria}
                          autoComplete="off"
                          spellCheck={false}
                          {...register("auth.headerName", {
                            validate: schemaRule(root, "auth.headerName", {
                              required: true,
                              patternHint: "Use 1–64 lowercase letters, digits or hyphens."
                            })
                          })}
                        />
                      )}
                    </FormField>
                  )}
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-1 text-xs text-muted">
                      {label("headers", "Extra headers")} ({headers.fields.length} of {maxHeaders})
                    </legend>
                    <p className="text-2xs text-muted">
                      Sent with every request. Never put a key here; keys go in the key field.
                    </p>
                    {headers.fields.map((row, index) => (
                      <div key={row.id} className="grid grid-cols-[1fr_1fr_auto] items-start gap-2">
                        <FormField
                          id={`ai-connection-header-${index}-name`}
                          label={`Header ${index + 1} name`}
                          error={errorAt(errors, `headers.${index}.name`)}
                        >
                          {(aria) => (
                            <Input
                              {...aria}
                              autoComplete="off"
                              spellCheck={false}
                              {...register(`headers.${index}.name`, {
                                validate: schemaRule(root, `headers.${index}.name`, {
                                  required: true,
                                  patternHint: "Use lowercase letters, digits or hyphens."
                                })
                              })}
                            />
                          )}
                        </FormField>
                        <FormField
                          id={`ai-connection-header-${index}-value`}
                          label={`Header ${index + 1} value`}
                          error={errorAt(errors, `headers.${index}.value`)}
                        >
                          {(aria) => (
                            <Input
                              {...aria}
                              autoComplete="off"
                              spellCheck={false}
                              {...register(`headers.${index}.value`, {
                                validate: schemaRule(root, `headers.${index}.value`, {
                                  required: true
                                })
                              })}
                            />
                          )}
                        </FormField>
                        <IconButton
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="mt-6"
                          aria-label={`Remove header ${index + 1}`}
                          onClick={() => headers.remove(index)}
                        >
                          <Trash2Icon />
                        </IconButton>
                      </div>
                    ))}
                    <div>
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        isDisabled={headers.fields.length >= maxHeaders}
                        onClick={() => headers.append({ name: "", value: "" })}
                      >
                        <PlusIcon />
                        Add Header
                      </Button>
                    </div>
                    {errorAt(errors, "headers") && (
                      <p role="alert" className="text-xs text-danger">
                        {errorAt(errors, "headers")}
                      </p>
                    )}
                  </fieldset>
                </>
              )}

              {(kind === "bedrock" || kind === "vertex") && (
                <FormField
                  id="ai-connection-region"
                  label={label("region", "Region")}
                  description={
                    kind === "bedrock"
                      ? "The AWS region, for example us-east-1."
                      : "The Vertex location, for example us-east5, or global."
                  }
                  error={errorAt(errors, "region")}
                >
                  {(aria) => (
                    <Input
                      {...aria}
                      autoComplete="off"
                      spellCheck={false}
                      {...register("region", {
                        validate: schemaRule(root, "region", {
                          required: true,
                          patternHint:
                            kind === "bedrock"
                              ? "Use an AWS region such as us-east-1."
                              : "Use a location such as us-east5, or global."
                        })
                      })}
                    />
                  )}
                </FormField>
              )}
              {kind === "vertex" && (
                <FormField
                  id="ai-connection-project"
                  label={label("cloudProject", "Google Cloud project")}
                  description="The project ID, not its display name."
                  error={errorAt(errors, "cloudProject")}
                >
                  {(aria) => (
                    <Input
                      {...aria}
                      autoComplete="off"
                      spellCheck={false}
                      {...register("cloudProject", {
                        validate: schemaRule(root, "cloudProject", {
                          required: true,
                          patternHint:
                            "Use 6–30 lowercase letters, digits or hyphens, starting with a letter."
                        })
                      })}
                    />
                  )}
                </FormField>
              )}
              {kind === "huggingface" && (
                <FormField
                  id="ai-connection-bill-to"
                  label={label("billTo", "Bill to")}
                  description="The organization billed for requests. Leave empty to bill the token's own account."
                  error={errorAt(errors, "billTo")}
                >
                  {(aria) => (
                    <div className="flex flex-col gap-2">
                      <Input
                        {...aria}
                        list="ai-connection-bill-to-options"
                        autoComplete="off"
                        spellCheck={false}
                        {...register("billTo", {
                          validate: schemaRule(root, "billTo", {
                            patternHint: "Use a Hugging Face account or organization name."
                          })
                        })}
                      />
                      <datalist id="ai-connection-bill-to-options">
                        {accountNames.map((name) => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                      {connection && (
                        <div className="flex items-center gap-2 text-xs">
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            isPending={account.isPending}
                            onClick={() => account.mutate({ connectionId: connection.id })}
                          >
                            Look Up Organizations
                          </Button>
                          <span role="status" className="text-muted">
                            {account.data &&
                              `Signed in as ${account.data.name}. Pick an organization in the field.`}
                            {account.isError &&
                              (serverMessage(account.error) ??
                                "Hugging Face refused the stored token.")}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </FormField>
              )}

              <datalist id="ai-connection-model-options">
                {suggestions.map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
              <FormField
                id="ai-connection-model-standard"
                label="Standard model"
                description={
                  kind === "huggingface"
                    ? "A Hub repo ID, optionally with :fastest, :cheapest, :preferred or :provider."
                    : schemaText(root, "models", "description")
                }
                error={errorAt(errors, "models.standard") ?? errorAt(errors, "models")}
              >
                {(aria) => (
                  <Input
                    {...aria}
                    list="ai-connection-model-options"
                    autoComplete="off"
                    spellCheck={false}
                    {...register("models.standard", {
                      validate: schemaRule(root, "models.standard", { patternHint: MODEL_ID_HINT })
                    })}
                  />
                )}
              </FormField>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {(["fast", "deep"] as const).map((tier) => (
                  <FormField
                    key={tier}
                    id={`ai-connection-model-${tier}`}
                    label={`${tier === "fast" ? "Fast" : "Deep"} model (optional)`}
                    description="Empty uses the standard model."
                    error={errorAt(errors, `models.${tier}`)}
                  >
                    {(aria) => (
                      <Input
                        {...aria}
                        list="ai-connection-model-options"
                        autoComplete="off"
                        spellCheck={false}
                        {...register(`models.${tier}`, {
                          validate: schemaRule(root, `models.${tier}`, {
                            patternHint: MODEL_ID_HINT
                          })
                        })}
                      />
                    )}
                  </FormField>
                ))}
              </div>
              {connection ? (
                <div className="flex items-center gap-3 text-xs">
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    isPending={listed.isFetching}
                    onClick={() => (loadModels ? listed.refetch() : setLoadModels(true))}
                  >
                    Load Models
                  </Button>
                  <span role="status" className="text-muted">
                    {listed.data?.listed &&
                      `${listed.data.models.length} models listed with the saved key. Pick one in any model field.`}
                    {listed.data && !listed.data.listed && listed.data.message}
                  </span>
                </div>
              ) : (
                <p className="text-xs text-muted">
                  After you save, edit the connection to load the models its key can use.
                </p>
              )}

              {kind === "bedrock" && (
                <>
                  <FormField
                    id="ai-connection-access-key"
                    label="AWS access key ID"
                    error={
                      errorAt(errors, "credential.accessKeyId") ?? errorAt(errors, "credential")
                    }
                  >
                    {(aria) => (
                      <Input
                        {...aria}
                        autoComplete="off"
                        spellCheck={false}
                        {...register("credential.accessKeyId", {
                          validate: schemaRule(root, "credential.accessKeyId", {
                            required: !editing,
                            patternHint: "Use the 16 or more capital letters and digits AWS shows."
                          })
                        })}
                      />
                    )}
                  </FormField>
                  {passwordField(
                    "credential.secretAccessKey",
                    "AWS secret access key",
                    !editing,
                    keyHelp
                  )}
                  {passwordField("credential.sessionToken", "Session token (optional)", false)}
                </>
              )}
              {kind === "vertex" && (
                <FormField
                  id="ai-connection-service-account"
                  label="Service account key (JSON)"
                  description={keyHelp}
                  error={
                    errorAt(errors, "credential.serviceAccountJson") ??
                    errorAt(errors, "credential")
                  }
                >
                  {(aria) => (
                    <TextArea
                      {...aria}
                      rows={5}
                      autoComplete="off"
                      spellCheck={false}
                      className="font-mono text-xs"
                      {...register("credential.serviceAccountJson", {
                        validate: schemaRule(root, "credential.serviceAccountJson", {
                          required: !editing
                        })
                      })}
                    />
                  )}
                </FormField>
              )}
              {usesApiKey(kind, authType) && (
                <>
                  {passwordField(
                    "credential.apiKey",
                    kind === "huggingface" || kind === "huggingface-endpoint"
                      ? "Hugging Face token"
                      : "API key",
                    !editing,
                    keyHelp
                  )}
                  {errorAt(errors, "credential") && (
                    <p role="alert" className="text-xs text-danger">
                      {errorAt(errors, "credential")}
                    </p>
                  )}
                </>
              )}

              <FormField
                id="ai-connection-timeout"
                label={label("timeoutSeconds", "Timeout (seconds)")}
                description="How long one model call may take before it is abandoned."
                error={errorAt(errors, "timeoutSeconds")}
              >
                {(aria) => (
                  <Input
                    {...aria}
                    type="number"
                    inputMode="numeric"
                    className="max-w-32"
                    {...register("timeoutSeconds", {
                      validate: schemaRule(root, "timeoutSeconds", { as: "number" })
                    })}
                  />
                )}
              </FormField>
              <Field orientation="horizontal">
                <FieldLabel htmlFor="ai-connection-active">
                  {label("active", "Use for the assistant")}
                </FieldLabel>
                <Controller
                  control={control}
                  name="active"
                  render={({ field }) => (
                    <Switch
                      id="ai-connection-active"
                      variant="neutral"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
              </Field>
            </div>
            <SheetFooter className="justify-end border-t">
              <Button variant="ghost" type="button" onClick={close}>
                Cancel
              </Button>
              <Button variant="neutral" type="submit" isPending={isSubmitting}>
                {editing ? "Save" : "Add Connection"}
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
};
