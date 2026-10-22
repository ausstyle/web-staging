/** Fixed public projection over the existing provider executor. No second send,
 * retry, token exchange, customer principal or grant-consumption implementation. */
import catalogue from "./strict_contracts.json" with { type: "json" };
import { executeProductProvider } from "./providers.ts";
type Obj = Record<string, unknown>;
const object = (value: unknown): value is Obj =>
  !!value && typeof value === "object" && !Array.isArray(value);
const projections = catalogue.provider_resources as unknown as Record<
  string,
  { item: Obj; items: Obj | null }
>;
function project(value: unknown, schema: Obj): unknown {
  if (value === null) return null;
  const alternatives = schema.oneOf || schema.anyOf;
  if (Array.isArray(alternatives)) {
    const variant = alternatives.find((s) =>
      object(s) && object(s.properties) &&
      Object.entries(s.properties).every(([key, field]) =>
        !object(field) || !Object.hasOwn(field, "const") ||
        object(value) && value[key] === field.const
      )
    );
    return object(variant) ? project(value, variant) : value;
  }
  if (Array.isArray(value) && object(schema.items)) {
    return value.map((v) => project(v, schema.items as Obj));
  }
  if (object(value) && object(schema.properties)) {
    return Object.fromEntries(
      Object.entries(schema.properties).filter(([key]) =>
        Object.hasOwn(value, key)
      ).map((
        [key, child],
      ) => [key, object(child) ? project(value[key], child) : value[key]]),
    );
  }
  return value;
}
export const executeStrictProductProvider: typeof executeProductProvider =
  async (op, args, context, identity, deps) => {
    const output = await executeProductProvider(
      op,
      args,
      context,
      identity,
      deps,
    );
    if (output.error) return output;
    const shape = projections[op.operation];
    if (!shape) throw Error("strict_provider_projection_missing");
    const originalItem = output.result.item;
    if (op.operation === "graph.drafts.update" && object(originalItem)) {
      output.result.item = { ...originalItem, id: args.draft_id };
    }
    if (
      [
        "graph.drafts.attachments.delete",
        "graph.mail_folders.delete",
        "graph.mail_rules.delete",
      ].includes(op.operation)
    ) {
      output.result.item = {
        id: args.attachment_id || args.folder_id || args.rule_id,
        state: "deleted",
      };
    }
    if (op.operation === "graph.mail_rules.update") {
      output.result.item = { id: args.rule_id, state: "update_submitted" };
    }
    const decorateRule = (value: unknown): unknown => {
      if (!object(value)) return value;
      const schema =
        (op.operation.endsWith(".list") ? shape.items : shape.item) as Obj;
      const unrepresentedFields = (input: unknown, selected: Obj): boolean => {
        if (Array.isArray(input)) {
          return !!selected.items &&
            input.some((v) => unrepresentedFields(v, selected.items as Obj));
        }
        if (!object(input) || !object(selected.properties)) return false;
        return Object.entries(input).some(([key, child]) =>
          !Object.hasOwn(selected.properties as Obj, key)
            ? !key.startsWith("@odata.")
            : object((selected.properties as Obj)[key]) &&
              unrepresentedFields(
                child,
                (selected.properties as Obj)[key] as Obj,
              )
        );
      };
      const unrepresented = unrepresentedFields(value, schema);
      return { ...value, unrepresented_rule_fields: unrepresented };
    };
    if (
      [
        "graph.mail_rules.list",
        "graph.mail_rules.get",
        "graph.mail_rules.create",
      ].includes(op.operation)
    ) {
      if (output.result.item !== null) {
        output.result.item = decorateRule(output.result.item);
      }
      if (Array.isArray(output.result.items)) {
        output.result.items = output.result.items.map(decorateRule);
      }
    }
    output.result = {
      ...output.result,
      item: project(output.result.item, shape.item),
      items: Array.isArray(output.result.items) && shape.items
        ? output.result.items.map((value) => project(value, shape.items!))
        : output.result.items,
    };
    return output;
  };
