import { readFile } from "node:fs/promises";
import path from "node:path";
import { NotFoundError } from "@/server/http/errors";
import { withErrors } from "@/server/http/with-errors";
import { uploadRoot } from "@/server/jobs/evidence";

const FILE_PATTERN = /^(before|after)_\d{1,3}\.jpg$/;
const JOB_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * MANUAL §8 #20: serve a stored evidence image. Stored files are re-encoded
 * JPEGs without EXIF (no GPS). Names are server-generated, and the resolved
 * path must stay inside `UPLOAD_DIR`.
 */
export const GET = withErrors<{ jobId: string; file: string }>(async (_req, ctx) => {
  const { jobId, file } = await ctx.params;
  if (!JOB_PATTERN.test(jobId) || !FILE_PATTERN.test(file)) throw new NotFoundError("Image");
  const root = uploadRoot();
  const target = path.resolve(root, jobId, file);
  if (!target.startsWith(root + path.sep)) throw new NotFoundError("Image");
  let bytes: Buffer;
  try {
    bytes = await readFile(target);
  } catch {
    throw new NotFoundError("Image");
  }
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
