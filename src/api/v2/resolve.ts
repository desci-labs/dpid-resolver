import { Router } from "express";
import { resolveDpidHandler } from "./resolvers/dpid.js";
import { resolveCodexHandler } from "./resolvers/codex.js";
import { resolveGenericHandler } from "./resolvers/generic.js";

const router = Router();

/** Resolve dpid alias -> manifest */
router.use("/dpid/:dpid/:versionIx?", resolveDpidHandler);
/** Resolve streamId -> manifest */
router.use("/codex/:streamOrCommitId/:versionIx?", resolveCodexHandler);
/** Resolve any sensible dpid path */
router.use("/*", resolveGenericHandler);

export default router;
