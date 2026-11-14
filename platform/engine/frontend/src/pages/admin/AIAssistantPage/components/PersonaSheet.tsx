import { useMemo, useState } from "react";
import { Controller, useFieldArray, useForm, UseFormReturn, useWatch } from "react-hook-form";
import { PlusIcon, Trash2Icon } from "lucide-react";

import { createNotification } from "@app/components/notifications";
import {
  Button,
  Checkbox,
  Field,
  FieldLabel,
  IconButton,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
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
  specializeSchema,
  TAiConnection,
  TAiMemoryUse,
  TAiPersona,
  TAiPersonaDocument,
  TAiPersonaModelSettings,
  TAiPersonaRole,
  useCreateAiPersona,
  useGetAiSchemas,
  useUpdateAiPersona
} from "@app/hooks/api/assistant";

import { applyRefusal, errorAt, FormField, RefusalAlert } from "./form-parts";
import {
  HandoffFields,
  handoffsFrom,
  modelDocumentFrom,
  modelValuesFrom,
  PersonaModelFields,
  TPersonaModelValues
} from "./persona-fields";

const DEFAULT_TOOL_CHOICE = "__default__";

type TToolsMode = "areas" | "none" | "list";

type TValues = TPersonaModelValues & {
  slug: string;
  name: string;
  description: string;
  role: TAiPersonaRole;
  instructions: string;
  domains: string[];
  modelSettings: {
    temperature: string;
    topP: string;
    maxOutputTokens: string;
    stopSequences: { value: string }[];
    toolChoice: "auto" | "none" | typeof DEFAULT_TOOL_CHOICE;
  };
  toolsMode: TToolsMode;
  toolsList: string;
  memoryUse: TAiMemoryUse;
  enabled: boolean;
};

const numberText = (value?: number) => (value === undefined ? "" : String(value));

const valuesFrom = (persona?: TAiPersona): TValues => ({
  ...modelValuesFrom(persona),
  slug: persona?.slug ?? "",
  name: persona?.name ?? "",
  description: persona?.description ?? "",
  role: persona?.role ?? "specialist",
  instructions: persona?.instructions ?? "",
  domains: persona?.domains ?? [],
  modelSettings: {
    temperature: numberText(persona?.modelSettings?.temperature),
    topP: numberText(persona?.modelSettings?.topP),
    maxOutputTokens: numberText(persona?.modelSettings?.maxOutputTokens),
    stopSequences: (persona?.modelSettings?.stopSequences ?? []).map((value) => ({ value })),
    toolChoice: persona?.modelSettings?.toolChoice ?? DEFAULT_TOOL_CHOICE
  },
  toolsMode: (() => {
    if (!persona || persona.tools === null) return "areas";
    return persona.tools.length === 0 ? "none" : "list";
  })(),
  toolsList: (persona?.tools ?? []).join("\n"),
  memoryUse: persona?.memory?.use ?? "all",
  enabled: persona?.enabled ?? true
});

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const documentFrom = (values: TValues, persona?: TAiPersona): TAiPersonaDocument => {
  const settings: TAiPersonaModelSettings = {};
  const { temperature, topP, maxOutputTokens, stopSequences, toolChoice } = values.modelSettings;
  if (temperature.trim()) settings.temperature = Number(temperature);
  if (topP.trim()) settings.topP = Number(topP);
  if (maxOutputTokens.trim()) settings.maxOutputTokens = Number(maxOutputTokens);
  if (stopSequences.length > 0) settings.stopSequences = stopSequences.map((stop) => stop.value);
  if (toolChoice !== DEFAULT_TOOL_CHOICE) settings.toolChoice = toolChoice;
  const role = persona?.role ?? values.role;
  const handoffs = role === "router" ? handoffsFrom(values) : undefined;
  let tools: string[] | null = null;
  if (values.toolsMode === "none") tools = [];
  if (values.toolsMode === "list") tools = lines(values.toolsList);
  return {
    schemaVersion: "vaultix.ai-persona.v1",
    slug: persona?.slug ?? values.slug.trim(),
    name: values.name.trim(),
    description: values.description.trim(),
    role,
    domains: values.domains,
    instructions: values.instructions,
    ...modelDocumentFrom(values),
    ...(Object.keys(settings).length > 0 ? { modelSettings: settings } : {}),
    tools,
    ...(handoffs ? { handoffs } : {}),
    memory: { use: values.memoryUse },
    enabled: role === "router" ? true : values.enabled
  };
};

