package cli

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"github.com/githubnext/gh-cao/internal/azcli"
)

// A release bundle source can implement this without changing apply ordering.
// Sources supply product files only; operator policy and evidence are separate.
type deployAzureBuildSource interface {
	Materialize(context.Context, string) (string, error)
}

type deployAzureDevSource struct{ directory string }

type deployAzureBuildContext struct {
	Directory, Revision, Digest string
}

type deployAzureBuiltImage struct {
	Target     string `json:"target"`
	Reference  string `json:"reference"`
	Digest     string `json:"digest"`
	Repository string `json:"repository"`
	Tag        string `json:"tag"`
}

func deployAzureImageTag(config deployAzureConfig) string {
	content, _ := json.Marshal(config)
	sum := sha256.Sum256(content)
	// The reviewed version plus configuration identity is never a mutable
	// shared `latest` tag. The freshly created registry is locked after build.
	version := config.Image.Tag
	if len(version) > 110 {
		version = version[:110]
	}
	return version + "-" + hex.EncodeToString(sum[:6])
}

func (s deployAzureDevSource) Materialize(ctx context.Context, destination string) (string, error) {
	root, err := filepath.Abs(s.directory)
	if err != nil {
		return "", err
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	git := func(args ...string) (string, error) {
		command := exec.CommandContext(ctx, "git", append([]string{"-C", root}, args...)...)
		output, err := command.Output()
		if err != nil {
			return "", fmt.Errorf("inspect development build source: %w", err)
		}
		return string(output), nil
	}
	revision, err := git("rev-parse", "HEAD")
	if err != nil {
		return "", err
	}
	revision = strings.TrimSpace(revision)
	if !regexp.MustCompile(`^[0-9a-f]{40}$`).MatchString(revision) {
		return "", errors.New("development source must have a full Git commit SHA")
	}
	files, err := git("ls-files", "-z")
	if err != nil {
		return "", err
	}
	for _, name := range strings.Split(files, "\x00") {
		if !deployAzureBuildFileAllowed(name) {
			continue
		}
		if err := copyDeployAzureFile(filepath.Join(root, filepath.FromSlash(name)), filepath.Join(destination, filepath.FromSlash(name))); err != nil {
			return "", fmt.Errorf("copy build source %s: %w", name, err)
		}
	}
	for _, required := range []string{"server/Dockerfile", "server/go.mod", "dashboard/site/package.json", "activity/inventory.mjs", "aw.yml"} {
		if _, err := os.Stat(filepath.Join(destination, required)); err != nil {
			return "", fmt.Errorf("development source is not a gh-cao checkout: missing %s", required)
		}
	}
	return revision, nil
}

func deployAzureBuildFileAllowed(name string) bool {
	if name == "" || !filepath.IsLocal(name) || strings.Contains(name, "\\") {
		return false
	}
	parts := strings.Split(name, "/")
	for _, part := range parts {
		if slices.Contains([]string{"node_modules", "dist", ".git", ".tmp", "test-results", ".cache"}, part) {
			return false
		}
	}
	if name == ".dockerignore" || name == "aw.yml" || name == "README.md" || strings.HasSuffix(name, "/aw.yml") || strings.HasSuffix(name, "/README.md") {
		return true
	}
	if name == ".github/workflows/cao.json" || name == ".github/workflows/cao.azure.json" {
		return false
	}
	if strings.HasPrefix(name, ".github/workflows/") {
		return (len(parts) == 3 && (strings.HasSuffix(name, ".md") || strings.HasSuffix(name, ".lock.yml"))) ||
			(strings.HasPrefix(name, ".github/workflows/shared/") && slices.Contains([]string{".mjs", ".js", ".json", ".md", ".ts"}, filepath.Ext(name)))
	}
	if !strings.HasPrefix(name, "server/") && !strings.HasPrefix(name, "activity/") &&
		!strings.HasPrefix(name, "dashboard/") && !strings.HasPrefix(name, "internal/dashboardquery/") {
		return false
	}
	return slices.Contains([]string{".go", ".mod", ".sum", ".json", ".jsonl", ".mjs", ".js", ".ts", ".css", ".html", ".svg", ".sql", ".yml", ".yaml", ".txt", ".md", ".bicep", ".xml", ".png", ".woff2", ".ico"}, filepath.Ext(name)) ||
		name == "server/Dockerfile"
}

func copyDeployAzureFile(source, destination string) error {
	// Reject symbolic links in every path component, not only the leaf.
	for path := source; ; path = filepath.Dir(path) {
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("symbolic links are not allowed in build inputs: %s", source)
		}
		if filepath.Dir(path) == path {
			break
		}
	}
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer func() { _ = input.Close() }()
	info, err := input.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("build input is not a regular file: %s", source)
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return err
	}
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	closeErr := output.Close()
	return errors.Join(copyErr, closeErr)
}

