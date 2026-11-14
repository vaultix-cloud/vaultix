package assistant

import (
	"context"
	"strings"
	"testing"

	"github.com/vaultix-cloud/api/internal/services/assistant/spec"
)

func answerAs(t *testing.T, change func(p *Persona), memories []Memory) *scriptedModel {
	t.Helper()
	personas := testPersonas()
	change(&personas[1])
	model := &scriptedModel{answers: []*ChatResponse{{Text: "done"}}}
	models, _ := modelsFor(model)
	if _, err := quietAgent(&recordingHost{}).Answer(context.Background(), personas, models, "person-token", memories,
		&MessageRequest{Persona: "secrets", Messages: []Message{{Role: "user", Content: "hello"}}}); err != nil {
		t.Fatal(err)
	}
	return model
}

func TestAgentAnswer_PersonaModelSettingsReachTheModel(t *testing.T) {
	temperature, topP, tokens := 0.2, 0.9, 700
	model := answerAs(t, func(p *Persona) {
		p.ModelSettings = &spec.ModelSettings{Temperature: &temperature, TopP: &topP, MaxOutputTokens: &tokens, StopSequences: []string{"END"}}
	}, nil)
	sent := model.requests[0]
	if sent.Temperature == nil || *sent.Temperature != 0.2 || sent.TopP == nil || *sent.TopP != 0.9 || sent.MaxTokens != 700 || len(sent.Stop) != 1 {
		t.Fatalf("settings not sent: %+v", sent)
	}
}

func TestAgentAnswer_ToolAllowlistAndToolsOff(t *testing.T) {
	model := answerAs(t, func(p *Persona) { p.Tools = []string{} }, nil)
	if tools := model.requests[0].Tools; len(tools) != 1 || tools[0].Name != proposeTool {
		t.Fatalf("an empty allowlist leaves only the memory suggestion, got %+v", tools)
	}
	model = answerAs(t, func(p *Persona) { p.Tools = []string{"vaultix.secrets.references"} }, nil)
	if tools := model.requests[0].Tools; len(tools) != 2 || tools[0].Name != "vaultix__secrets__references" {
		t.Fatalf("the named tool is offered, got %+v", tools)
	}
	none := "none"
	model = answerAs(t, func(p *Persona) { p.ModelSettings = &spec.ModelSettings{ToolChoice: &none} }, nil)
	if len(model.requests[0].Tools) != 0 {
		t.Fatalf("tool use off offers nothing, got %+v", model.requests[0].Tools)
	}
}

func TestAgentAnswer_MemoryUse(t *testing.T) {
	memories := []Memory{{Scope: ScopeInstance, Content: "Instance note."}, {Scope: ScopePersonal, Content: "Personal note."}}
	model := answerAs(t, func(p *Persona) { p.MemoryUse = "instance" }, memories)
	system := model.requests[0].System
	if !strings.Contains(system, "Instance note.") || strings.Contains(system, "Personal note.") {
		t.Fatalf("instance-only memory use: %s", system)
	}
	model = answerAs(t, func(p *Persona) { p.MemoryUse = "none" }, memories)
	if strings.Contains(model.requests[0].System, "note.") {
		t.Fatal("a persona that uses no memories was given some")
	}
	for _, tool := range model.requests[0].Tools {
		if tool.Name == proposeTool {
			t.Fatal("a persona that uses no memories may not suggest one")
		}
	}
}

func TestAgentRoute_RouterChoosesOnlyAmongItsHandoffs(t *testing.T) {
	personas := testPersonas()
	personas[0].Handoffs = []string{"access"}
	model := &scriptedModel{answers: []*ChatResponse{{Text: "secrets"}}}
	models, _ := modelsFor(model)
	p, by := quietAgent(&recordingHost{}).route(context.Background(), personas, models, &MessageRequest{Messages: []Message{{Role: "user", Content: "hi"}}})
	if !strings.Contains(model.requests[0].System, "access: access") || strings.Contains(model.requests[0].System, "secrets: secrets") {
		t.Fatalf("the router was offered specialists outside its handoffs: %s", model.requests[0].System)
	}
	if p.Slug != "clyffy" || by != "default" {
		t.Fatalf("a choice outside the handoffs falls back to the router, got %s by %s", p.Slug, by)
	}
}