// Server paths that name a part of the document the form edits under another name.
const formPathFor = (path: string) => {
  if (path === "tools" || path.startsWith("tools.")) return "toolsList";
  if (path === "memory" || path === "memory.use") return "memoryUse";
  if (path.startsWith("handoffs")) return "handoffs";
  return path;
};

const ROLE_LABEL: Record<TAiPersonaRole, string> = {
  router: "Router",
  specialist: "Specialist",
  guard: "Guard"
};

type Props = {
  persona?: TAiPersona;
  domains: string[];
  specialists: TAiPersona[];
  connections: TAiConnection[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

export const PersonaSheet = ({
  persona,
  domains,
  specialists,
  connections,
  isOpen,
  onOpenChange
}: Props) => {
  const editing = Boolean(persona);
  const schemas = useGetAiSchemas();
  const create = useCreateAiPersona();
  const update = useUpdateAiPersona();
  const [refusal, setRefusal] = useState<string>();
  const initial = useMemo(() => valuesFrom(persona), [persona]);
  const form = useForm<TValues>({ mode: "onTouched", values: initial });
  const {
    control,
    register,
    handleSubmit,
    reset,
    clearErrors,
    formState: { errors, isSubmitting }
  } = form;
  const role = useWatch({ control, name: "role" });
  const instructions = useWatch({ control, name: "instructions" });
  const toolsMode = useWatch({ control, name: "toolsMode" });
  const stops = useFieldArray({ control, name: "modelSettings.stopSequences" });
  const effectiveRole = persona?.role ?? role;
  const root = useMemo(
    () =>
      schemas.data ? specializeSchema(schemas.data.persona, "role", effectiveRole) : undefined,
    [schemas.data, effectiveRole]
  );
  const maxInstructions = (root && schemaAt(root, "instructions")?.maxLength) ?? 16384;
  const maxDomains = (root && schemaAt(root, "domains")?.maxItems) ?? 8;
  const maxStops = (root && schemaAt(root, "modelSettings.stopSequences")?.maxItems) ?? 4;
  const label = (path: string, fallback: string) => schemaText(root, path, "title") ?? fallback;
  const help = (path: string) => schemaText(root, path, "description");
  const modelForm = form as unknown as UseFormReturn<TPersonaModelValues>;

  const close = () => {
    reset(initial);
    setRefusal(undefined);
    onOpenChange(false);
  };

  const onSubmit = async (values: TValues) => {
    clearErrors();
    setRefusal(undefined);
    const document = documentFrom(values, persona);
    try {
      if (persona) {
        await update.mutateAsync({ slug: persona.slug, document });
        createNotification({ type: "success", text: `Saved ${document.name}.` });
      } else {
        await create.mutateAsync(document);
        createNotification({ type: "success", text: `Added ${document.name}.` });
      }
      close();
    } catch (error) {
      setRefusal(applyRefusal(error, form, formPathFor));
    }
  };

  const numberField = (
    path: "modelSettings.temperature" | "modelSettings.topP" | "modelSettings.maxOutputTokens",
    fallback: string,
    description: string,
    step: string
  ) => (
    <FormField
      id={`ai-persona-${path.split(".")[1]}`}
      label={`${label(path, fallback)} (optional)`}
      description={description}
      error={errorAt(errors, path)}
    >
      {(aria) => (
        <Input
          {...aria}
          type="number"
          step={step}
          inputMode="decimal"
          {...register(path, { validate: schemaRule(root, path, { as: "number" }) })}
        />
      )}
    </FormField>
  );

  return (
    <Sheet open={isOpen} onOpenChange={(open) => (open ? onOpenChange(true) : close())}>
      <SheetContent className="flex flex-col sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{editing ? `Edit ${persona?.name}` : "Add Persona"}</SheetTitle>
          <SheetDescription>
            A persona shapes how the assistant answers and which areas&apos; tools it uses. It never
            grants anything: tools always run with the signed-in person&apos;s own permissions.
          </SheetDescription>
        </SheetHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
            <RefusalAlert message={refusal} />
            {!editing && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  id="ai-persona-slug"
                  label={label("slug", "Short name")}
                  description={help("slug")}
                  error={errorAt(errors, "slug")}
                >
                  {(aria) => (
                    <Input
                      {...aria}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="billing"
                      {...register("slug", {
                        validate: schemaRule(root, "slug", {
                          patternHint:
                            "Use 2–32 lowercase letters, digits or hyphens, starting with a letter."
                        })
                      })}
                    />
                  )}
                </FormField>
                <FormField
                  id="ai-persona-role"
                  label={label("role", "Role")}
                  error={errorAt(errors, "role")}
                >
                  {(aria) => (
                    <Controller
                      control={control}
                      name="role"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger {...aria} className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="specialist">
                              Specialist: answers within its areas
                            </SelectItem>
                            <SelectItem value="guard">Guard: reviews proposed changes</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  )}
                </FormField>
              </div>
            )}
            {editing && (
              <p className="text-xs text-muted">
                <span className="font-mono">@{persona?.slug}</span> ·{" "}
                {ROLE_LABEL[persona?.role ?? "specialist"]}
                {persona?.builtIn ? " · Shipped default" : ""}
              </p>
            )}
            <FormField
              id="ai-persona-name"
              label={label("name", "Name")}
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
            <FormField
              id="ai-persona-description"
              label={label("description", "When to use it")}
              description={help("description")}
              error={errorAt(errors, "description")}
            >
              {(aria) => (
                <TextArea
                  {...aria}
                  rows={2}
                  {...register("description", { validate: schemaRule(root, "description") })}
                />
              )}
            </FormField>
            <FormField
              id="ai-persona-instructions"
              label={label("instructions", "Instructions")}
              description={
                <>
                  {help("instructions")} {[...(instructions ?? "")].length.toLocaleString()} of{" "}
                  {maxInstructions.toLocaleString()} characters.
                </>
              }
              error={errorAt(errors, "instructions")}
            >
              {(aria) => (
                <TextArea
                  {...aria}
                  rows={12}
                  className="font-mono text-xs"
                  {...register("instructions", { validate: schemaRule(root, "instructions") })}
                />
              )}
            </FormField>

            <Controller
              control={control}
              name="domains"
              rules={{ validate: schemaRule(root, "domains") }}
              render={({ field }) => (
                <fieldset
                  className="flex flex-col gap-2"
                  aria-describedby={
                    errorAt(errors, "domains") ? "ai-persona-domains-error" : undefined
                  }
                >
                  <legend className="mb-1 text-xs text-muted">
                    {label("domains", "Areas")} ({field.value.length} of at most {maxDomains})
                  </legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {domains.map((domain) => {
                      const checked = field.value.includes(domain);
                      return (
                        <div key={domain} className="flex items-center gap-2">
                          <Checkbox
                            id={`ai-persona-domain-${domain}`}
                            isChecked={checked}
                            isDisabled={!checked && field.value.length >= maxDomains}
                            isError={Boolean(errorAt(errors, "domains"))}
                            onCheckedChange={(next) => {
                              field.onChange(
                                next
                                  ? [...field.value, domain]
                                  : field.value.filter((entry) => entry !== domain)
                              );
                              field.onBlur();
                            }}
                          />
                          <Label htmlFor={`ai-persona-domain-${domain}`}>{domain}</Label>
                        </div>
                      );
                    })}
                  </div>
                  {errorAt(errors, "domains") && (
                    <p id="ai-persona-domains-error" role="alert" className="text-xs text-danger">
                      {errorAt(errors, "domains")}
                    </p>
                  )}
                </fieldset>
              )}
            />

            <Separator />
            <h3 className="text-sm font-medium">{label("model", "Model")}</h3>
            <PersonaModelFields
              form={modelForm}
              root={root}
              idPrefix="ai-persona"
              connections={connections}
            />

            <h3 className="text-sm font-medium">{label("modelSettings", "Model settings")}</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {numberField(
                "modelSettings.temperature",
                "Temperature",
                "0 to 2. Lower is steadier.",
                "0.1"
              )}
              {numberField("modelSettings.topP", "Top-p", "More than 0, up to 1.", "0.05")}
              {numberField(
                "modelSettings.maxOutputTokens",
                "Longest answer (tokens)",
                "1 to 32,000.",
                "1"
              )}
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-xs text-muted">
                {label("modelSettings.stopSequences", "Stop sequences")} ({stops.fields.length} of{" "}
                {maxStops})
              </legend>
              {stops.fields.map((row, index) => (
                <div key={row.id} className="flex items-start gap-2">
                  <div className="flex-1">
                    <FormField
                      id={`ai-persona-stop-${index}`}
                      label={`Stop sequence ${index + 1}`}
                      error={errorAt(errors, `modelSettings.stopSequences.${index}.value`)}
                    >
                      {(aria) => (
                        <Input
                          {...aria}
                          autoComplete="off"
                          spellCheck={false}
                          {...register(`modelSettings.stopSequences.${index}.value`, {
                            validate: schemaRule(root, `modelSettings.stopSequences.${index}`, {
                              required: true
                            })
                          })}
                        />
                      )}
                    </FormField>
                  </div>
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-6"
                    aria-label={`Remove stop sequence ${index + 1}`}
                    onClick={() => stops.remove(index)}
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
                  isDisabled={stops.fields.length >= maxStops}
                  onClick={() => stops.append({ value: "" })}
                >
                  <PlusIcon />
                  Add Stop Sequence
                </Button>
              </div>
            </fieldset>
            <FormField
              id="ai-persona-tool-choice"
              label={label("modelSettings.toolChoice", "Tool use")}
              description="Never stops the model from calling any tool, whatever the list below says."
              error={errorAt(errors, "modelSettings.toolChoice")}
            >
              {(aria) => (
                <Controller
                  control={control}
                  name="modelSettings.toolChoice"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger {...aria} className="w-full sm:w-64">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={DEFAULT_TOOL_CHOICE}>Default (when useful)</SelectItem>
                        <SelectItem value="auto">When useful</SelectItem>
                        <SelectItem value="none">Never</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              )}
            </FormField>

            <Separator />
            <Controller
              control={control}
              name="toolsMode"
              render={({ field }) => (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-xs text-muted">{label("tools", "Tools")}</legend>
                  <RadioGroup value={field.value} onValueChange={field.onChange}>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem id="ai-persona-tools-areas" value="areas" />
                      <Label htmlFor="ai-persona-tools-areas">
                        Every read-only tool in its areas
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem id="ai-persona-tools-none" value="none" />
                      <Label htmlFor="ai-persona-tools-none">No tools</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem id="ai-persona-tools-list" value="list" />
                      <Label htmlFor="ai-persona-tools-list">Only the tools listed</Label>
                    </div>
                  </RadioGroup>
                </fieldset>
              )}
            />
            {toolsMode === "list" && (
              <FormField
                id="ai-persona-tools"
                label="Tool names"
                description="One MCP tool name per line, such as vaultix.secrets.list. A list only narrows: tools outside the persona's areas or that change anything are never offered."
                error={errorAt(errors, "toolsList")}
              >
                {(aria) => (
                  <TextArea
                    {...aria}
                    rows={4}
                    spellCheck={false}
                    className="font-mono text-xs"
                    {...register("toolsList", {
                      validate: (raw) =>
                        lines(raw).length === 0
                          ? "List at least one tool, or choose No tools."
                          : schemaRule(root, "tools", {
                              as: "lines",
                              patternHint:
                                "Each line must be a tool name such as vaultix.secrets.list."
                            })(raw)
                    })}
                  />
                )}
              </FormField>
            )}

            {effectiveRole === "router" && (
              <HandoffFields
                form={modelForm}
                root={root}
                idPrefix="ai-persona"
                specialists={specialists}
              />
            )}

            <FormField
              id="ai-persona-memory"
              label={label("memory", "Memories")}
              error={errorAt(errors, "memoryUse")}
            >
              {(aria) => (
                <Controller
                  control={control}
                  name="memoryUse"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger {...aria} className="w-full sm:w-64">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Instance and the person&apos;s own</SelectItem>
                        <SelectItem value="instance">Instance memories only</SelectItem>
                        <SelectItem value="none">No memories</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              )}
            </FormField>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="ai-persona-enabled">{label("enabled", "Enabled")}</FieldLabel>
              <Controller
                control={control}
                name="enabled"
                render={({ field }) => (
                  <Switch
                    id="ai-persona-enabled"
                    variant="neutral"
                    checked={effectiveRole === "router" ? true : field.value}
                    disabled={effectiveRole === "router"}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </Field>
            {effectiveRole === "router" && (
              <p className="text-xs text-muted">
                The router greets everyone and cannot be turned off.
              </p>
            )}
          </div>
          <SheetFooter className="justify-end border-t">
            <Button variant="ghost" type="button" onClick={close}>
              Cancel
            </Button>
            <Button variant="neutral" type="submit" isPending={isSubmitting}>
              {editing ? "Save" : "Add Persona"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
};
