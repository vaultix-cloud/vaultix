import { useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { ExternalLinkIcon } from "lucide-react";

import { createNotification } from "@app/components/notifications";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Field,
  FieldLabel,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
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
  Switch
} from "@app/components/v3";
import {
  checkValue,
  schemaAt,
  schemaRule,
  serverMessage,
  specializeSchema,
  TAiConnection,
  TAiConnectionDocument,
  THuggingFaceEndpoint,
  useCheckHuggingFaceAccount,
  useCreateAiConnection,
  useGetAiSchemas,
  useListHuggingFaceEndpoints
} from "@app/hooks/api/assistant";

import { HF_TOKEN_URL, MODEL_ID_HINT } from "./connection-kinds";
import { ConnectionTestPanel } from "./ConnectionTest";
import { applyRefusal, errorAt, FormField, RefusalAlert } from "./form-parts";

type TPolicy = "fastest" | "cheapest" | "preferred" | "provider";
type TWhere = "providers" | "endpoint";

type TValues = {
  credential: { apiKey: string };
  where: TWhere;
  billTo: string;
  repo: string;
  policy: TPolicy;
  provider: string;
  models: { standard: string; fast: string; deep: string };
  namespace: string;
  endpoint: string;
  name: string;
  active: boolean;
};

const SELF = "__self__";
const STEPS = ["Token", "Where It Runs", "Name and Save"] as const;

const providerModel = (values: Pick<TValues, "repo" | "policy" | "provider">) =>
  `${values.repo.trim()}:${values.policy === "provider" ? values.provider.trim() : values.policy}`;

const initialValues = (activeByDefault: boolean): TValues => ({
  credential: { apiKey: "" },
  where: "providers",
  billTo: SELF,
  repo: "",
  policy: "fastest",
  provider: "",
  models: { standard: "tgi", fast: "", deep: "" },
  namespace: SELF,
  endpoint: "",
  name: "Hugging Face",
  active: activeByDefault
});

