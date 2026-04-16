import fs from "fs";
import { IDE } from "..";
import { getGlobalContinueIgnorePath } from "../util/paths";
import { gitIgArrayFromFile } from "./ignore";

export const getGlobalContinueIgArray = () => {
  // scan-raw: The global ignore file content is parsed as gitignore-
  // style glob patterns by `gitIgArrayFromFile`. It never reaches an
  // LLM (the parsed patterns are used to filter file lists, not as
  // text in a prompt), so the scanning chokepoint adds no security
  // value here. SECURITY_HARDENING_PLAN.md CH5: "Low risk but
  // violates the chokepoint invariant — same treatment or add a
  // `// scan-raw:` justification comment."
  const contents = fs.readFileSync(getGlobalContinueIgnorePath(), "utf8");
  return gitIgArrayFromFile(contents);
};

export const getWorkspaceContinueIgArray = async (ide: IDE) => {
  const dirs = await ide.getWorkspaceDirs();
  return await dirs.reduce(
    async (accPromise, dir) => {
      const acc = await accPromise;
      try {
        const contents = await ide.readFile(`${dir}/.ai-firewallignore`);
        return [...acc, ...gitIgArrayFromFile(contents)];
      } catch (err) {
        console.error(err);
        return acc;
      }
    },
    Promise.resolve([] as string[]),
  );
};
