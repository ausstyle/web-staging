/** Server-created evidence only; a timezone never establishes physical location. */
export function serverClockReply(at: Date, timezone: string) {
  const instant = at.toISOString();
  const clock = new Intl.DateTimeFormat("en-AU", {dateStyle:"full",timeStyle:"short",timeZone:timezone}).format(at);
  return {
    text: "The server clock reports " + clock + " (" + timezone + "). This is verified at request time; network delay may affect the time you see.",
    receipt: {tool:"system_clock",success:true,source:"server_clock",as_of:instant,timezone},
  };
}