func prepareDeployAzureBuild(ctx context.Context, source deployAzureBuildSource, workspace *deployAzureWorkspace, options deployAzureApplyOptions) (deployAzureBuildContext, error) {
	build := deployAzureBuildContext{Directory: filepath.Join(workspace.directory, "context")}
	if err := os.Mkdir(build.Directory, 0o700); err != nil {
		return build, err
	}
	var err error
	build.Revision, err = source.Materialize(ctx, build.Directory)
	if err != nil {
		return build, err
	}
	repoDir, err := filepath.EvalSymlinks(options.RepoDir)
	if err != nil {
		return build, fmt.Errorf("resolve operator repository: %w", err)
	}
	for _, name := range []string{"cao.json", "cao.azure.json"} {
		path := filepath.Join(repoDir, ".github", "workflows", name)
		content, err := os.ReadFile(path)
		if err != nil {
			return build, fmt.Errorf("read adopter-owned %s: %w", name, err)
		}
		var policy map[string]any
		if err := json.Unmarshal(content, &policy); err != nil || policy == nil {
			return build, fmt.Errorf("adopter-owned %s must be a JSON object", name)
		}
		for _, pattern := range deployEmbeddedSecretPatterns {
			if pattern.Match(content) {
				return build, fmt.Errorf("adopter-owned %s appears to embed a secret", name)
			}
		}
		if err := copyDeployAzureFile(path, filepath.Join(build.Directory, ".github", "workflows", name)); err != nil {
			return build, err
		}
	}
	if options.SnapshotDir != "" {
		if err := copyDeployAzureSnapshot(options.SnapshotDir, filepath.Join(build.Directory, "cao-deploy-evidence")); err != nil {
			return build, err
		}
	}
	hash := sha256.New()
	err = filepath.WalkDir(build.Directory, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		name, err := filepath.Rel(build.Directory, path)
		if err != nil {
			return err
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		fileSum := sha256.Sum256(content)
		_, err = fmt.Fprintf(hash, "%s\x00%x\n", filepath.ToSlash(name), fileSum)
		return err
	})
	build.Digest = hex.EncodeToString(hash.Sum(nil))
	return build, err
}

func deployAzureBuildImages(ctx context.Context, az azcli.Executor, config deployAzureConfig, build deployAzureBuildContext, options deployAzureApplyOptions, provision bool) ([]deployAzureBuiltImage, error) {
	repository := config.Image.Repository
	if repository == "" {
		repository = "cao-functions"
	}
	target := "azure-ingest-runtime"
	if options.EmptyEvidence {
		target = "azure-empty-ingest-runtime"
	}
	var images []deployAzureBuiltImage
	targets := []struct{ repository, target string }{{repository, "azure-functions-runtime"}, {"cao-ingest", target}}
	if provision {
		targets = append(targets, struct{ repository, target string }{"cao-db-provision", "azure-db-provision"})
	}
	for _, image := range targets {
		tag := deployAzureImageTag(config)
		args := []string{"acr", "build", "--subscription", config.Subscription, "--registry", config.Resources.ContainerRegistry,
			"--image", image.repository + ":" + tag, "--file", "server/Dockerfile", "--target", image.target,
			"--platform", "linux/amd64", "--build-arg", "REVISION=" + build.Revision,
			"--build-arg", "VERSION=" + config.Image.Tag, "--build-arg", "CAO_PROFILE=cao.azure.json",
			"--no-logs", "--output", "json"}
		if !options.EmptyEvidence {
			args = append(args, "--build-arg", "CAO_INGEST_SOURCE=cao-deploy-evidence")
		}
		if _, err := az.Run(ctx, append(args, build.Directory)...); err != nil {
			return nil, fmt.Errorf("ACR build target %s failed; full template was not deployed: %w", image.target, err)
		}
		result, err := az.Run(ctx, "acr", "repository", "show", "--subscription", config.Subscription, "--name", config.Resources.ContainerRegistry, "--image", image.repository+":"+tag, "--output", "json")
		if err != nil {
			return nil, fmt.Errorf("resolve built image digest: %w", err)
		}
		var metadata struct {
			Digest string `json:"digest"`
		}
		if err := json.Unmarshal([]byte(result.Stdout), &metadata); err != nil {
			return nil, fmt.Errorf("parse built image digest: %w", err)
		}
		if !regexp.MustCompile(`^sha256:[0-9a-f]{64}$`).MatchString(metadata.Digest) {
			return nil, errors.New("ACR did not return a valid image digest")
		}
		if _, err := az.Run(ctx, "acr", "repository", "update", "--subscription", config.Subscription, "--name", config.Resources.ContainerRegistry,
			"--image", image.repository+":"+tag, "--write-enabled", "false", "--delete-enabled", "false", "--output", "none"); err != nil {
			return nil, fmt.Errorf("lock immutable image tag: %w", err)
		}
		images = append(images, deployAzureBuiltImage{
			Target: image.target, Reference: config.Resources.ContainerRegistry + ".azurecr.io/" + image.repository + "@" + metadata.Digest,
			Digest: metadata.Digest, Repository: image.repository, Tag: tag,
		})
	}
	return images, nil
}
