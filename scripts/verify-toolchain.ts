import TypeScript from "typescript";

const packageFile = Bun.file(new URL("../package.json", import.meta.url));
const manifest = (await packageFile.json()) as {
	packageManager?: string;
	devDependencies?: { typescript?: string };
};
const expectedBun = manifest.packageManager?.match(/^bun@(.+)$/)?.[1];
const expectedTypeScript = manifest.devDependencies?.typescript;

if (!expectedBun)
	throw new Error("package.json must declare packageManager as bun@<version>.");
if (!expectedTypeScript || !/^\d+\.\d+\.\d+$/.test(expectedTypeScript))
	throw new Error("package.json must pin TypeScript to an exact version.");
if (Bun.version !== expectedBun)
	throw new Error(`Bun ${expectedBun} is required; found ${Bun.version}.`);
if (TypeScript.version !== expectedTypeScript)
	throw new Error(
		`TypeScript ${expectedTypeScript} is required; found ${TypeScript.version}.`,
	);

console.log(`Using Bun ${Bun.version} and TypeScript ${TypeScript.version}.`);
