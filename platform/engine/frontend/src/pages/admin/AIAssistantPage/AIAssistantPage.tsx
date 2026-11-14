import { useState } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";

import { PageHeader } from "@app/components/v2";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@app/components/v3";

import { ConnectionsTab } from "./components/ConnectionsTab";
import { MemoriesSection } from "./components/MemoriesSection";
import { PersonasTab } from "./components/PersonasTab";
import { RoutingTab } from "./components/RoutingTab";
import { TryItTab } from "./components/TryItTab";

const TABS = [
  { value: "connections", label: "Connections" },
  { value: "personas", label: "Personas" },
  { value: "routing", label: "Routing" },
  { value: "memories", label: "Memories" },
  { value: "try", label: "Try It" }
] as const;

export const AIAssistantPage = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<string>("connections");

  return (
    <div className="h-full bg-background text-foreground">
      <Helmet>
        <title>{t("common.head-title", { title: "AI Assistant" })}</title>
      </Helmet>
      <div className="mx-auto mb-6 flex w-full max-w-8xl flex-col gap-6">
        <PageHeader
          scope="instance"
          title="AI Assistant"
          description="The connections and personas behind the assistant in Vaultix. It works only with names and references, through each person's own permissions; secret values never reach it."
        />
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList variant="admin" aria-label="AI settings">
            {TABS.map((entry) => (
              <TabsTrigger key={entry.value} value={entry.value}>
                {entry.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="connections" className="pt-4">
            <ConnectionsTab />
          </TabsContent>
          <TabsContent value="personas" className="pt-4">
            <PersonasTab />
          </TabsContent>
          <TabsContent value="routing" className="pt-4">
            <RoutingTab />
          </TabsContent>
          <TabsContent value="memories" className="pt-4">
            <MemoriesSection />
          </TabsContent>
          <TabsContent value="try" className="pt-4">
            <TryItTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};
