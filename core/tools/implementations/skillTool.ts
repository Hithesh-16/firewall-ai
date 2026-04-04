/**
 * Skill Tool — invoke a named skill via the proxy skill system.
 */

import { ToolImpl } from ".";
import { getStringArg } from "../parseArgs";

const PROXY_BASE_URL = process.env.AF_PROXY_URL ?? "http://localhost:8080";

export const skillToolImpl: ToolImpl = async (args, extras) => {
  const name = getStringArg(args, "name");
  const skillArgs = args.args as string | undefined;

  const response = await extras.fetch(
    new URL("/api/skills/invoke", PROXY_BASE_URL),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, args: skillArgs ?? "" }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    return [
      {
        name: "skill_error",
        description: `Skill "${name}" failed`,
        content: `Error invoking skill "${name}": ${response.status} — ${text}`,
      },
    ];
  }

  const result = await response.json();

  return [
    {
      name: "skill_result",
      description: `Result from skill "${name}"`,
      content:
        typeof result.data === "string"
          ? result.data
          : JSON.stringify(result.data ?? result, null, 2),
    },
  ];
};
