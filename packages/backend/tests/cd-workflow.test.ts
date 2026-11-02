import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../..");

async function readRepoFile(relativePath: string): Promise<string> {
	return Bun.file(resolve(repositoryRoot, relativePath)).text();
}

describe("Continuous Deployment & CI workflow contracts (#281)", () => {
	it("configures .github/workflows/deploy.yml for automated release branch and tag triggers", async () => {
		const deployWorkflow = await readRepoFile(".github/workflows/deploy.yml");

		expect(deployWorkflow).toContain("name: Continuous Deployment");
		expect(deployWorkflow).toContain("branches:");
		expect(deployWorkflow).toContain("- release");
		expect(deployWorkflow).toContain("- 'release/v*'");
		expect(deployWorkflow).toContain("tags:");
		expect(deployWorkflow).toContain("- 'v*.*.*'");
		expect(deployWorkflow).toContain("workflow_dispatch:");
	});

	it("enforces least-privilege permissions and non-canceling deployment concurrency", async () => {
		const deployWorkflow = await readRepoFile(".github/workflows/deploy.yml");

		expect(deployWorkflow).toContain("permissions:");
		expect(deployWorkflow).toContain("contents: read");
		expect(deployWorkflow).toContain("packages: write");
		expect(deployWorkflow).toContain("concurrency:");
		expect(deployWorkflow).toContain("cancel-in-progress: false");
	});

	it("runs deterministic pre-deployment verification with pinned Bun 1.4.2", async () => {
		const deployWorkflow = await readRepoFile(".github/workflows/deploy.yml");

		expect(deployWorkflow).toContain("verify:");
		expect(deployWorkflow).toContain("oven-sh/setup-bun@v2");
		expect(deployWorkflow).toContain("bun-version: 1.4.2");
		expect(deployWorkflow).toContain("bun install --frozen-lockfile");
		expect(deployWorkflow).toContain("bun run format:check");
		expect(deployWorkflow).toContain("bun run build");
		expect(deployWorkflow).toContain("bun run test");
		expect(deployWorkflow).toContain("bun run check:sql");
	});

	it("builds and pushes multi-stage backend and frontend images to GHCR with GHA caching", async () => {
		const deployWorkflow = await readRepoFile(".github/workflows/deploy.yml");

		expect(deployWorkflow).toContain("build-and-push:");
		expect(deployWorkflow).toContain("needs: verify");
		expect(deployWorkflow).toContain("docker/setup-buildx-action@v3");
		expect(deployWorkflow).toContain("docker/login-action@v3");
		expect(deployWorkflow).toContain("registry: ghcr.io");
		expect(deployWorkflow).toContain("docker/metadata-action@v5");
		const ghcrOwnerPrefix = ["ghcr.io/$", "{{ github.repository_owner }}"].join(
			"",
		);
		expect(deployWorkflow).toContain(`${ghcrOwnerPrefix}/festival-backend`);
		expect(deployWorkflow).toContain(`${ghcrOwnerPrefix}/festival-frontend`);
		expect(deployWorkflow).toContain("docker/build-push-action@v6");
		expect(deployWorkflow).toContain("file: docker/backend.Dockerfile");
		expect(deployWorkflow).toContain("file: docker/frontend.Dockerfile");
		expect(deployWorkflow).toContain("cache-from: type=gha");
		expect(deployWorkflow).toContain("cache-to: type=gha,mode=max");
	});

	it("performs environment-aware deployment and post-deploy /healthz and landing smoke verification", async () => {
		const deployWorkflow = await readRepoFile(".github/workflows/deploy.yml");

		expect(deployWorkflow).toContain("deploy:");
		expect(deployWorkflow).toContain("needs: [verify, build-and-push]");
		expect(deployWorkflow).toContain("environment:");
		expect(deployWorkflow).toContain("appleboy/ssh-action@v1.2.0");
		expect(deployWorkflow).toContain("bash cloud-setup/03-prepare-images.sh");
		expect(deployWorkflow).toContain(
			"docker compose --env-file cloud-setup/.env -f cloud-setup/compose.yml up -d --no-build --pull never",
		);
		expect(deployWorkflow).toContain("smoke-test:");
		expect(deployWorkflow).toContain("/healthz");
		expect(deployWorkflow).toContain("/api/organizations/pafe/landing");
	});

	it("maps refs explicitly to target environments without blind integration fallbacks for host secrets or public URLs", async () => {
		const deployWorkflow = await readRepoFile(".github/workflows/deploy.yml");

		expect(deployWorkflow).toContain(
			"github.event_name == 'workflow_dispatch'",
		);
		expect(deployWorkflow).toContain(
			"startsWith(github.ref, 'refs/tags/v') && 'production'",
		);
		expect(deployWorkflow).toContain(
			"startsWith(github.ref, 'refs/heads/release/v') && 'staging'",
		);
		expect(deployWorkflow).toContain(
			"github.ref == 'refs/heads/release' && 'integration'",
		);
		expect(deployWorkflow).not.toContain("DO_INTEGRATION_HOST");
		expect(deployWorkflow).not.toContain("DO_INTEGRATION_USER");
		expect(deployWorkflow).not.toContain("DO_SSH_PRIVATE_KEY");
		expect(deployWorkflow).not.toContain("DO_SSH_PASSPHRASE");
		expect(deployWorkflow).not.toContain("https://int.artsfestival.online");
		expect(deployWorkflow).toContain("vars.DEPLOY_PUBLIC_URL");
	});

	it("preserves existing PR checks and manual integration deployment workflows", async () => {
		const prChecks = await readRepoFile(".github/workflows/pr-checks.yml");
		const integration = await readRepoFile(".github/workflows/integration.yml");

		expect(prChecks).toContain("bun-version: 1.4.2");
		expect(prChecks).toContain("bun run check:sql");
		expect(integration).toContain("bun-version: 1.4.2");
		expect(integration).toContain("https://int.artsfestival.online/healthz");
	});
});
