import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../..");

async function readRepoFile(relativePath: string): Promise<string> {
	return Bun.file(resolve(repositoryRoot, relativePath)).text();
}

function ghaExpr(expression: string): string {
	return ["$", `{{ ${expression} }}`].join("");
}

function shVar(expression: string): string {
	return ["$", `{${expression}}`].join("");
}

function assertBlockingVerifyGates(workflowOrJob: string): void {
	expect(workflowOrJob).toContain("services:");
	expect(workflowOrJob).toContain("image: postgres:17-alpine");
	expect(workflowOrJob).toContain("POSTGRES_DB: festival_test");
	expect(workflowOrJob).toContain("5432:5432");
	expect(workflowOrJob).toContain("pg_isready -U postgres -d festival_test");
	expect(workflowOrJob).toContain("oven-sh/setup-bun@v2");
	expect(workflowOrJob).toContain("bun-version: 1.4.2");
	expect(workflowOrJob).toContain("bun install --frozen-lockfile");
	expect(workflowOrJob).toContain("bun run format:check");
	expect(workflowOrJob).toContain("bun run lint");
	expect(workflowOrJob).toContain("bun run build");
	expect(workflowOrJob).toContain(
		"bun run --cwd packages/frontend check:types",
	);
	expect(workflowOrJob).toContain(
		"bunx --bun tsc -p packages/backend/tsconfig.json --noEmit",
	);
	expect(workflowOrJob).toContain("bun run check:sql");
	expect(workflowOrJob).toContain("bun run test");
	expect(workflowOrJob).toContain(
		"DATABASE_URL: postgres://postgres:postgres@127.0.0.1:5432/festival_test",
	);
	expect(workflowOrJob).toContain(
		"POSTGRES_INTEGRATION_URL: postgres://postgres:postgres@127.0.0.1:5432/festival_test",
	);
	expect(workflowOrJob).not.toContain("continue-on-error: true");
}

