// Package azcli runs the Azure CLI as a cancellable child process.
//
// Callers must never place secret values in argv. Secure deployment values
// belong in owner-only parameter files or Key Vault references.
package azcli

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"slices"
	"strings"
	"time"
)

// Result is the captured output of one Azure CLI invocation.
type Result struct {
	Stdout string
	Stderr string
}

// Executor runs one Azure CLI invocation. Implementations must honor ctx.
type Executor interface {
	Run(ctx context.Context, args ...string) (Result, error)
}

// ExecutorFunc adapts a function to Executor.
type ExecutorFunc func(context.Context, ...string) (Result, error)

func (f ExecutorFunc) Run(ctx context.Context, args ...string) (Result, error) {
	return f(ctx, args...)
}

// Process runs the az binary found on PATH when the first command executes.
type Process struct {
	// Path overrides PATH lookup; empty means "az".
	Path string
	// WaitDelay bounds how long output pipes may outlive a cancelled process.
	WaitDelay time.Duration
}

// ExitError reports a non-zero Azure CLI exit. Stderr is retained for callers
// that redact it before display.
type ExitError struct {
	Code   int
	Stderr string
}

func (e *ExitError) Error() string {
	message := strings.TrimSpace(e.Stderr)
	if message == "" {
		return fmt.Sprintf("az exited with status %d", e.Code)
	}
	return fmt.Sprintf("az exited with status %d: %s", e.Code, message)
}

func (p Process) Run(ctx context.Context, args ...string) (Result, error) {
	if err := ctx.Err(); err != nil {
		return Result{}, err
	}
	path := p.Path
	if path == "" {
		found, err := exec.LookPath("az")
		if err != nil {
			return Result{}, fmt.Errorf("find Azure CLI (install az and ensure it is on PATH): %w", err)
		}
		path = found
	}
	command := exec.CommandContext(ctx, path, args...)
	command.Env = append(os.Environ(),
		"AZURE_CORE_ONLY_SHOW_ERRORS=true",
		"AZURE_CORE_NO_COLOR=true",
		"AZURE_CORE_SURVEY_MESSAGE=false",
	)
	command.WaitDelay = p.WaitDelay
	if command.WaitDelay == 0 {
		command.WaitDelay = 5 * time.Second
	}
	var stdout, stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	err := command.Run()
	result := Result{Stdout: stdout.String(), Stderr: stderr.String()}
	if ctxErr := ctx.Err(); ctxErr != nil {
		return result, fmt.Errorf("az %s: %w", CommandName(args), ctxErr)
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return result, &ExitError{Code: exit.ExitCode(), Stderr: result.Stderr}
	}
	if err != nil {
		return result, fmt.Errorf("run az %s: %w", CommandName(args), err)
	}
	return result, nil
}

// readOnlyCommands lists the only Azure CLI command paths that plan mode may run.
var readOnlyCommands = [][]string{
	{"account", "show"},
	{"group", "exists"},
	{"resource", "list"},
	{"deployment", "group", "what-if"},
	{"deployment", "sub", "what-if"},
}

// IsReadOnly reports whether args name an allowlisted read-only or what-if command.
func IsReadOnly(args []string) bool {
	path := CommandPath(args)
	for _, allowed := range readOnlyCommands {
		if slices.Equal(path, allowed) {
			return true
		}
	}
	return false
}

// ReadOnly refuses any command that is not allowlisted before it reaches next.
func ReadOnly(next Executor) Executor {
	return ExecutorFunc(func(ctx context.Context, args ...string) (Result, error) {
		if !IsReadOnly(args) {
			return Result{}, fmt.Errorf("refusing non-read-only Azure CLI command %q", CommandName(args))
		}
		return next.Run(ctx, args...)
	})
}

// CommandPath returns the leading command words before the first option.
func CommandPath(args []string) []string {
	var path []string
	for _, arg := range args {
		if strings.HasPrefix(arg, "-") {
			break
		}
		path = append(path, arg)
	}
	return path
}

// CommandName returns the space-joined command path.
func CommandName(args []string) string {
	return strings.Join(CommandPath(args), " ")
}
