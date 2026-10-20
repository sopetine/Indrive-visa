import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [source, output, release] = process.argv.slice(2);
if (!source || !output || !release || !/^[a-f0-9]{7,40}$/i.test(release)) {
  throw new Error("Usage: node scripts/prepare-pages.mjs <source> <output> <commit-sha>");
}

await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true, force: true });

async function rewrite(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await rewrite(path);
    else if (/\.(?:html|js)$/.test(entry.name)) {
      const content = await readFile(path, "utf8");
      const updated = content.replace(/(["'])([^"'\s]+\.(?:css|js))(?:\?[^"'\s]*)?\1/g, (match, quote, url) =>
        /^(?:[a-z]+:|\/\/|data:)/i.test(url) ? match : `${quote}${url}?v=${release}${quote}`,
      );
      await writeFile(path, updated);
    }
  }
}

await rewrite(output);
