import { Controller, UseFormReturn, useWatch } from "react-hook-form";

import {
  Checkbox,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@app/components/v3";
import {
  schemaRule,
  schemaText,
  TAiConnection,
  TAiPersona,
  TAiPersonaDocument,
  TAiPersonaTier,
  TJsonSchema
} from "@app/hooks/api/assistant";

import { MODEL_ID_HINT } from "./connection-kinds";
import { errorAt, FormField } from "./form-parts";

export const CONNECTION_IN_USE = "__in-use__";

// The fields the persona form and the router settings share.
export type TPersonaModelValues = {
  model: { connectionId: string; tier: TAiPersonaTier; id: string };
  handoffsMode: "all" | "some";
  handoffs: string[];
};

export const modelValuesFrom = (persona?: TAiPersona): TPersonaModelValues => ({
  model: {
    connectionId: persona?.model.connectionId ?? CONNECTION_IN_USE,
    tier: persona?.model.tier ?? "standard",
    id: persona?.model.id ?? ""
  },
  handoffsMode: persona?.handoffs ? "some" : "all",
  handoffs: persona?.handoffs ?? []
});

export const modelDocumentFrom = (
  values: TPersonaModelValues
): Pick<TAiPersonaDocument, "model"> => ({
  model: {
    tier: values.model.tier,
    ...(values.model.connectionId !== CONNECTION_IN_USE
      ? { connectionId: values.model.connectionId }
      : {}),
    ...(values.model.id.trim() ? { id: values.model.id.trim() } : {})
  }
});

export const handoffsFrom = (values: TPersonaModelValues): string[] | undefined =>
  values.handoffsMode === "some" ? values.handoffs : undefined;

const TIER_LABEL: Record<TAiPersonaTier, string> = {
  fast: "Fast",
  standard: "Standard",
  deep: "Deep"
};

type FieldsProps = {
  form: UseFormReturn<TPersonaModelValues>;
  root?: TJsonSchema;
  idPrefix: string;
};

export const PersonaModelFields = ({
  form,
  root,
  idPrefix,
  connections
}: FieldsProps & { connections: TAiConnection[] }) => {
  const {
    control,
    register,
    formState: { errors }
  } = form;
  const connectionId = useWatch({ control, name: "model.connectionId" });
  const chosen =
    connections.find((connection) => connection.id === connectionId) ??
    connections.find((connection) => connection.active);
  const modelOptions = chosen
    ? [chosen.models.standard, chosen.models.fast, chosen.models.deep].filter((id): id is string =>
        Boolean(id)
      )
    : [];

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          id={`${idPrefix}-connection`}
          label={schemaText(root, "model.connectionId", "title") ?? "Connection"}
          description="Which connection it calls. The connection in use follows whichever one is in use."
          error={errorAt(errors, "model.connectionId")}
        >
          {(aria) => (
            <Controller
              control={control}
              name="model.connectionId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger {...aria} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={CONNECTION_IN_USE}>The connection in use</SelectItem>
                    {connections.map((connection) => (
                      <SelectItem key={connection.id} value={connection.id}>
                        {connection.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          )}
        </FormField>
        <FormField
          id={`${idPrefix}-tier`}
          label={schemaText(root, "model.tier", "title") ?? "Tier"}
          description="Which of the connection's models it runs on."
          error={errorAt(errors, "model.tier")}
        >
          {(aria) => (
            <Controller
              control={control}
              name="model.tier"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger {...aria} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TIER_LABEL) as TAiPersonaTier[]).map((tier) => (
                      <SelectItem key={tier} value={tier}>
                        {TIER_LABEL[tier]}
                        {chosen?.models[tier] ? ` (${chosen.models[tier]})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          )}
        </FormField>
      </div>
      <datalist id={`${idPrefix}-model-options`}>
        {modelOptions.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      <FormField
        id={`${idPrefix}-model-id`}
        label={`${schemaText(root, "model.id", "title") ?? "Model ID"} (optional)`}
        description={schemaText(root, "model.id", "description")}
        error={errorAt(errors, "model.id")}
      >
        {(aria) => (
          <Input
            {...aria}
            list={`${idPrefix}-model-options`}
            autoComplete="off"
            spellCheck={false}
            placeholder="Empty uses the connection's model for the tier"
            {...register("model.id", {
              validate: schemaRule(root, "model.id", { patternHint: MODEL_ID_HINT })
            })}
          />
        )}
      </FormField>
    </>
  );
};

export const HandoffFields = ({
  form,
  root,
  idPrefix,
  specialists
}: FieldsProps & { specialists: TAiPersona[] }) => {
  const {
    control,
    formState: { errors }
  } = form;
  const mode = useWatch({ control, name: "handoffsMode" });
  const error = errorAt(errors, "handoffs");

  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-describedby={error ? `${idPrefix}-handoffs-error` : undefined}
    >
      <legend className="mb-1 text-xs text-muted">
        {schemaText(root, "handoffs", "title") ?? "Hands off to"}
      </legend>
      <Controller
        control={control}
        name="handoffsMode"
        render={({ field }) => (
          <RadioGroup value={field.value} onValueChange={field.onChange}>
            <div className="flex items-center gap-2">
              <RadioGroupItem id={`${idPrefix}-handoffs-all`} value="all" />
              <Label htmlFor={`${idPrefix}-handoffs-all`}>Every enabled specialist</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem id={`${idPrefix}-handoffs-some`} value="some" />
              <Label htmlFor={`${idPrefix}-handoffs-some`}>
                Only the specialists checked below
              </Label>
            </div>
          </RadioGroup>
        )}
      />
      {mode === "some" && (
        <Controller
          control={control}
          name="handoffs"
          rules={{
            validate: (value) =>
              value.length === 0
                ? "Check at least one specialist, or choose every enabled specialist."
                : schemaRule(root, "handoffs")(value)
          }}
          render={({ field }) => (
            <div className="grid grid-cols-1 gap-2 pl-6 sm:grid-cols-2">
              {specialists.map((specialist) => (
                <div key={specialist.slug} className="flex items-center gap-2">
                  <Checkbox
                    id={`${idPrefix}-handoff-${specialist.slug}`}
                    isChecked={field.value.includes(specialist.slug)}
                    isError={Boolean(error)}
                    onCheckedChange={(checked) =>
                      field.onChange(
                        checked
                          ? [...field.value, specialist.slug]
                          : field.value.filter((slug) => slug !== specialist.slug)
                      )
                    }
                  />
                  <Label htmlFor={`${idPrefix}-handoff-${specialist.slug}`}>
                    {specialist.name}
                    {!specialist.enabled && <span className="text-xs text-muted"> (off)</span>}
                  </Label>
                </div>
              ))}
            </div>
          )}
        />
      )}
      {error && (
        <p id={`${idPrefix}-handoffs-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
};
