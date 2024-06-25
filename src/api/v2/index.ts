import { Router } from "express";
import resolve from "./resolve.js";

const router = Router();

router.use("/resolve", resolve);

export default router;
