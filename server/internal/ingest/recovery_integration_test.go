package ingest

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestAzureEmptyPublicationIsReadyAndRepeatable(t *testing.T) {
	ctx, store := ingestTestStore(t)
	options := Options{DatabaseQueriesPath: "../../../dashboard/site/src/data/queries/database.json"}
	first, err := Run(ctx, store, "../../azure/empty-data", options)
	if err != nil {
		t.Fatal(err)
	}
	if first.Revision == 0 || first.DataRevision == "" {
		t.Fatalf("empty dataset was not published: %+v", first)
	}
	for _, source := range []string{"$repositories", "$campaigns", "$workflows", "$runs"} {
		count, exists := first.Counts[source]
		if !exists || count != 0 {
			t.Fatalf("empty publication %s count = %d, exists = %t", source, count, exists)
		}
	}
	second, err := Run(ctx, store, "../../azure/empty-data", options)
	if err != nil {
		t.Fatal(err)
	}
	if second.Revision != first.Revision || second.DataRevision != first.DataRevision {
		t.Fatalf("repeat ingestion changed publication: %+v", second)
	}
	definitions, err := loadDefinitions(options.DatabaseQueriesPath)
	if err != nil {
		t.Fatal(err)
	}
	sources, _, err := store.ExecuteSQLPlan(ctx, definitions, []string{"repositories", "campaigns", "workflows", "runs"})
	if err != nil {
		t.Fatal(err)
	}
	for name, source := range sources {
		if len(source.Rows) != 0 {
			t.Fatalf("empty publication query %s returned %d rows", name, len(source.Rows))
		}
	}
}

func TestEmptyPostgresRebuildAndFailedIngestionPreservesCurrentData(t *testing.T) {
	ctx, store := ingestTestStore(t)
	directory := scratchDirectory(t)
	options := Options{DatabaseQueriesPath: "../../../dashboard/site/src/data/queries/database.json"}
	for _, name := range []string{"inventory-sources.json", "payload-hashes.json", "gh-aw-logs-runs/subset.jsonl", "gh-aw-logs-records/subset.jsonl"} {
		// #nosec G304 -- the fixture root and filenames are fixed test inputs.
		content, err := os.ReadFile(filepath.Join("../../testdata/deployed-subset", name))
		if err != nil {
			t.Fatal(err)
		}
		writeTestFile(t, filepath.Join(directory, name), content)
	}
	before, err := Run(ctx, store, directory, options)
	if err != nil {
		t.Fatal(err)
	}
	name := "gh-aw-logs-records/subset.jsonl"
	// #nosec G304 -- this path belongs to this test's owned scratch directory.
	content, err := os.ReadFile(filepath.Join(directory, name))
	if err != nil {
		t.Fatal(err)
	}
	content = append(content, []byte("{\"kind\":\"record\",\"collection\":\"domains\",\"record\":{\"id\":\"orphan\",\"runId\":\"missing\"}}\n")...)
	writeTestFile(t, filepath.Join(directory, name), content)
	// #nosec G304 -- this path belongs to this test's owned scratch directory.
	manifestContent, err := os.ReadFile(filepath.Join(directory, "payload-hashes.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest Manifest
	if err := json.Unmarshal(manifestContent, &manifest); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(content)
	manifest[name] = hex.EncodeToString(sum[:])
	manifestContent, _ = json.Marshal(manifest)
	writeTestFile(t, filepath.Join(directory, "payload-hashes.json"), manifestContent)
	if _, err := Run(ctx, store, directory, options); err == nil {
		t.Fatal("orphan shard published")
	}
	after, err := store.State(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if after.Revision != before.Revision || after.DataRevision != before.DataRevision || !reflect.DeepEqual(after.Counts, before.Counts) {
		t.Fatalf("failed ingestion changed publication: %+v", after)
	}
}
