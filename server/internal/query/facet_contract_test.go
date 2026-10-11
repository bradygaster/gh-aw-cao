package query

import (
	"encoding/json"
	"os"
	"reflect"
	"slices"
	"testing"
)

func TestFacetWireCorpus(t *testing.T) {
	data, err := os.ReadFile("testdata/facet-contract.json")
	if err != nil {
		t.Fatal(err)
	}
	var corpus []struct {
		Name     string          `json:"name"`
		Facet    json.RawMessage `json:"facet"`
		Valid    bool            `json:"valid"`
		Required FieldSet        `json:"required"`
	}
	if err := json.Unmarshal(data, &corpus); err != nil {
		t.Fatal(err)
	}
	for _, entry := range corpus {
		t.Run(entry.Name, func(t *testing.T) {
			wire := map[string]any{"name": "panels", "from": "facts"}
			if entry.Facet != nil {
				wire["facet"] = entry.Facet
			}
			encoded, err := json.Marshal([]any{wire})
			if err != nil {
				t.Fatal(err)
			}
			definitions, err := ParseDefinitions(encoded)
			if (err == nil) != entry.Valid {
				t.Fatalf("parse/validate %s: %v; expected valid=%v", encoded, err, entry.Valid)
			}
			if !entry.Valid {
				return
			}
			if err := Validate(definitions); err != nil {
				t.Fatal(err)
			}
			if _, err := CompileSQL(definitions, []string{"panels"}, facetTestResolver); err != nil {
				t.Fatal(err)
			}
			if definitions[0].Facet == nil {
				return
			}
			for _, selectFields := range [][]SelectedField{
				nil, {{Field: "engine"}, {Field: "repository"}, {Field: "workflow"}},
			} {
				definition := definitions[0]
				definition.Select = selectFields
				plan := Normalize(definition)
				want := entry.Required
				if selectFields != nil {
					want = FieldSet{"engine", "repository", "workflow"}
				}
				if !reflect.DeepEqual(plan.SourceFields, want) {
					t.Fatalf("source requirements = %v; want %v", plan.SourceFields, want)
				}
				facetStage := plan.Stages[len(plan.Stages)-1]
				if !reflect.DeepEqual(facetStage.Required, want) {
					t.Fatalf("facet requires %v; want %v", facetStage.Required, want)
				}
				if slices.Contains(plan.RequiredFields, "") || slices.Contains(plan.SourceFields, "") {
					t.Fatalf("normalized plan requests an impossible empty field: %+v", plan)
				}
				if plan.FacetInputShape == nil || len(plan.ResultShape.Fields) != 6 {
					t.Fatalf("lost nested facet shape: %+v", plan)
				}
				for _, stage := range plan.Stages {
					for _, fields := range []FieldSet{stage.Required, stage.LiveBefore, stage.LiveAfter} {
						if slices.Contains(fields, "") {
							t.Fatalf("stage contains nonexistent field: %+v", stage)
						}
					}
				}
			}
		})
	}
}
