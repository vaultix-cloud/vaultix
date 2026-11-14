import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import { createNotification } from "@app/components/notifications";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@app/components/v3";
import {
  omitKeys,
  personaDocument,
  specializeSchema,
  TAiConnection,
  TAiPersona,
  useGetAiConnections,
  useGetAiPersonas,
  useGetAiSchemas,
  useUpdateAiPersona
} from "@app/hooks/api/assistant";

import { applyRefusal, RefusalAlert } from "./form-parts";
import {
  HandoffFields,
  handoffsFrom,
  modelDocumentFrom,
  modelValuesFrom,
  PersonaModelFields,
  TPersonaModelValues
} from "./persona-fields";

const RouterSettings = ({
  router,
  specialists,
  connections
}: {
  router: TAiPersona;
  specialists: TAiPersona[];
  connections: TAiConnection[];
}) => {
  const schemas = useGetAiSchemas();
  const update = useUpdateAiPersona();
  const [refusal, setRefusal] = useState<string>();
  const root = useMemo(
    () => (schemas.data ? specializeSchema(schemas.data.persona, "role", "router") : undefined),
    [schemas.data]
  );
  const initial = useMemo(() => modelValuesFrom(router), [router]);
  const form = useForm<TPersonaModelValues>({ mode: "onTouched", values: initial });
  const {
    handleSubmit,
    clearErrors,
    formState: { isSubmitting, isDirty }
  } = form;

  const onSubmit = async (values: TPersonaModelValues) => {
    clearErrors();
    setRefusal(undefined);
    const rest = omitKeys(personaDocument(router), ["handoffs"]);
    const handoffs = handoffsFrom(values);
    try {
      await update.mutateAsync({
        slug: router.slug,
        document: { ...rest, ...modelDocumentFrom(values), ...(handoffs ? { handoffs } : {}) }
      });
      createNotification({ type: "success", text: `Saved ${router.name}'s routing.` });
    } catch (error) {
      setRefusal(
        applyRefusal(error, form, (path) => (path.startsWith("handoffs") ? "handoffs" : path))
      );
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
      <RefusalAlert message={refusal} />
      <PersonaModelFields form={form} root={root} idPrefix="ai-router" connections={connections} />
      <HandoffFields form={form} root={root} idPrefix="ai-router" specialists={specialists} />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          isDisabled={!isDirty}
          onClick={() => {
            form.reset(initial);
            setRefusal(undefined);
          }}
        >
          Discard Changes
        </Button>
        <Button type="submit" variant="neutral" isPending={isSubmitting}>
          Save Routing
        </Button>
      </div>
    </form>
  );
};

export const RoutingTab = () => {
  const { data } = useGetAiPersonas();
  const { data: connectionData } = useGetAiConnections();
  const personas = data?.personas ?? [];
  const router = personas.find((persona) => persona.role === "router");
  const specialists = personas.filter((persona) => persona.role === "specialist");
  const routerName = router?.name ?? "Clyffy";

  const routes = (data?.domains ?? []).map((domain) => {
    const answerer = specialists.find(
      (persona) => persona.enabled !== false && persona.domains.includes(domain)
    );
    const handedOff = !answerer || !router?.handoffs || router.handoffs.includes(answerer.slug);
    return { domain, answerer, handedOff };
  });

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Who Answers Each Area</CardTitle>
          <CardDescription>
            On a page in an area, the first enabled specialist for that area answers. Where no
            specialist covers an area, {routerName} answers. An @mention always picks that persona.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Area</TableHead>
                <TableHead>Answered By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {routes.map(({ domain, answerer, handedOff }) => (
                <TableRow key={domain}>
                  <TableCell className="font-mono text-xs">{domain}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{answerer ? answerer.name : routerName}</span>
                      {!answerer && <Badge variant="neutral">Router</Badge>}
                      {!handedOff && (
                        <span className="text-xs text-muted">
                          {routerName} does not hand off to it from other pages.
                        </span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {router && (
        <Card>
          <CardHeader>
            <CardTitle>{routerName}&apos;s Model and Handoffs</CardTitle>
            <CardDescription>
              The model {routerName} runs on and the specialists it may choose when a question has
              no page or mention to go by.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RouterSettings
              router={router}
              specialists={specialists}
              connections={connectionData?.connections ?? []}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
};
