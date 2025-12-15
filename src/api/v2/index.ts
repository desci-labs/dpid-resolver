import { Router } from "express";
import resolve from "./resolve.js";
import query from "./query.js";
import data from "./data/index.js";

const router = Router();

/** Resolve particular manifests */
router.use("/resolve", resolve);
/** Query for research objects, or their version history */
router.use("/query", query);
/** Data utilities (IPFS folder trees, etc.) */
router.use("/data", data);

export default router;
