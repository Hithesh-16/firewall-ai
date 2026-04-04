/**
 * Notebook Edit Tool — edit a Jupyter notebook cell with file scan.
 */

import fs from "node:fs";
import { ToolImpl } from ".";
import { getStringArg } from "../parseArgs";

const PROXY_BASE_URL = process.env.AF_PROXY_URL ?? "http://localhost:8080";

export const notebookEditImpl: ToolImpl = async (args, extras) => {
  const filePath = getStringArg(args, "filePath");
  const cellIndex = Number(args.cellIndex);
  const newContent = getStringArg(args, "newContent");

  if (!Number.isInteger(cellIndex) || cellIndex < 0) {
    return [
      {
        name: "notebook_edit_error",
        description: filePath,
        content: `Invalid cellIndex: ${cellIndex}. MuFst be a non-negative integer.`,
      },
    ];
  }

  // Read and parse notebook
  const raw = await fs.promises.readFile(filePath, "utf-8");
  const notebook = JSON.parse(raw);

  if (!notebook.cells || cellIndex >= notebook.cells.length) {
    return [
      {
        name: "notebook_edit_error",
        description: filePath,
        content: `Cell index ${cellIndex} out of range. Notebook has ${notebook.cells?.length ?? 0} cells.`,
      },
    ];
  }

  // Scan new content through the proxy
  const scanResponse = await extras.fetch(
    new URL("/api/scan/file", PROXY_BASE_URL),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath, content: newContent }),
    },
  );

  if (scanResponse.ok) {
    const scanResult = await scanResponse.json();
    if (scanResult.action === "BLOCK") {
      return [
        {
          name: "notebook_edit_blocked",
          description: filePath,
          content: `Content blocked by security scan: ${(scanResult.reasons ?? []).join(", ")}`,
        },
      ];
    }
  }

  // Update the cell (notebooks store source as string array)
  const lines = newContent.endsWith("\n") ? newContent : `${newContent}\n`;
  const updatedCells = [...notebook.cells];
  updatedCells[cellIndex] = {
    ...updatedCells[cellIndex],
    source: lines
      .split("\n")
      .map((l: string, i: number, a: string[]) =>
        i < a.length - 1 ? `${l}\n` : l,
      ),
  };
  const updatedNotebook = { ...notebook, cells: updatedCells };

  await fs.promises.writeFile(
    filePath,
    JSON.stringify(updatedNotebook, null, 1),
    "utf-8",
  );

  return [
    {
      name: "notebook_edit_result",
      description: filePath,
      content: `Updated cell ${cellIndex} in ${filePath}.`,
    },
  ];
};
