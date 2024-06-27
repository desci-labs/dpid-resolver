import { Router } from "express";
import { objectQueryHandler } from "./queries/objects.js";
import { historyQueryHandler } from "./queries/history.js";

const router = Router();

/** Query for all research objects */
router.use("/objects", objectQueryHandler);
/** Query for the history of one or more research objects */
router.use("/history", historyQueryHandler);

export default router;
