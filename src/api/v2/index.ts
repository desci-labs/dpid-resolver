import { Router } from "express";
import resolve from "./resolve.js";
import query from "./query.js";

const router = Router();

/** Resolve particular manifests */
router.use("/resolve", resolve);
/** Query for research objects, or their version history */
router.use("/query", query);

export default router;
