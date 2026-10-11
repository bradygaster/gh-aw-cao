package query

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestDateBucketLiteralUnits(t *testing.T) {
	data, err := os.ReadFile("testdata/date-bucket-units.json")
	if err != nil {
		t.Fatal(err)
	}
	var contract struct {
		Valid []struct {
			Unit string `json:"unit"`
		} `json:"valid"`
		Invalid []json.RawMessage `json:"invalid"`
	}
	if err := json.Unmarshal(data, &contract); err != nil {
		t.Fatal(err)
	}
	for _, test := range contract.Valid {
		t.Run(test.Unit, func(t *testing.T) {
			for _, kind := range []SQLKind{SQLTimestamp, SQLText} {
				field := "started-at"
				definitions := []Definition{{Name: "buckets", From: "facts", Compute: []ComputedField{{
					As: "bucket", Function: "date-bucket", Args: []Argument{{Field: &field}, {Value: test.Unit}},
				}}}}
				plan, err := CompileSQL(definitions, []string{"buckets"}, func(string) (SQLRelation, error) {
					return SQLRelation{
						SQL: "(SELECT at FROM facts) AS facts", Order: "at",
						Columns: map[string]SQLColumn{field: {Expression: "at", Presence: "TRUE", Kind: kind}},
					}, nil
				})
				if err != nil {
					t.Fatal(err)
				}
				if !strings.Contains(plan.CTEs, "date_trunc('"+test.Unit+"'") || !strings.Contains(plan.CTEs, "AT TIME ZONE 'UTC'") {
					t.Fatalf("missing literal UTC bucketing: %s", plan.CTEs)
				}
			}
		})
	}
	for _, argument := range contract.Invalid {
		t.Run(string(argument), func(t *testing.T) {
			definitions, err := ParseDefinitions([]byte(`[{"name":"buckets","from":"facts","compute":[{"as":"bucket","function":"date-bucket","args":[{"field":"started-at"},` + string(argument) + `]}]}]`))
			if err == nil || !strings.Contains(err.Error(), "literal UTC unit") {
				t.Fatalf("invalid unit admitted or wrong diagnostic: %s: %v", argument, err)
			}
			if _, err := CompileSQL(definitions, []string{"buckets"}, sqlTestResolver); err == nil {
				t.Fatalf("SQL compiler admitted invalid unit: %s", argument)
			}
		})
	}
}
