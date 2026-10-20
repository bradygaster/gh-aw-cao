package azcli

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

func TestHelperAzProcess(t *testing.T) {
	if os.Getenv("AZCLI_HELPER_PROCESS") != "1" {
		return
	}
	args := os.Args
	for len(args) > 0 && args[0] != "--" {
		args = args[1:]
	}
	if len(args) > 0 {
		args = args[1:]
	}
	switch strings.Join(args, " ") {
	case "ok":
		fmt.Fprint(os.Stdout, `{"ok":true}`)
		fmt.Fprint(os.Stderr, os.Getenv("AZURE_CORE_ONLY_SHOW_ERRORS"))
		os.Exit(0)
	case "fail":
		fmt.Fprint(os.Stderr, "synthetic failure")
		os.Exit(3)
	case "sleep":
		time.Sleep(30 * time.Second)
		os.Exit(0)
	}
	os.Exit(2)
}

func helperProcess(t *testing.T) Executor {
	t.Helper()
	t.Setenv("AZCLI_HELPER_PROCESS", "1")
	return ExecutorFunc(func(ctx context.Context, args ...string) (Result, error) {
		return Process{Path: os.Args[0], WaitDelay: time.Second}.Run(ctx, append([]string{"-test.run=TestHelperAzProcess", "--"}, args...)...)
	})
}

func TestProcessCapturesOutputAndEnvironment(t *testing.T) {
	result, err := helperProcess(t).Run(context.Background(), "ok")
	if err != nil {
		t.Fatal(err)
	}
	if result.Stdout != `{"ok":true}` || result.Stderr != "true" {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestProcessReportsExitStatus(t *testing.T) {
	_, err := helperProcess(t).Run(context.Background(), "fail")
	var exit *ExitError
	if !errors.As(err, &exit) || exit.Code != 3 || !strings.Contains(exit.Error(), "synthetic failure") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestProcessHonorsCancellation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	started := time.Now()
	_, err := helperProcess(t).Run(ctx, "sleep")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected deadline error, got %v", err)
	}
	if elapsed := time.Since(started); elapsed > 10*time.Second {
		t.Fatalf("cancellation took %s", elapsed)
	}
}

func TestProcessRejectsCancelledContextWithoutStarting(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := (Process{Path: "/nonexistent/az"}).Run(ctx, "account", "show"); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation, got %v", err)
	}
}

func TestProcessMissingAzure(t *testing.T) {
	t.Setenv("PATH", "")
	if _, err := (Process{}).Run(context.Background(), "account", "show"); err == nil || !strings.Contains(err.Error(), "install az") {
		t.Fatalf("expected missing az error, got %v", err)
	}
}

func TestReadOnlyGuard(t *testing.T) {
	calls := 0
	next := ExecutorFunc(func(context.Context, ...string) (Result, error) {
		calls++
		return Result{}, nil
	})
	guard := ReadOnly(next)
	for _, args := range [][]string{
		{"account", "show", "--subscription", "x"},
		{"group", "exists", "--name", "x"},
		{"resource", "list", "--resource-group", "x"},
		{"deployment", "group", "what-if", "--resource-group", "x"},
		{"deployment", "sub", "what-if", "--location", "x"},
	} {
		if _, err := guard.Run(context.Background(), args...); err != nil {
			t.Fatalf("%v: %v", args, err)
		}
	}
	for _, args := range [][]string{
		{"group", "create", "--name", "x"},
		{"group", "delete", "--name", "x"},
		{"deployment", "group", "create"},
		{"deployment", "sub", "create"},
		{"keyvault", "secret", "set"},
		{"functionapp", "start"},
		{"acr", "import"},
		{"acr", "build"},
		{"bicep", "build"},
		{"resource", "update"},
		{"account", "set"},
		{"account"},
		{},
	} {
		if _, err := guard.Run(context.Background(), args...); err == nil {
			t.Fatalf("%v: write command was allowed", args)
		}
	}
	if calls != 5 {
		t.Fatalf("guard forwarded %d calls, want 5", calls)
	}
}