type Props = {
  activeByDefault: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

export const HuggingFaceSheet = ({ activeByDefault, isOpen, onOpenChange }: Props) => {
  const schemas = useGetAiSchemas();
  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState<TAiConnection>();
  const [refusal, setRefusal] = useState<string>();
  const account = useCheckHuggingFaceAccount();
  const endpoints = useListHuggingFaceEndpoints();
  const create = useCreateAiConnection();
  const defaults = useMemo(() => initialValues(activeByDefault), [activeByDefault]);
  const form = useForm<TValues>({ mode: "onTouched", defaultValues: defaults });
  const {
    control,
    register,
    handleSubmit,
    reset,
    trigger,
    setValue,
    getValues,
    clearErrors,
    formState: { errors, isSubmitting }
  } = form;
  const where = useWatch({ control, name: "where" });
  const policy = useWatch({ control, name: "policy" });
  const namespace = useWatch({ control, name: "namespace" });

  const kind = where === "providers" ? "huggingface" : "huggingface-endpoint";
  const root = useMemo(
    () => (schemas.data ? specializeSchema(schemas.data.connection, "kind", kind) : undefined),
    [schemas.data, kind]
  );
  const accountName = account.data?.name ?? "";
  const owners = account.data ? [account.data.name, ...account.data.organizations] : [];
  const resolveOwner = (value: string) => (value === SELF ? accountName : value);

  const close = () => {
    reset(defaults);
    account.reset();
    endpoints.reset();
    create.reset();
    setStep(0);
    setSaved(undefined);
    setRefusal(undefined);
    onOpenChange(false);
  };

  const checkToken = async () => {
    if (!(await trigger("credential.apiKey"))) return;
    account.mutate({ token: getValues("credential.apiKey").trim() });
  };

  const listEndpoints = () =>
    endpoints.mutate({
      token: getValues("credential.apiKey").trim(),
      namespace: resolveOwner(getValues("namespace"))
    });

  const pickEndpoint = (endpoint: THuggingFaceEndpoint) => {
    setValue("endpoint", endpoint.url, { shouldValidate: true });
    setValue("models.standard", endpoint.model || "tgi", { shouldValidate: true });
    setValue("name", endpoint.name);
  };

  const modelRule = (raw: string) => {
    const values = getValues();
    if (!raw.trim()) return "Required.";
    if (values.policy === "provider" && !values.provider.trim()) return true;
    const schema = root && schemaAt(root, "models.standard");
    if (!root || !schema) return true;
    return checkValue(root, schema, providerModel(values), { patternHint: MODEL_ID_HINT }) ?? true;
  };

  const stepFields = (index: number): Parameters<typeof trigger>[0] => {
    if (index === 0) return ["credential.apiKey"];
    if (index === 1)
      return where === "providers"
        ? ["repo", "provider", "models.fast", "models.deep"]
        : ["endpoint", "models.standard"];
    return ["name"];
  };

  const next = async () => {
    if (await trigger(stepFields(step))) setStep((current) => current + 1);
  };

  const onSubmit = async (values: TValues) => {
    clearErrors();
    setRefusal(undefined);
    const billTo = resolveOwner(values.billTo);
    const document: TAiConnectionDocument =
      values.where === "providers"
        ? {
            schemaVersion: "vaultix.ai-connection.v1",
            name: values.name.trim(),
            kind: "huggingface",
            ...(values.billTo !== SELF && billTo ? { billTo } : {}),
            models: {
              standard: providerModel(values),
              ...(values.models.fast.trim() ? { fast: values.models.fast.trim() } : {}),
              ...(values.models.deep.trim() ? { deep: values.models.deep.trim() } : {})
            },
            active: values.active,
            credential: { apiKey: values.credential.apiKey.trim() }
          }
        : {
            schemaVersion: "vaultix.ai-connection.v1",
            name: values.name.trim(),
            kind: "huggingface-endpoint",
            endpoint: values.endpoint.trim(),
            models: { standard: values.models.standard.trim() },
            active: values.active,
            credential: { apiKey: values.credential.apiKey.trim() }
          };
    try {
      const created = await create.mutateAsync(document);
      createNotification({ type: "success", text: `Added ${created.name}.` });
      setSaved(created);
    } catch (error) {
      setRefusal(
        applyRefusal(error, form, (path) => {
          if (path === "models.standard" && values.where === "providers") return "repo";
          if (path === "credential") return "credential.apiKey";
          return path;
        })
      );
      const failed = (
        ["credential.apiKey", "repo", "provider", "billTo", "endpoint", "models.standard"] as const
      ).find((path) => errorAt(form.formState.errors, path));
      if (failed === "credential.apiKey") setStep(0);
      else if (failed) setStep(1);
    }
  };

  const token = (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        Create a fine-grained token with &quot;Make calls to Inference Providers&quot;. The link
        opens Hugging Face with that permission already selected. Paste the token here; it is stored
        encrypted only when you save, and never goes into chat.
      </p>
      <div>
        <Button variant="outline" size="sm" asChild>
          <a href={HF_TOKEN_URL} target="_blank" rel="noopener noreferrer">
            Create a Token on Hugging Face
            <ExternalLinkIcon />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </Button>
      </div>
      <FormField
        id="ai-hf-token"
        label="Hugging Face token"
        error={errorAt(errors, "credential.apiKey")}
      >
        {(aria) => (
          <Input
            {...aria}
            type="password"
            autoComplete="off"
            spellCheck={false}
            {...register("credential.apiKey", {
              validate: schemaRule(root, "credential.apiKey", { required: true }),
              onChange: () => {
                account.reset();
                endpoints.reset();
              }
            })}
          />
        )}
      </FormField>
      <div>
        <Button
          type="button"
          size="sm"
          variant="neutral"
          isPending={account.isPending}
          onClick={checkToken}
        >
          Check Token
        </Button>
      </div>
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        {account.isError && (
          <Alert variant="danger">
            <AlertDescription>
              {serverMessage(account.error) ?? "Hugging Face did not accept this token."}
            </AlertDescription>
          </Alert>
        )}
        {account.data && (
          <Alert variant="success">
            <AlertDescription>
              Signed in as {account.data.name}
              {account.data.fullName ? ` (${account.data.fullName})` : ""}.
            </AlertDescription>
          </Alert>
        )}
        {account.data?.inferenceAllowed === false && (
          <Alert variant="warning">
            <AlertDescription>
              This token lacks &quot;Make calls to Inference Providers&quot;. Inference Providers
              will refuse it; create a new token with the link above, or use a dedicated endpoint.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );

  const ownerSelect = (name: "billTo" | "namespace", id: string, fieldLabel: string) => (
    <FormField
      id={id}
      label={fieldLabel}
      error={errorAt(errors, name)}
      description={
        name === "billTo"
          ? "Sent as X-HF-Bill-To. Your own account is billed unless you pick an organization."
          : "Where the endpoint lives."
      }
    >
      {(aria) => (
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger {...aria} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {owners.map((owner, index) => (
                  <SelectItem key={owner} value={index === 0 ? SELF : owner}>
                    {index === 0 ? `${owner} (your account)` : owner}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      )}
    </FormField>
  );

  const whereStep = (
    <div className="flex flex-col gap-4">
      <Controller
        control={control}
        name="where"
        render={({ field }) => (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs text-muted">Where the model runs</legend>
            <RadioGroup value={field.value} onValueChange={field.onChange}>
              <div className="flex items-start gap-2">
                <RadioGroupItem id="ai-hf-where-providers" value="providers" className="mt-0.5" />
                <Label
                  htmlFor="ai-hf-where-providers"
                  className="flex flex-col items-start gap-0.5"
                >
                  <span>Inference Providers</span>
                  <span className="text-xs font-normal text-muted">
                    Hugging Face routes each request to a provider that serves the model.
                  </span>
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem id="ai-hf-where-endpoint" value="endpoint" className="mt-0.5" />
                <Label htmlFor="ai-hf-where-endpoint" className="flex flex-col items-start gap-0.5">
                  <span>Dedicated endpoint</span>
                  <span className="text-xs font-normal text-muted">
                    An Inference Endpoint you run for your account or organization.
                  </span>
                </Label>
              </div>
            </RadioGroup>
          </fieldset>
        )}
      />
      {where === "providers" ? (
        <>
          {ownerSelect("billTo", "ai-hf-bill-to", "Who pays")}
          <FormField
            id="ai-hf-repo"
            label="Model"
            description="The model's Hub repo ID, for example openai/gpt-oss-120b."
            error={errorAt(errors, "repo")}
          >
            {(aria) => (
              <Input
                {...aria}
                autoComplete="off"
                spellCheck={false}
                placeholder="organization/model"
                {...register("repo", { validate: modelRule })}
              />
            )}
          </FormField>
          <FormField
            id="ai-hf-policy"
            label="Provider policy"
            description="Which provider answers. Added to the model ID as a suffix."
          >
            {(aria) => (
              <Controller
                control={control}
                name="policy"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger {...aria} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fastest">Fastest (:fastest)</SelectItem>
                      <SelectItem value="cheapest">Cheapest (:cheapest)</SelectItem>
                      <SelectItem value="preferred">My preferred order (:preferred)</SelectItem>
                      <SelectItem value="provider">A specific provider</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            )}
          </FormField>
          {policy === "provider" && (
            <FormField
              id="ai-hf-provider"
              label="Provider"
              description="The provider's name on Hugging Face, for example groq or together."
              error={errorAt(errors, "provider")}
            >
              {(aria) => (
                <Input
                  {...aria}
                  autoComplete="off"
                  spellCheck={false}
                  {...register("provider", {
                    validate: (raw) => {
                      if (!raw.trim()) return "Required.";
                      const schema = root && schemaAt(root, "models.standard");
                      if (!root || !schema) return true;
                      return (
                        checkValue(root, schema, providerModel(getValues()), {
                          patternHint: MODEL_ID_HINT
                        }) ?? true
                      );
                    }
                  })}
                />
              )}
            </FormField>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(["fast", "deep"] as const).map((tier) => (
              <FormField
                key={tier}
                id={`ai-hf-model-${tier}`}
                label={`${tier === "fast" ? "Fast" : "Deep"} model (optional)`}
                description="A full model ID, suffix included. Empty uses the model above."
                error={errorAt(errors, `models.${tier}`)}
              >
                {(aria) => (
                  <Input
                    {...aria}
                    autoComplete="off"
                    spellCheck={false}
                    {...register(`models.${tier}`, {
                      validate: schemaRule(root, `models.${tier}`, { patternHint: MODEL_ID_HINT })
                    })}
                  />
                )}
              </FormField>
            ))}
          </div>
        </>
      ) : (
        <>
          {ownerSelect("namespace", "ai-hf-namespace", "Account or organization")}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              isPending={endpoints.isPending}
              onClick={listEndpoints}
            >
              List Endpoints in {resolveOwner(namespace)}
            </Button>
          </div>
          <div role="status" aria-live="polite" className="flex flex-col gap-2">
            {endpoints.isError && (
              <Alert variant="danger">
                <AlertDescription>
                  {serverMessage(endpoints.error) ?? "The endpoints could not be listed."}
                </AlertDescription>
              </Alert>
            )}
            {endpoints.data?.length === 0 && (
              <p className="text-xs text-muted">
                No endpoints in {resolveOwner(namespace)}. Paste an endpoint URL below instead.
              </p>
            )}
          </div>
          {endpoints.data && endpoints.data.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label="Endpoints">
              {endpoints.data.map((endpoint) => (
                <li
                  key={endpoint.url}
                  className="flex items-center justify-between gap-2 rounded-md border border-border p-2"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{endpoint.name}</span>
                    <span className="truncate font-mono text-xs text-muted">{endpoint.model}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={endpoint.state === "running" ? "success" : "warning"}>
                      {endpoint.state}
                    </Badge>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => pickEndpoint(endpoint)}
                    >
                      Use {endpoint.name}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <FormField
            id="ai-hf-endpoint"
            label="Endpoint URL"
            description="The endpoint's https URL. Vaultix adds /v1."
            error={errorAt(errors, "endpoint")}
          >
            {(aria) => (
              <Input
                {...aria}
                type="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://xyz.endpoints.huggingface.cloud"
                {...register("endpoint", {
                  validate: schemaRule(root, "endpoint", {
                    required: true,
                    patternHint: "Enter an https:// URL without credentials, a query or a fragment."
                  })
                })}
              />
            )}
          </FormField>
          <FormField
            id="ai-hf-endpoint-model"
            label="Model"
            description="The model name the endpoint serves. Text Generation Inference answers to tgi."
            error={errorAt(errors, "models.standard") ?? errorAt(errors, "models")}
          >
            {(aria) => (
              <Input
                {...aria}
                autoComplete="off"
                spellCheck={false}
                {...register("models.standard", {
                  validate: schemaRule(root, "models.standard", { patternHint: MODEL_ID_HINT })
                })}
              />
            )}
          </FormField>
        </>
      )}
    </div>
  );

  const saveStep = (
    <div className="flex flex-col gap-4">
      <FormField
        id="ai-hf-name"
        label="Name"
        description="What administrators call this connection."
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
      <Field orientation="horizontal">
        <FieldLabel htmlFor="ai-hf-active">Use for the assistant</FieldLabel>
        <Controller
          control={control}
          name="active"
          render={({ field }) => (
            <Switch
              id="ai-hf-active"
              variant="neutral"
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
      </Field>
      <p className="text-xs text-muted">
        After saving, test the connection. The test calls the model and checks tool calls. A model
        without tool calls can still answer, but cannot run Vaultix actions.
      </p>
    </div>
  );

  return (
    <Sheet open={isOpen} onOpenChange={(open) => (open ? onOpenChange(true) : close())}>
      <SheetContent className="flex flex-col sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{saved ? `${saved.name} Added` : "Add Hugging Face Connection"}</SheetTitle>
          <SheetDescription>
            {saved
              ? "Test it now to see whether it answers and can run Vaultix actions."
              : `Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}
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
            <ol className="flex gap-2 border-b border-border px-4 py-2 text-xs" aria-label="Steps">
              {STEPS.map((title, index) => (
                <li
                  key={title}
                  aria-current={index === step ? "step" : undefined}
                  className={index === step ? "font-medium text-foreground" : "text-muted"}
                >
                  {index + 1}. {title}
                </li>
              ))}
            </ol>
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
              <RefusalAlert message={refusal} />
              {step === 0 && token}
              {step === 1 && whereStep}
              {step === 2 && saveStep}
            </div>
            <SheetFooter className="justify-end border-t">
              {step > 0 ? (
                <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>
                  Back
                </Button>
              ) : (
                <Button type="button" variant="ghost" onClick={close}>
                  Cancel
                </Button>
              )}
              {step < STEPS.length - 1 ? (
                <Button
                  type="button"
                  variant="neutral"
                  isDisabled={step === 0 && !account.data}
                  onClick={next}
                >
                  Continue
                </Button>
              ) : (
                <Button type="submit" variant="neutral" isPending={isSubmitting}>
                  Add Connection
                </Button>
              )}
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
};
