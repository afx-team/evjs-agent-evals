import type { MiddlewareChain } from "@evjs/ev/middleware";
import { requireWriter, validateNote } from "../apis/api/notes/policies";
import responseMetadata from "./response-metadata";

export default [
  requireWriter,
  validateNote,
  responseMetadata,
] satisfies MiddlewareChain;
