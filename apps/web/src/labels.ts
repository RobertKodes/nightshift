/** Public names; protocol IDs stay unchanged. */
export const serviceLabel = (name: string) => name.replace(/^Watchtower(?=:|$)/, "Token monitor");
export const crewLabel = (id: string, name: string) => id === "watchtower" ? "Token monitor" : name;
