type Obj = Record<string, any>;
const object = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Old runtimes see no top-level request/request_id and reject before dispatch.
 * This remains safe if a deployment rolls back between requests.
 */
export const assessmentEnvelope = (request: Obj) => ({ assessment: request });
export function runtimeRequestInput(value: unknown): Obj | null {
  if (!object(value)) return null;
  if (Object.hasOwn(value,"verified_voice_turn")) {
    if (!object(value.verified_voice_turn) || typeof value.verified_voice_turn.voice_session_id!=="string") return null;
    return {...value.verified_voice_turn,channel:"voice"};
  }
  if (!Object.hasOwn(value, "assessment")) return value;
  if (!object(value.assessment)) return null;
  return { ...value.assessment, execution_mode: "read_only_assessment" };
}
