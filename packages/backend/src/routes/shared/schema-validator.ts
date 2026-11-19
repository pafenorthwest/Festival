import {
	type AnyValibotSchema,
	type InferInput,
	type InferOutput,
	parseSchemaValue,
} from "@festival/common";
import type { Context, Env, MiddlewareHandler } from "hono";
import type { BlankEnv } from "hono/types";
import { toJsonError } from "../../auth/tenant-context.js";
import { AppError } from "../../errors/app-error.js";

export type ValidationTarget = "json" | "query" | "param";

export interface SchemaValidatorOptions {
	invalidJsonMessage?: string;
	fallbackErrorMessage?: string;
	allowEmptyJsonObject?: boolean;
	errorCode?: string;
	preCheck?: (raw: unknown, c: Context) => Promise<unknown> | unknown;
}

async function readValidationTarget(
	c: Context,
	target: ValidationTarget,
	options: SchemaValidatorOptions,
): Promise<unknown> {
	if (target === "query") {
		return Object.fromEntries(
			Object.entries(c.req.queries()).map(([key, values]) => [
				key,
				values.length === 1 ? values[0] : values,
			]),
		);
	}
	if (target === "param") {
		return c.req.param();
	}
	try {
		return await c.req.json();
	} catch {
		if (options.allowEmptyJsonObject) {
			return {};
		}
		throw new AppError(
			options.invalidJsonMessage ?? "Invalid JSON payload.",
			400,
			options.errorCode,
		);
	}
}

export function schemaValidator<
	TTarget extends ValidationTarget,
	TSchema extends AnyValibotSchema,
	P extends string = string,
	E extends Env = BlankEnv,
>(
	target: TTarget,
	schema: TSchema,
	options: SchemaValidatorOptions = {},
): MiddlewareHandler<
	E,
	P,
	{
		in: { [K in TTarget]: InferInput<TSchema> };
		out: { [K in TTarget]: InferOutput<TSchema> };
	},
	never
> {
	return async (c, next) => {
		try {
			const raw = await readValidationTarget(c, target, options);
			await options.preCheck?.(raw, c);
			const parsed = parseSchemaValue(
				schema,
				raw,
				options.fallbackErrorMessage,
			);
			if (!parsed.success) {
				throw new AppError(parsed.message, 400, options.errorCode);
			}
			if (parsed.data !== undefined && parsed.data !== null) {
				c.req.addValidatedData(target, parsed.data);
			}
			return await next();
		} catch (error) {
			return toJsonError(c, error) as never;
		}
	};
}

export const jsonValidator = <
	TSchema extends AnyValibotSchema,
	P extends string = string,
	E extends Env = BlankEnv,
>(
	schema: TSchema,
	options?: SchemaValidatorOptions,
) => schemaValidator<"json", TSchema, P, E>("json", schema, options);

export const queryValidator = <
	TSchema extends AnyValibotSchema,
	P extends string = string,
	E extends Env = BlankEnv,
>(
	schema: TSchema,
	options?: SchemaValidatorOptions,
) => schemaValidator<"query", TSchema, P, E>("query", schema, options);

export const paramValidator = <
	TSchema extends AnyValibotSchema,
	P extends string = string,
	E extends Env = BlankEnv,
>(
	schema: TSchema,
	options?: SchemaValidatorOptions,
) => schemaValidator<"param", TSchema, P, E>("param", schema, options);

export function preValidationGuard<E extends Env = BlankEnv>(
	guard: (c: Context<E>) => Promise<void> | void,
): MiddlewareHandler<E> {
	return async (c, next) => {
		try {
			await guard(c);
			return await next();
		} catch (error) {
			return toJsonError(c, error) as never;
		}
	};
}
