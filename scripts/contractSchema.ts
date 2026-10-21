/**
 * Reads an OpenAPI file and checks JSON against the response schemas in it. Small on purpose
 * (it resolves only the local "#/components/..." references these contracts use), and it runs under
 * Node, tsx and Jest alike.
 */
import fs from 'node:fs';
import Ajv from 'ajv';
import { parse as parseYaml } from 'yaml';

export type Json = { [key: string]: unknown };
export interface Contract {
  paths: { [route: string]: { [method: string]: { responses: { [status: string]: { content?: { 'application/json'?: { schema?: Json } } } } } } };
  components: { schemas: { [name: string]: Json } };
}

/** Loads a contract with every local $ref replaced by what it points at. */
export function loadContract(file: string): Contract {
  const root = parseYaml(fs.readFileSync(file, 'utf8')) as Json;
  const lookup = (ref: string): unknown =>
    ref.replace(/^#\//, '').split('/').reduce<unknown>((node, key) => (node as Json | undefined)?.[key], root);
  const resolve = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(resolve);
    if (typeof node !== 'object' || node === null) return node;
    const object = node as Json;
    if (typeof object.$ref === 'string') {
      const target = lookup(object.$ref);
      if (target === undefined) throw new Error(`${file} points at ${object.$ref}, which is not in it`);
      return resolve(target);
    }
    return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, resolve(value)]));
  };
  return resolve(root) as Contract;
}

/** An ajv that reads dates the way all three systems write them: ISO 8601 UTC, a Z, no milliseconds. */
export function makeAjv(): Ajv {
  const ajv = new Ajv({ strict: false, allErrors: true });
  ajv.addFormat('date-time', { type: 'string', validate: (v: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v) && !Number.isNaN(Date.parse(v)) });
  ajv.addFormat('date', { type: 'string', validate: (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) });
  return ajv;
}

export function responseSchema(contract: Contract, route: string, method: string, status: number): Json | undefined {
  return contract.paths[route]?.[method]?.responses?.[String(status)]?.content?.['application/json']?.schema;
}

/** Why a value does not fit the schema, or undefined if it fits. */
export function misfit(ajv: Ajv, schema: Json | undefined, value: unknown): string | undefined {
  if (!schema) return 'the contract documents no JSON body here';
  const validate = ajv.compile(schema);
  return validate(value) ? undefined : ajv.errorsText(validate.errors);
}
