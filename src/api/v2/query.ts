import { Router } from "express";
import { objectQueryHandler } from "./queries/objects.js";

const router = Router();

router.use("/objects", objectQueryHandler);

export default router;