function assertTestDatabaseFatalLogLevel(workflowOrJob: string): void {
	const alterSql =
		"ALTER DATABASE festival_test SET log_min_messages = 'fatal';";
	expect(workflowOrJob).toContain("- name: Configure test database log level");
	expect(workflowOrJob).toContain(alterSql);
	const alterIndex = workflowOrJob.indexOf(alterSql);
	const testStepIndex = workflowOrJob.indexOf("run: bun run test");
	expect(alterIndex).toBeGreaterThan(-1);
	expect(testStepIndex).toBeGreaterThan(alterIndex);
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

	it("runs deterministic pre-deployment verification with pinned Bun 1.4.2 and Postgres 17", async () => {
		const deployWorkflow = await readRepoFile(".github/workflows/deploy.yml");
		const [verifyJob = ""] = deployWorkflow.split("\n  build-and-push:");

		expect(verifyJob).toContain("verify:");
		assertBlockingVerifyGates(verifyJob);
		expect(deployWorkflow).not.toContain("continue-on-error: true");
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
		expect(deployWorkflow).toContain("/api/bootstrap");
		expect(deployWorkflow).toContain(
			`smoke_org_slug="${shVar("DEPLOY_SMOKE_ORG_SLUG:-pafe")}"`,
		);
		expect(deployWorkflow).toContain(
			`/api/organizations/${shVar("smoke_org_slug")}/landing`,
		);
	});

	it("binds build-and-push to target environment and guards GHCR frontend push when Firebase vars are unset", async () => {
		const deployWorkflow = await readRepoFile(".github/workflows/deploy.yml");
		const [, afterVerify = ""] = deployWorkflow.split("\n  build-and-push:");
		const [buildAndPushJob = ""] = afterVerify.split("\n  deploy:");

		expect(buildAndPushJob).toContain("environment:");
		expect(buildAndPushJob).toContain(
			`name: ${ghaExpr("(github.event_name == 'workflow_dispatch' && github.event.inputs.environment) || (startsWith(github.ref, 'refs/tags/v') && 'production') || (startsWith(github.ref, 'refs/heads/release/v') && 'staging') || (github.ref == 'refs/heads/release' && 'integration') || 'integration'")}`,
		);
		expect(buildAndPushJob).toContain(
			"- name: Check Frontend Firebase build configuration",
		);
		expect(buildAndPushJob).toContain("id: frontend_config");
		expect(buildAndPushJob).toContain(
			'if [ -n "$FRONT_FIREBASE_API_KEY" ] && [ -n "$FRONT_FIREBASE_AUTH_DOMAIN" ] && [ -n "$FRONT_FIREBASE_PROJECT_ID" ] && [ -n "$FRONT_FIREBASE_APP_ID" ]; then',
		);
		expect(buildAndPushJob).toContain(
			'echo "push_frontend=true" >> "$GITHUB_OUTPUT"',
		);
		expect(buildAndPushJob).toContain(
			'echo "push_frontend=false" >> "$GITHUB_OUTPUT"',
		);
		expect(buildAndPushJob).toContain("::notice::");
		expect(buildAndPushJob).toContain(
			`push: ${ghaExpr("steps.frontend_config.outputs.push_frontend == 'true'")}`,
		);
		expect(buildAndPushJob).toContain("build-args: |");
		expect(buildAndPushJob).toContain(
			`FRONT_API_BASE=${ghaExpr("vars.FRONT_API_BASE || ''")}`,
		);
		expect(buildAndPushJob).toContain(
			`FRONT_FIREBASE_API_KEY=${ghaExpr("vars.FRONT_FIREBASE_API_KEY || 'demo-api-key'")}`,
		);
		expect(buildAndPushJob).toContain(
			`FRONT_FIREBASE_AUTH_DOMAIN=${ghaExpr("vars.FRONT_FIREBASE_AUTH_DOMAIN || 'demo-festival.firebaseapp.com'")}`,
		);
		expect(buildAndPushJob).toContain(
			`FRONT_FIREBASE_PROJECT_ID=${ghaExpr("vars.FRONT_FIREBASE_PROJECT_ID || 'demo-festival'")}`,
		);
		expect(buildAndPushJob).toContain(
			`FRONT_FIREBASE_APP_ID=${ghaExpr("vars.FRONT_FIREBASE_APP_ID || '1:000000000000:web:demo'")}`,
		);
		expect(buildAndPushJob).toContain("FRONT_FIREBASE_AUTH_EMULATOR_URL=");
	});

	it("fails closed on partial or required missing deploy host config and warns when unconfigured", async () => {
		const deployWorkflow = await readRepoFile(".github/workflows/deploy.yml");
		const [, afterBuild = ""] = deployWorkflow.split("\n  deploy:");
		const [deployJob = ""] = afterBuild.split("\n  smoke-test:");

		expect(deployJob).toContain("outputs:");
		expect(deployJob).toContain(
			`deployed: ${ghaExpr("steps.host_check.outputs.configured")}`,
		);
		expect(deployJob).toContain(
			'elif [ -n "$TARGET_HOST" ] || [ -n "$SSH_KEY" ] || [ -n "$PUBLIC_URL" ]; then',
		);
		expect(deployJob).toContain("::error::Partial deployment configuration");
		expect(deployJob).toContain(
			'elif [ "$EVENT_NAME" = "workflow_dispatch" ] || [ "$REQUIRE_DEPLOY_TARGET" = "true" ] || [[ "$GIT_REF" =~ ^refs/tags/v[1-9][0-9]*\\. ]]; then',
		);
		expect(deployJob).toContain(
			"::error::Missing required deployment configuration",
		);
		expect(deployJob).toContain(
			`::warning::Skipping remote SSH rollout for ${shVar("TARGET_ENVIRONMENT")}`,
		);
	});

	it("gates smoke-test on deploy output and verifies healthz, bootstrap, and configurable org landing", async () => {
		const deployWorkflow = await readRepoFile(".github/workflows/deploy.yml");
		const [, smokeTestJob = ""] = deployWorkflow.split("\n  smoke-test:");

		expect(smokeTestJob).toContain(
			`DEPLOYED: ${ghaExpr("needs.deploy.outputs.deployed")}`,
		);
		expect(smokeTestJob).toContain('if [ "$DEPLOYED" != "true" ]; then');
		expect(smokeTestJob).toContain(
			"::warning::Skipping post-deploy smoke verification because remote SSH rollout was skipped.",
		);
		expect(smokeTestJob).toContain('\'{"status":"ok"}\'');
		expect(smokeTestJob).toContain(
			`"${shVar("normalized_base")}/api/bootstrap"`,
		);
		expect(smokeTestJob).toContain(".session.authenticated == false");
		expect(smokeTestJob).toContain('[ "$smoke_org_slug" = "none" ]');
		expect(smokeTestJob).toContain(
			`"${shVar("normalized_base")}/api/organizations/${shVar("smoke_org_slug")}/landing"`,
		);
		expect(smokeTestJob).toContain(
			"::error::Post-deploy smoke verification failed after 12 attempts.",
		);
	});

	it("shares cd-integration concurrency and runs scripts/migrate.ts with oven/bun:1.4.2-alpine", async () => {
		const deployWorkflow = await readRepoFile(".github/workflows/deploy.yml");
		const integration = await readRepoFile(".github/workflows/integration.yml");
		const rebuildScript = await readRepoFile(
			"cloud-setup/05-rebuild-and-validate.sh",
		);

		expect(integration).toContain("group: cd-integration");
		expect(integration).not.toContain("group: integration-deployment");
		expect(deployWorkflow).toContain(
			"oven/bun:1.4.2-alpine bun run scripts/migrate.ts",
		);
		expect(integration).toContain(
			"oven/bun:1.4.2-alpine bun run scripts/migrate.ts",
		);
		expect(rebuildScript).toContain(
			"oven/bun:1.4.2-alpine bun run scripts/migrate.ts",
		);
		expect(deployWorkflow).not.toContain("oven/bun:1.4.2 ");
		expect(integration).not.toContain("oven/bun:1.4.2 ");
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

	it("enforces blocking PR checks with Postgres 17 and preserves manual integration deployment workflow", async () => {
		const prChecks = await readRepoFile(".github/workflows/pr-checks.yml");
		const integration = await readRepoFile(".github/workflows/integration.yml");

		expect(prChecks).toContain("verify:");
		assertBlockingVerifyGates(prChecks);
		expect(prChecks).not.toContain("sql_parameter_check:");
		expect(integration).toContain("bun-version: 1.4.2");
		expect(integration).toContain("https://int.artsfestival.online/healthz");
	});

	it("configures festival_test log_min_messages to fatal before running tests in CI workflows", async () => {
		const deployWorkflow = await readRepoFile(".github/workflows/deploy.yml");
		const prChecks = await readRepoFile(".github/workflows/pr-checks.yml");
		const integration = await readRepoFile(".github/workflows/integration.yml");
		const [deployVerifyJob = ""] = deployWorkflow.split("\n  build-and-push:");
		const [integrationVerifyJob = ""] = integration.split(
			"\n  deploy-integration:",
		);

		assertTestDatabaseFatalLogLevel(deployVerifyJob);
		assertTestDatabaseFatalLogLevel(prChecks);
		assertTestDatabaseFatalLogLevel(integrationVerifyJob);
	});
});
