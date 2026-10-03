import { mock } from "bun:test";

const clientSolid = await import("solid-js/dist/solid.js");
mock.module("solid-js", () => clientSolid);
